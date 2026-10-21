import { createSyncPatch, mergeSyncUpdate, type SyncOperation, type SyncOperationStatus, type SyncRecord, type SyncServerReceipt, type SyncReviewOutcome } from '@fireops/domain';
import {decodeSyncReceipt,decodeSyncOutcome,decodeCanonicalSyncRecord,type CanonicalSyncRecord} from './offline-sync-protocol';

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
  readonly delivery: OutboxReceipt | null;
  readonly reviewOutcome: SyncReviewOutcome | null;
  readonly noticeDismissed: boolean;
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
  user_id: string; company_id: string; entity_type: string; entity_id: string;
  sequence: number; operation_id: string; operation_json: string; projection_json: string;
  status: SyncOperationStatus; attempts: number; error: string | null; receipt_json: string | null;
  delivery_json: string | null; review_outcome_json: string | null; notice_dismissed: number;
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
  const operation = JSON.parse(row.operation_json) as SyncOperation;
  encodeOperation(operation, {userId:row.user_id,companyId:row.company_id});
  if (operation.operationId !== row.operation_id || operation.entityType !== row.entity_type || operation.entityId !== row.entity_id) throw new Error('Saved offline operation identity is inconsistent.');
  record(JSON.parse(row.projection_json));
  const receipt = row.receipt_json ? JSON.parse(row.receipt_json) as SyncServerReceipt : null;
  if (receipt) {
    createSyncPatch({}, receipt as unknown as SyncRecord); timestamp(receipt.receivedAt);
    if (receipt.kind === 'applied') { required(receipt.revision, 'receipt revision'); record(receipt.record); }
    else if (receipt.kind === 'awaiting_review') required(receipt.conflictId, 'conflict ID');
    else throw new Error('Invalid saved sync receipt.');
  } else if (row.receipt_json) throw new Error('Invalid saved sync receipt.');
  const delivery = row.delivery_json ? decodeSyncReceipt(operation, JSON.parse(row.delivery_json)) : null;
  const conflict = delivery?.kind === 'awaiting_review' ? delivery : receipt?.kind === 'awaiting_review' ? receipt : null;
  if (row.review_outcome_json && !conflict) throw new Error('Saved review has no matching conflict.');
  const reviewOutcome = row.review_outcome_json ? decodeSyncOutcome(operation, conflict!.conflictId, JSON.parse(row.review_outcome_json)) : null;
  if (row.review_outcome_json && !reviewOutcome) throw new Error('Invalid saved review outcome.');
  return {
    sequence: row.sequence, operation, projection: JSON.parse(row.projection_json),
    status: row.status, attempts: row.attempts, error: row.error,
    receipt, delivery, reviewOutcome,
    noticeDismissed: row.notice_dismissed === 1,
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
    let current = version?.user_version;
    if (current === 0) { await tx.execAsync(schema); current = 1; }
    if (current === 1) {
      await tx.execAsync(`
        ALTER TABLE offline_operations ADD COLUMN delivery_json TEXT;
        ALTER TABLE offline_operations ADD COLUMN review_outcome_json TEXT;
        ALTER TABLE offline_operations ADD COLUMN notice_dismissed INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 2;
      `);
      current = 2;
    }
    if (current !== 2) throw new Error('Unsupported offline database version. Update FireOps before syncing.');
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
    /** For the authenticated sign-out guard, across all of that user's companies. */
    countUnresolvedForUser(userId: string): Promise<number> {
      required(userId, 'user ID');
      return serialize(async () => (await db.getFirstAsync<{count:number}>(
        `SELECT count(*) AS count FROM offline_operations WHERE user_id = ? AND
         (status IN ('pending','syncing','awaiting_review') OR (status = 'blocked' AND review_outcome_json IS NULL))`, userId,
      ))?.count ?? 0);
    },
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

        /** Persist acceptance BEFORE authoritative catch-up; a restart never needs to re-upload it. */
        recordDelivery(attempt: OutboxAttempt, response: SyncServerReceipt): Promise<boolean> {
          const fence = {...attempt};
          createSyncPatch({}, response as unknown as SyncRecord);
          const responseCopy = JSON.parse(JSON.stringify(response)) as SyncServerReceipt;
          return write(async tx => {
            const row = await tx.getFirstAsync<Row>(
              `SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?
               AND status = 'syncing' AND attempt_token = ? AND attempts = ?`, ...ids, fence.operationId, fence.token, fence.number,
            );
            if (!row) return false;
            const receipt = decodeSyncReceipt(JSON.parse(row.operation_json), responseCopy);
            const encoded = JSON.stringify(receipt);
            if (row.delivery_json && !sameJson(row.delivery_json, encoded)) throw new Error('Sync acknowledgment changed for the same operation.');
            if (receipt.kind === 'awaiting_review') {
              await tx.runAsync(`UPDATE offline_operations SET delivery_json = ?, receipt_json = ?, status = 'awaiting_review',
                attempt_token = NULL, lease_until = NULL, error = NULL, notice_dismissed = 0
                WHERE user_id = ? AND company_id = ? AND operation_id = ?`, encoded, encoded, ...ids, fence.operationId);
            } else {
              await tx.runAsync('UPDATE offline_operations SET delivery_json = ? WHERE user_id = ? AND company_id = ? AND operation_id = ?', encoded, ...ids, fence.operationId);
            }
            return true;
          });
        },

        recordReviewOutcome(operationId: string, response: SyncReviewOutcome): Promise<boolean> {
          createSyncPatch({}, response as unknown as SyncRecord);
          const copy = JSON.parse(JSON.stringify(response));
          return write(async tx => {
            const row = await tx.getFirstAsync<Row>("SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ? AND status = 'awaiting_review'", ...ids, operationId);
            if (!row) return false;
            const receipt = JSON.parse(row.receipt_json!) as SyncServerReceipt;
            if (receipt.kind !== 'awaiting_review') throw new Error('Missing conflict acknowledgment.');
            const outcome = decodeSyncOutcome(JSON.parse(row.operation_json), receipt.conflictId, copy);
            if (!outcome) throw new Error('Missing review outcome.');
            const encoded = JSON.stringify(outcome);
            if (row.review_outcome_json && !sameJson(row.review_outcome_json, encoded)) throw new Error('Review decision changed.');
            await tx.runAsync('UPDATE offline_operations SET review_outcome_json = ? WHERE user_id = ? AND company_id = ? AND operation_id = ?', encoded, ...ids, operationId);
            return true;
          });
        },

        /** No canonical snapshot means access was denied: remove the overlay, never invent a deletion. */
        finishReview(operationId: string, canonical?: CanonicalSyncRecord): Promise<boolean> {
          if (canonical) createSyncPatch({}, canonical as unknown as SyncRecord);
          const snapshot = canonical ? JSON.parse(JSON.stringify(canonical)) : undefined;
          return write(async tx => {
            const row = await tx.getFirstAsync<Row>("SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ? AND status = 'awaiting_review'", ...ids, operationId);
            if (!row || !row.review_outcome_json) return false;
            const operation = JSON.parse(row.operation_json) as SyncOperation;
            const receipt = JSON.parse(row.receipt_json!) as SyncServerReceipt;
            if (receipt.kind !== 'awaiting_review') throw new Error('Missing conflict acknowledgment.');
            const outcome = decodeSyncOutcome(operation, receipt.conflictId, JSON.parse(row.review_outcome_json))!;
            const current = snapshot ? decodeCanonicalSyncRecord(operation, snapshot, outcome.revision) : null;
            const status = outcome.outcome === 'kept' ? 'synced' : outcome.outcome === 'partially_kept' ? 'blocked' : 'not_selected';
            await tx.runAsync(`UPDATE offline_operations SET status = ?, error = ?, notice_dismissed = 0
              WHERE user_id = ? AND company_id = ? AND operation_id = ?`, status,
              outcome.outcome === 'partially_kept' ? 'Reviewed — some changes were kept. Dependent edits need rebase.' : null, ...ids, operationId);
            if (current) {
              await tx.runAsync(`UPDATE offline_projections SET record_json = ?, operation_id = NULL
                WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ? AND operation_id = ?`,
                JSON.stringify(current.record), ...ids, operation.entityType, operation.entityId, operationId);
            } else {
              await tx.runAsync('DELETE FROM offline_projections WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ? AND operation_id = ?',
                ...ids, operation.entityType, operation.entityId, operationId);
            }
            return true;
          });
        },

        /** Only after the previous worker is paused/stopped; IDs and saved delivery receipts are retained. */
        recoverInterrupted(): Promise<void> {
          return write(async tx => { await tx.runAsync(`UPDATE offline_operations SET status = 'pending', retry_at = 0, attempt_token = NULL, lease_until = NULL
            WHERE user_id = ? AND company_id = ? AND status IN ('pending','syncing')`, ...ids); });
        },

        retryBlocked(operationId: string): Promise<boolean> {
          return write(async tx => (await tx.runAsync(`UPDATE offline_operations SET status = 'pending', retry_at = 0, error = NULL
            WHERE user_id = ? AND company_id = ? AND operation_id = ? AND status = 'blocked' AND review_outcome_json IS NULL`, ...ids, operationId)).changes === 1);
        },

        dismissCompletedNotices(): Promise<void> {
          return write(async tx => { await tx.runAsync(`UPDATE offline_operations SET notice_dismissed = 1 WHERE user_id = ? AND company_id = ?
            AND (status IN ('synced','not_selected') OR (status = 'blocked' AND review_outcome_json IS NOT NULL))`, ...ids); });
        },

        /** Call with a validated receipt plus a fresh canonical snapshot before reporting applied work synced. */
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
              `UPDATE offline_operations SET status = ?, retry_at = ?, error = ?, receipt_json = ?, attempt_token = NULL, lease_until = NULL, notice_dismissed = 0
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

export type OfflineOutboxStore = Awaited<ReturnType<typeof createOfflineOutbox>>;
export type OfflineOutboxSession = ReturnType<OfflineOutboxStore['activate']>;
