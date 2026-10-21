import { createSyncPatch, mergeSyncUpdate, type SyncOperation, type SyncOperationStatus, type SyncRecord, type SyncServerReceipt } from '@fireops/domain';

/** Small injectable SQLite surface: native Expo in production, real SQLite in tests. */
export type OutboxSqlValue = string | number | null;
export interface OutboxSqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: OutboxSqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: OutboxSqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: OutboxSqlValue[]): Promise<T[]>;
}
export interface OutboxDatabase extends OutboxSqlConnection {
  withExclusiveTransactionAsync(task: (transaction: OutboxSqlConnection) => Promise<void>): Promise<void>;
}

export type OutboxScope = { readonly userId: string; readonly companyId: string };
export type OutboxEntry = {
  readonly sequence: number;
  readonly operation: SyncOperation;
  readonly projection: SyncRecord | null;
  readonly status: SyncOperationStatus;
  readonly attempts: number;
  readonly error: string | null;
  readonly receipt: OutboxReceipt | null;
};
export type OutboxReceipt = SyncServerReceipt;
export type OutboxAttempt = {
  readonly operationId: string;
  readonly token: string;
  readonly number: number;
};
export type OutboxDeliveryResult = OutboxReceipt
  | { readonly kind: 'retry'; readonly retryAt: number; readonly error: string }
  | { readonly kind: 'blocked'; readonly error: string };
export type OutboxProjection = {
  readonly record: SyncRecord | null;
  /** null means a server-confirmed projection; record=null means a deletion. */
  readonly operationId: string | null;
};

type Row = {
  sequence: number; operation_id: string; operation_json: string; projection_json: string;
  status: SyncOperationStatus; attempts: number; error: string | null; receipt_json: string | null;
};

const schema = `
  CREATE TABLE offline_operations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL, company_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    operation_json TEXT NOT NULL, projection_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','syncing','awaiting_review','synced','not_selected','blocked')),
    attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
    attempt_token TEXT, lease_until INTEGER, error TEXT, receipt_json TEXT,
    UNIQUE(user_id, company_id, operation_id)
  );
  CREATE INDEX offline_operations_ready ON offline_operations(user_id, company_id, status, sequence);
  CREATE INDEX offline_operations_entity ON offline_operations(user_id, company_id, entity_type, entity_id, sequence);
  CREATE TABLE offline_dependencies (
    user_id TEXT NOT NULL, company_id TEXT NOT NULL, operation_id TEXT NOT NULL, dependency_id TEXT NOT NULL,
    PRIMARY KEY(user_id, company_id, operation_id, dependency_id)
  );
  CREATE TABLE offline_projections (
    user_id TEXT NOT NULL, company_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    operation_id TEXT, record_json TEXT NOT NULL,
    PRIMARY KEY(user_id, company_id, entity_type, entity_id)
  );
  PRAGMA user_version = 1;
`;

function required(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}.`);
}
function timestamp(value: unknown): void {
  required(value, 'timestamp');
  if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp.');
}
function milliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid local retry/lease time.');
}
function record(value: SyncRecord | null): void {
  if (value !== null) createSyncPatch({}, value);
}
function sameJson(left: string, right: string): boolean {
  return Object.keys(createSyncPatch({ value: JSON.parse(left) }, { value: JSON.parse(right) })).length === 0;
}
function encodeOperation(operation: SyncOperation, scope: OutboxScope): string {
  // Reject non-JSON values rather than letting JSON.stringify silently drop them.
  createSyncPatch({}, operation as unknown as SyncRecord);
  if (operation.schemaVersion !== 1) throw new Error('Unsupported offline operation version.');
  required(operation.operationId, 'operation ID');
  required(operation.entityType, 'entity type');
  required(operation.entityId, 'entity ID');
  if (operation.companyId !== scope.companyId || operation.provenance?.userId !== scope.userId) {
    throw new Error('Offline operation belongs to a different account or company.');
  }
  required(operation.provenance.deviceId, 'device ID');
  timestamp(operation.provenance.savedAt);
  if (!['online', 'offline', 'unknown'].includes(operation.provenance.connectivity)) throw new Error('Invalid connectivity state.');
  if (!Array.isArray(operation.dependsOn) || new Set(operation.dependsOn).size !== operation.dependsOn.length) {
    throw new Error('Invalid offline dependencies.');
  }
  for (const dependency of operation.dependsOn) {
    required(dependency, 'dependency ID');
    if (dependency === operation.operationId) throw new Error('An operation cannot depend on itself.');
  }
  const mutation = operation.mutation;
  if (!mutation || typeof mutation !== 'object') throw new Error('Missing offline mutation.');
  switch (mutation.kind) {
    case 'create': createSyncPatch({}, mutation.record); break;
    case 'update':
      required(mutation.baseRevision, 'base revision');
      mergeSyncUpdate(mutation.base, mutation.base, mutation.patch);
      break;
    case 'delete':
      required(mutation.baseRevision, 'base revision');
      createSyncPatch({}, mutation.base);
      break;
    case 'command':
      required(mutation.command, 'command');
      createSyncPatch({}, mutation.payload);
      break;
    default: throw new Error('Unsupported offline mutation.');
  }
  return JSON.stringify(operation);
}
function entry(row: Row): OutboxEntry {
  return {
    sequence: row.sequence, operation: JSON.parse(row.operation_json), projection: JSON.parse(row.projection_json),
    status: row.status, attempts: row.attempts, error: row.error,
    receipt: row.receipt_json === null ? null : JSON.parse(row.receipt_json),
  };
}

/**
 * A single store owns one connection and serializes its queries/transactions.
 * No networking, account retention/deletion, or attachment ownership is implemented here.
 * Activate a new scoped session on account/company changes; pause immediately on logout.
 * Late reads are rejected and late transactions roll back after scope invalidation.
 */
export async function createOfflineOutbox(db: OutboxDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const version = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (version?.user_version === 0) await tx.execAsync(schema);
    else if (version?.user_version !== 1) throw new Error('Unsupported offline database version. Update FireOps before syncing.');
  });
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task);
    tail = next.catch(() => undefined);
    return next;
  }

  return {
    pause() { generation += 1; },
    activate(scope: OutboxScope) {
      required(scope.userId, 'user ID');
      required(scope.companyId, 'company ID');
      // Copy identity before yielding; caller mutation cannot change a session's scope.
      const identity = { userId: scope.userId, companyId: scope.companyId };
      const ids = [identity.userId, identity.companyId];
      const sessionGeneration = ++generation;
      function guard() {
        if (sessionGeneration !== generation) throw new Error('Offline session is no longer active.');
      }
      function read<T>(task: () => Promise<T>): Promise<T> {
        return serialize(async () => { guard(); const result = await task(); guard(); return result; });
      }
      function write<T>(task: (tx: OutboxSqlConnection) => Promise<T>): Promise<T> {
        return serialize(async () => {
          guard();
          let result: T;
          await db.withExclusiveTransactionAsync(async (tx) => {
            guard(); result = await task(tx); guard();
          });
          guard();
          return result!;
        });
      }

      return {
        /** Commit projection and intent together. Re-enqueueing the same intent never regresses newer state. */
        enqueue(operation: SyncOperation, projection: SyncRecord | null): Promise<OutboxEntry> {
          guard();
          const encoded = encodeOperation(operation, identity);
          record(projection);
          // Detached before awaiting, including the dependency list and entity keys.
          const saved = JSON.parse(encoded) as SyncOperation;
          const projected = JSON.stringify(projection);
          return write(async (tx) => {
            const existing = await tx.getFirstAsync<Row>(
              'SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?', ...ids, saved.operationId,
            );
            if (existing) {
              if (!sameJson(existing.operation_json, encoded) || !sameJson(existing.projection_json, projected)) {
                throw new Error('Offline operation ID was reused for different work.');
              }
              return entry(existing);
            }
            for (const dependency of saved.dependsOn) {
              const parent = await tx.getFirstAsync<{ operation_id: string }>(
                'SELECT operation_id FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?', ...ids, dependency,
              );
              // Dependencies must already exist in this scope, preventing missing links and cycles.
              if (!parent) throw new Error('Offline dependency is not saved in this account/company.');
            }
            const previous = await tx.getFirstAsync<Row>(
              `SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ?
               ORDER BY sequence DESC LIMIT 1`, ...ids, saved.entityType, saved.entityId,
            );
            if (previous && previous.status !== 'synced' && !saved.dependsOn.includes(previous.operation_id)) {
              throw new Error('A later edit must depend on the previous unsynced edit.');
            }
            await tx.runAsync(
              `INSERT INTO offline_operations
               (user_id, company_id, operation_id, entity_type, entity_id, operation_json, projection_json, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
              ...ids, saved.operationId, saved.entityType, saved.entityId, encoded, projected,
            );
            for (const dependency of saved.dependsOn) {
              await tx.runAsync('INSERT INTO offline_dependencies VALUES (?, ?, ?, ?)', ...ids, saved.operationId, dependency);
            }
            await tx.runAsync(
              `INSERT INTO offline_projections (user_id, company_id, entity_type, entity_id, operation_id, record_json)
               VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, company_id, entity_type, entity_id)
               DO UPDATE SET operation_id = excluded.operation_id, record_json = excluded.record_json`,
              ...ids, saved.entityType, saved.entityId, saved.operationId, projected,
            );
            const row = await tx.getFirstAsync<Row>(
              'SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?', ...ids, saved.operationId,
            );
            return entry(row!);
          });
        },

        list(): Promise<OutboxEntry[]> {
          return read(async () => (await db.getAllAsync<Row>(
            'SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? ORDER BY sequence', ...ids,
          )).map(entry));
        },

        getProjection(entityType: string, entityId: string): Promise<OutboxProjection | null> {
          return read(async () => {
            const row = await db.getFirstAsync<{ operation_id: string | null; record_json: string }>(
              'SELECT operation_id, record_json FROM offline_projections WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ?',
              ...ids, entityType, entityId,
            );
            return row ? { operationId: row.operation_id, record: JSON.parse(row.record_json) } : null;
          });
        },

        /** Expired leases can be retried after a crash. Attempt numbers fence late responses. */
        claimNext(token: string, now = Date.now(), leaseMs = 60_000): Promise<{ entry: OutboxEntry; attempt: OutboxAttempt } | null> {
          required(token, 'attempt token'); milliseconds(now); milliseconds(leaseMs);
          if (leaseMs === 0) throw new Error('Lease must be positive.');
          milliseconds(now + leaseMs);
          return write(async (tx) => {
            const row = await tx.getFirstAsync<Row>(
              `SELECT candidate.* FROM offline_operations candidate
               WHERE candidate.user_id = ? AND candidate.company_id = ?
                 AND ((candidate.status = 'pending' AND candidate.retry_at <= ?)
                   OR (candidate.status = 'syncing' AND candidate.lease_until <= ?))
                 AND NOT EXISTS (
                   SELECT 1 FROM offline_dependencies dependency
                   LEFT JOIN offline_operations parent ON parent.user_id = dependency.user_id
                     AND parent.company_id = dependency.company_id AND parent.operation_id = dependency.dependency_id
                   WHERE dependency.user_id = candidate.user_id AND dependency.company_id = candidate.company_id
                     AND dependency.operation_id = candidate.operation_id AND (parent.status IS NULL OR parent.status <> 'synced')
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM offline_operations previous
                   WHERE previous.user_id = candidate.user_id AND previous.company_id = candidate.company_id
                     AND previous.entity_type = candidate.entity_type AND previous.entity_id = candidate.entity_id
                     AND previous.sequence < candidate.sequence AND previous.status <> 'synced'
                 )
               ORDER BY candidate.sequence LIMIT 1`, ...ids, now, now,
            );
            if (!row) return null;
            await tx.runAsync(
              `UPDATE offline_operations SET status = 'syncing', attempts = attempts + 1, attempt_token = ?, lease_until = ?
               WHERE user_id = ? AND company_id = ? AND operation_id = ?`, token, now + leaseMs, ...ids, row.operation_id,
            );
            return {
              entry: entry({ ...row, status: 'syncing', attempts: row.attempts + 1 }),
              attempt: { operationId: row.operation_id, token, number: row.attempts + 1 },
            };
          });
        },

        /** Only call with a validated response from the future authenticated sync adapter. */
        finishAttempt(attempt: OutboxAttempt, result: OutboxDeliveryResult): Promise<boolean> {
          required(attempt.operationId, 'operation ID'); required(attempt.token, 'attempt token');
          if (!Number.isSafeInteger(attempt.number) || attempt.number < 1) throw new Error('Invalid attempt number.');
          createSyncPatch({}, result as unknown as SyncRecord);
          switch (result.kind) {
            case 'applied': timestamp(result.receivedAt); required(result.revision, 'revision'); record(result.record); break;
            case 'awaiting_review': timestamp(result.receivedAt); required(result.conflictId, 'conflict ID'); break;
            case 'retry': milliseconds(result.retryAt); required(result.error, 'retry error'); break;
            case 'blocked': required(result.error, 'blocking error'); break;
            default: throw new Error('Unsupported offline delivery result.');
          }
          const saved = JSON.parse(JSON.stringify(result)) as OutboxDeliveryResult;
          const fence = { ...attempt };
          return write(async (tx) => {
            const row = await tx.getFirstAsync<Row>(
              `SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?
               AND status = 'syncing' AND attempt_token = ? AND attempts = ?`,
              ...ids, fence.operationId, fence.token, fence.number,
            );
            if (!row) return false;
            const status = saved.kind === 'applied' ? 'synced' : saved.kind === 'retry' ? 'pending' : saved.kind;
            const receipt = saved.kind === 'applied' || saved.kind === 'awaiting_review' ? JSON.stringify(saved) : null;
            const error = saved.kind === 'retry' || saved.kind === 'blocked' ? saved.error : null;
            await tx.runAsync(
              `UPDATE offline_operations SET status = ?, retry_at = ?, error = ?, receipt_json = ?, attempt_token = NULL, lease_until = NULL
               WHERE user_id = ? AND company_id = ? AND operation_id = ?`,
              status, saved.kind === 'retry' ? saved.retryAt : 0, error, receipt, ...ids, fence.operationId,
            );
            if (saved.kind === 'applied') {
              const operation = JSON.parse(row.operation_json) as SyncOperation;
              // An older acknowledgment cannot overwrite a newer local edit's projection.
              await tx.runAsync(
                `UPDATE offline_projections SET record_json = ?, operation_id = NULL
                 WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ? AND operation_id = ?`,
                JSON.stringify(saved.record), ...ids, operation.entityType, operation.entityId, fence.operationId,
              );
            }
            return true;
          });
        },
      };
    },
  };
}
