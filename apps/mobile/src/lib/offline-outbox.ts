import { createSyncPatch, mergeSyncUpdate, type SyncOperation, type SyncOperationStatus, type SyncRecord, type SyncServerReceipt, type SyncReviewOutcome, type SyncFieldValue } from '@fireops/domain';
import {decodeFleetDownloadProgress,decodeFleetDownloadPage,initialFleetDownload,type FleetDownloadProgress,type FleetDownloadPage} from './offline-fleet-download';
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
  readonly historyBackupPending?: boolean;
  readonly continuation?:{readonly parentId:string;readonly phase:'waiting'|'ready';readonly explicit?:boolean};
};
export type ContinuationReview={readonly operation:SyncOperation;readonly parentId:string;readonly current:CanonicalSyncRecord;readonly fields:Readonly<Record<string,{before:SyncFieldValue;saved:SyncFieldValue;current:SyncFieldValue}>>};
export type OutboxRebase={before:SyncOperation;after:SyncOperation;reason:string;createdAt:string};
export type OutboxReceipt = SyncServerReceipt;
export type CachedOfflineRecord = CanonicalSyncRecord & {readonly entityType:'vehicle'|'issue';readonly entityId:string;readonly verifiedAt:string};
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
  delivery_json: string | null; review_outcome_json: string | null; notice_dismissed: number; continuation_json?:string|null; history_backed_up?:number;
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
  const continuation=row.continuation_json?JSON.parse(row.continuation_json):undefined;
  if(continuation&&(!['waiting','ready'].includes(continuation.phase)||typeof continuation.parentId!=='string'||!(continuation.phase==='ready'&&continuation.explicit===true&&operation.dependsOn.length===0)&&(operation.dependsOn.length!==1||operation.dependsOn[0]!==continuation.parentId)))throw new Error('Invalid continuation metadata.');
  return {
    ...(continuation?{continuation}:{}),
    historyBackupPending:continuation?.phase==='ready'&&row.history_backed_up!==1,
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
    if (current === 2) {
      await tx.execAsync(`
        CREATE TABLE offline_records (
          user_id TEXT NOT NULL, company_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
          revision TEXT NOT NULL, record_json TEXT NOT NULL, verified_at TEXT NOT NULL,
          PRIMARY KEY(user_id, company_id, entity_type, entity_id)
        );
        CREATE TABLE offline_devices (user_id TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL);
        PRAGMA user_version = 3;
      `);
      current = 3;
    }
    if(current===3){
      await tx.execAsync(`ALTER TABLE offline_operations ADD COLUMN continuation_json TEXT;
        CREATE TABLE offline_rebase_history (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,company_id TEXT NOT NULL,operation_id TEXT NOT NULL,
          before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL
        ); PRAGMA user_version=4;`);current=4;
    }
    if(current===4){
      await tx.execAsync('ALTER TABLE offline_operations ADD COLUMN history_backed_up INTEGER NOT NULL DEFAULT 0 CHECK(history_backed_up IN (0,1)); PRAGMA user_version=5;');current=5;
    }
    if(current===5){
      await tx.execAsync(`CREATE TABLE offline_fleet_downloads(user_id TEXT NOT NULL,company_id TEXT NOT NULL,progress_json TEXT NOT NULL,PRIMARY KEY(user_id,company_id));
        CREATE TABLE offline_fleet_download_members(user_id TEXT NOT NULL,company_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,alive INTEGER NOT NULL CHECK(alive IN (0,1)),PRIMARY KEY(user_id,company_id,entity_type,entity_id)); PRAGMA user_version=6;`);current=6;
    }
    if (current !== 6) throw new Error('Unsupported offline database version. Update FireOps before syncing.');
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
         (status IN ('pending','syncing','awaiting_review') OR (status = 'blocked' AND review_outcome_json IS NULL)
           OR (history_backed_up=0 AND json_extract(continuation_json,'$.phase')='ready'))`, userId,
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

      async function confirmed(tx:OutboxSqlConnection,entityType:string,entityId:string,incoming:CanonicalSyncRecord):Promise<CanonicalSyncRecord>{
        if(!['vehicle','issue'].includes(entityType))throw new Error('Unsupported cached entity.');
        const value=decodeCanonicalSyncRecord({entityId},incoming,'1');
        const existing=await tx.getFirstAsync<{revision:string;record_json:string}>('SELECT revision,record_json FROM offline_records WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?',...ids,entityType,entityId);
        if(existing){
          const previous=decodeCanonicalSyncRecord({entityId},{revision:existing.revision,record:JSON.parse(existing.record_json)},'1');
          if(BigInt(previous.revision)>BigInt(value.revision))return previous;
          if(previous.revision===value.revision){if(!sameJson(existing.record_json,JSON.stringify(value.record)))throw new Error('A server revision has conflicting data.');return previous}
        }
        await tx.runAsync(`INSERT INTO offline_records VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,company_id,entity_type,entity_id)
          DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json,verified_at=excluded.verified_at`,...ids,entityType,entityId,value.revision,JSON.stringify(value.record),new Date().toISOString());
        return value;
      }
      async function downloadProgress(connection:OutboxSqlConnection):Promise<FleetDownloadProgress|null>{
        const row=await connection.getFirstAsync<{progress_json:string}>('SELECT progress_json FROM offline_fleet_downloads WHERE user_id=? AND company_id=?',...ids);
        return row?decodeFleetDownloadProgress(JSON.parse(row.progress_json)):null;
      }
      async function continuationReview(connection:OutboxSqlConnection,operationId:string):Promise<ContinuationReview>{
        const row=await connection.getFirstAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? AND operation_id=?',...ids,operationId);
        if(!row)throw new Error('Later edit is unavailable.');const child=entry(row);
        if(child.status!=='blocked'||child.attempts!==0||child.continuation?.phase!=='waiting'||child.operation.mutation.kind!=='update')throw new Error('This edit is not awaiting local rebase.');
        const parentRow=await connection.getFirstAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? AND operation_id=?',...ids,child.continuation.parentId);
        if(!parentRow)throw new Error('Earlier edit is unavailable.');const parent=entry(parentRow);
        if(parent.status!=='synced'&&!(parent.reviewOutcome&&['blocked','not_selected'].includes(parent.status)))throw new Error('Earlier work must finish sync/review before rebasing.');
        const cached=await connection.getFirstAsync<{revision:string;record_json:string}>('SELECT revision,record_json FROM offline_records WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?',...ids,row.entity_type,row.entity_id);
        const minimum=parent.reviewOutcome?.revision??(parent.receipt?.kind==='applied'?parent.receipt.revision:null);
        if(!cached||!minimum)throw new Error('Download a verified current record before rebasing.');
        const current=decodeCanonicalSyncRecord({entityId:row.entity_id},{revision:cached.revision,record:JSON.parse(cached.record_json)},minimum);
        if(!current.record)throw new Error('Deleted records cannot be restored by rebasing details.');
        const field=(record:SyncRecord,key:string):SyncFieldValue=>Object.prototype.hasOwnProperty.call(record,key)?{present:true,value:record[key]}:{present:false};
        const fields=Object.fromEntries(Object.entries(child.operation.mutation.patch).map(([key,value])=>[key,{before:field(child.operation.mutation.kind==='update'?child.operation.mutation.base:{},key),saved:value,current:field(current.record!,key)}]));
        return {operation:child.operation,parentId:child.continuation.parentId,current,fields};
      }
      return {
        scope:Object.freeze({...identity}),
        getDeviceId(createId:()=>string):Promise<string>{return write(async tx=>{
          const row=await tx.getFirstAsync<{device_id:string}>('SELECT device_id FROM offline_devices WHERE user_id=?',identity.userId);
          if(row)return row.device_id;
          const value=createId();required(value,'device ID');await tx.runAsync('INSERT INTO offline_devices VALUES (?,?)',identity.userId,value);return value;
        })},
        getFleetDownload():Promise<FleetDownloadProgress|null>{return read(()=>downloadProgress(db))},
        restartFleetDownload(generationId:string,expectedGeneration?:string):Promise<boolean>{required(generationId,'download generation');return write(async tx=>{
          const previous=await downloadProgress(tx);if(expectedGeneration!==undefined&&previous?.generationId!==expectedGeneration)return false;const progress={...initialFleetDownload(generationId),lastCompletedAt:previous?.lastCompletedAt??null};
          await tx.runAsync('DELETE FROM offline_fleet_download_members WHERE user_id=? AND company_id=?',...ids);
          await tx.runAsync('INSERT INTO offline_fleet_downloads VALUES(?,?,?) ON CONFLICT(user_id,company_id) DO UPDATE SET progress_json=excluded.progress_json',...ids,JSON.stringify(progress));return true;
        })},
        invalidateFleetDownload(generationId:string,expectedGeneration?:string):Promise<boolean>{required(generationId,'download generation');return write(async tx=>{
          if(expectedGeneration!==undefined&&(await downloadProgress(tx))?.generationId!==expectedGeneration)return false;
          await tx.runAsync('DELETE FROM offline_records WHERE user_id=? AND company_id=?',...ids);
          await tx.runAsync('DELETE FROM offline_projections WHERE user_id=? AND company_id=? AND operation_id IS NULL',...ids);
          await tx.runAsync('DELETE FROM offline_fleet_download_members WHERE user_id=? AND company_id=?',...ids);
          await tx.runAsync('UPDATE offline_fleet_downloads SET progress_json=? WHERE user_id=? AND company_id=?',JSON.stringify(initialFleetDownload(generationId)),...ids);return true;
        })},
        stopFleetDownload():Promise<void>{return write(async tx=>{
          await tx.runAsync('DELETE FROM offline_fleet_downloads WHERE user_id=? AND company_id=?',...ids);
          await tx.runAsync('DELETE FROM offline_fleet_download_members WHERE user_id=? AND company_id=?',...ids);
        })},
        applyFleetDownloadPage(expected:FleetDownloadProgress,page:FleetDownloadPage):Promise<boolean>{
          const request=JSON.parse(JSON.stringify(expected)) as FleetDownloadProgress;const saved=decodeFleetDownloadPage(page,identity.companyId,request);
          return write(async tx=>{
            const current=await downloadProgress(tx);if(!current||!sameJson(JSON.stringify(current),JSON.stringify(request)))return false;
            if(current.complete)throw new Error('Completed inventory needs a fresh scan.');
            if(current.snapshotToken!==null&&(current.total!==saved.total||current.vehicles!==saved.vehicles||current.issues!==saved.issues))throw new Error('Inventory counts changed within a snapshot.');
            const received=current.received+saved.records.length;
            if(received>saved.total||(saved.nextCursor===null?received!==saved.total:received>=saved.total))throw new Error('Incomplete or inconsistent inventory page.');
            for(const item of saved.records){
              await confirmed(tx,item.entityType,item.entityId,item);
              await tx.runAsync('INSERT INTO offline_fleet_download_members VALUES(?,?,?,?,?)',...ids,item.entityType,item.entityId,item.record===null?0:1);
            }
            if(saved.nextCursor===null){
              const counts=await tx.getFirstAsync<{total:number;vehicles:number;issues:number}>(`SELECT count(*) AS total,coalesce(sum(entity_type='vehicle' AND alive=1),0) AS vehicles,coalesce(sum(entity_type='issue' AND alive=1),0) AS issues FROM offline_fleet_download_members WHERE user_id=? AND company_id=?`,...ids);
              if(!counts||counts.total!==saved.total||counts.vehicles!==saved.vehicles||counts.issues!==saved.issues)throw new Error('Inventory coverage counts do not match verified pages.');
              const missing=await tx.getFirstAsync<{count:number}>(`SELECT count(*) AS count FROM offline_records r WHERE r.user_id=? AND r.company_id=? AND NOT EXISTS
                (SELECT 1 FROM offline_fleet_download_members m WHERE m.user_id=r.user_id AND m.company_id=r.company_id AND m.entity_type=r.entity_type AND m.entity_id=r.entity_id)`,...ids);
              if(missing?.count)throw new Error('Inventory omitted previously verified records. No deletion was assumed.');
            }
            const progress:FleetDownloadProgress={generationId:current.generationId,snapshotToken:saved.snapshotToken,cursor:saved.nextCursor,complete:saved.nextCursor===null,received,total:saved.total,vehicles:saved.vehicles,issues:saved.issues,serverRequestAt:saved.serverRequestAt,lastCompletedAt:saved.nextCursor===null?saved.serverRequestAt:current.lastCompletedAt};
            await tx.runAsync('UPDATE offline_fleet_downloads SET progress_json=? WHERE user_id=? AND company_id=?',JSON.stringify(progress),...ids);return true;
          });
        },
        listRecords():Promise<CachedOfflineRecord[]>{return read(async()=>{
          const rows=await db.getAllAsync<{entity_type:'vehicle'|'issue';entity_id:string;revision:string;record_json:string;verified_at:string}>('SELECT * FROM offline_records WHERE user_id=? AND company_id=?',...ids);
          return rows.map(row=>({...decodeCanonicalSyncRecord({entityId:row.entity_id},{revision:row.revision,record:JSON.parse(row.record_json)},'1'),entityType:row.entity_type,entityId:row.entity_id,verifiedAt:row.verified_at}));
        })},
        putRecord(entityType:'vehicle'|'issue',entityId:string,value:CanonicalSyncRecord):Promise<CanonicalSyncRecord>{
          const copy=decodeCanonicalSyncRecord({entityId},value,'1');return write(tx=>confirmed(tx,entityType,entityId,copy));
        },
        removeRecord(entityType:string,entityId:string):Promise<void>{return write(async tx=>{await tx.runAsync('DELETE FROM offline_records WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?',...ids,entityType,entityId)})},
        /** Commit projection and intent together. Re-enqueueing the same intent never regresses newer state. */
        enqueue(operation: SyncOperation, projection: SyncRecord | null, options?:{exclusiveRecord?:boolean;continuationParent?:string}): Promise<OutboxEntry> {
          guard();
          const encoded = encodeOperation(operation, identity);
          record(projection);
          // Detached before awaiting, including the dependency list and entity keys.
          const saved = JSON.parse(encoded) as SyncOperation;
          const projected = JSON.stringify(projection);
          const exclusiveRecord=options?.exclusiveRecord===true;
          const continuationParent=options?.continuationParent;
          return write(async (tx) => {
            const existing = await tx.getFirstAsync<Row>(
              'SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?', ...ids, saved.operationId,
            );
            if (existing) {
              if (!sameJson(existing.operation_json, encoded) || !sameJson(existing.projection_json, projected)) {
                const staged=continuationParent&&existing.continuation_json?await tx.getFirstAsync<{before_json:string}>('SELECT before_json FROM offline_rebase_history WHERE user_id=? AND company_id=? AND operation_id=? ORDER BY sequence LIMIT 1',...ids,saved.operationId):null;
                if(!staged||!sameJson(staged.before_json,encoded)||!sameJson(existing.projection_json,projected))throw new Error('Offline operation ID was reused for different work.');
              }
              return entry(existing);
            }
            if(exclusiveRecord){
              const pending=await tx.getFirstAsync<{operation_id:string}>(`SELECT operation_id FROM offline_operations WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?
                AND (status IN ('pending','syncing','awaiting_review') OR (status='blocked' AND review_outcome_json IS NULL)) LIMIT 1`,...ids,saved.entityType,saved.entityId);
              if(pending)throw new Error('This record already has a pending change. Sync or resolve it before editing again.');
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
            if(continuationParent){
              if(!previous||previous.operation_id!==continuationParent||saved.dependsOn.length!==1||saved.dependsOn[0]!==continuationParent||saved.mutation.kind!=='update'||!['vehicle','issue'].includes(saved.entityType))throw new Error('Record changed locally. Reopen the editor before saving another change.');
            }
            if (previous && (['pending','syncing','awaiting_review'].includes(previous.status)||(previous.status==='blocked'&&!previous.review_outcome_json)) && !saved.dependsOn.includes(previous.operation_id)) {
              throw new Error('A later edit must depend on the previous unsynced edit.');
            }
            await tx.runAsync(
              `INSERT INTO offline_operations
               (user_id, company_id, operation_id, entity_type, entity_id, operation_json, projection_json, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
              ...ids, saved.operationId, saved.entityType, saved.entityId, encoded, projected,
            );
            if(continuationParent)await tx.runAsync('UPDATE offline_operations SET continuation_json=? WHERE user_id=? AND company_id=? AND operation_id=?',JSON.stringify({parentId:continuationParent,phase:'waiting'}),...ids,saved.operationId);
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

        getContinuationReview(operationId:string):Promise<ContinuationReview>{return read(()=>continuationReview(db,operationId))},
        /** Explicit local choice, not a server approval. Only never-attempted drafts can change wire body. */
        rebaseContinuation(review:ContinuationReview,choices:Readonly<Record<string,'current'|'saved'>>):Promise<OutboxEntry>{
          createSyncPatch({},review as unknown as SyncRecord);createSyncPatch({},choices as SyncRecord);
          const expected=JSON.parse(JSON.stringify(review)) as ContinuationReview;const selected={...choices};
          return write(async tx=>{
            const existing=await tx.getFirstAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? AND operation_id=?',...ids,expected.operation.operationId);
            const previous=await tx.getFirstAsync<{before_json:string;after_json:string;reason:string}>("SELECT before_json,after_json,reason FROM offline_rebase_history WHERE user_id=? AND company_id=? AND operation_id=? AND reason LIKE 'explicit:%' ORDER BY sequence DESC LIMIT 1",...ids,expected.operation.operationId);
            if(existing&&previous&&sameJson(previous.before_json,JSON.stringify(expected.operation))&&sameJson(previous.after_json,existing.operation_json)&&sameJson(previous.reason.slice(9),JSON.stringify(selected)))return entry(existing);
            const current=await continuationReview(tx,expected.operation.operationId);
            if(!sameJson(JSON.stringify(current),JSON.stringify(expected)))throw new Error('Rebase review is stale. Refresh and choose again.');
            const keys=Object.keys(current.fields);
            if(Object.keys(selected).length!==keys.length||keys.some(key=>!['current','saved'].includes(selected[key])))throw new Error('Choose a source for every saved field.');
            const projected={...current.current.record!};
            const allowed=current.operation.entityType==='vehicle'?['unit','type','year','make','model','vin','plate','notes']:['title','description','priority'];
            for(const key of keys){
              if(selected[key]==='current')continue;
              if(!allowed.includes(key))throw new Error('This field needs another rebase adapter.');
              const slot=current.fields[key][selected[key]];
              if(slot.present){const value=slot.value;if(key==='year'){if(typeof value!=='number'||!Number.isInteger(value)||value<1000||value>9999)throw new Error('Invalid rebased year.')}else if(typeof value!=='string'||value.length>(['notes','description'].includes(key)?10000:200)||['unit','type','make','model','title'].includes(key)&&!value.trim()||key==='priority'&&!['Low','Medium','High','Critical'].includes(value))throw new Error('Invalid rebased value.');projected[key]=value}
              else{if(!['vin','plate','notes'].includes(key))throw new Error('Required field cannot be removed.');delete projected[key]}
            }
            const operation:SyncOperation={...current.operation,dependsOn:[],mutation:{kind:'update',baseRevision:current.current.revision,base:current.current.record!,patch:createSyncPatch(current.current.record!,projected)}};
            const encoded=encodeOperation(operation,identity);
            await tx.runAsync('INSERT INTO offline_rebase_history(user_id,company_id,operation_id,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?)',...ids,operation.operationId,JSON.stringify(current.operation),encoded,`explicit:${JSON.stringify(selected)}`,new Date().toISOString());
            await tx.runAsync('DELETE FROM offline_dependencies WHERE user_id=? AND company_id=? AND operation_id=?',...ids,operation.operationId);
            await tx.runAsync("UPDATE offline_operations SET operation_json=?,projection_json=?,continuation_json=?,status='pending',error=NULL,retry_at=0,notice_dismissed=0 WHERE user_id=? AND company_id=? AND operation_id=?",encoded,JSON.stringify(projected),JSON.stringify({parentId:current.parentId,phase:'ready',explicit:true}),...ids,operation.operationId);
            await tx.runAsync('UPDATE offline_projections SET record_json=? WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=? AND operation_id=?',JSON.stringify(projected),...ids,operation.entityType,operation.entityId,operation.operationId);
            return entry((await tx.getFirstAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? AND operation_id=?',...ids,operation.operationId))!);
          });
        },

        confirmHistoryBackup(operationId:string,history:readonly OutboxRebase[],proof:SyncServerReceipt):Promise<void>{
          const savedHistory=JSON.stringify(history);const savedProof=JSON.stringify(proof);
          return write(async tx=>{
            const row=await tx.getFirstAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? AND operation_id=?',...ids,operationId);
            if(!row)throw new Error('Saved operation is unavailable.');const current=entry(row);decodeSyncReceipt(current.operation,JSON.parse(savedProof));
            const rows=await tx.getAllAsync<{before_json:string;after_json:string;reason:string;created_at:string}>('SELECT * FROM offline_rebase_history WHERE user_id=? AND company_id=? AND operation_id=? ORDER BY sequence',...ids,operationId);
            const actual=rows.map(value=>({before:JSON.parse(value.before_json),after:JSON.parse(value.after_json),reason:value.reason,createdAt:value.created_at}));
            if(!actual.length||current.continuation?.phase!=='ready'||!sameJson(savedHistory,JSON.stringify(actual))||!sameJson(JSON.stringify(actual[actual.length-1].after),row.operation_json))throw new Error('History changed before backup confirmation.');
            await tx.runAsync('UPDATE offline_operations SET history_backed_up=1 WHERE user_id=? AND company_id=? AND operation_id=?',...ids,operationId);
          });
        },
        listRebases(operationId:string):Promise<OutboxRebase[]>{return read(async()=>{
          const rows=await db.getAllAsync<{before_json:string;after_json:string;reason:string;created_at:string}>('SELECT * FROM offline_rebase_history WHERE user_id=? AND company_id=? AND operation_id=? ORDER BY sequence',...ids,operationId);
          return rows.map(row=>({before:JSON.parse(row.before_json),after:JSON.parse(row.after_json),reason:row.reason,createdAt:row.created_at}));
        })},

        /** Local-only drafts cannot be claimed until a complete parent and verified canonical base permit rebase. */
        materializeContinuations():Promise<void>{return write(async tx=>{
          const rows=await tx.getAllAsync<Row>('SELECT * FROM offline_operations WHERE user_id=? AND company_id=? ORDER BY sequence',...ids);
          const parents=new Map(rows.map(row=>[row.operation_id,row]));
          for(const row of rows){
            if(row.status!=='pending'||row.attempts!==0||!row.continuation_json)continue;
            const child=entry(row);if(child.continuation?.phase!=='waiting')continue;
            const parentRow=parents.get(child.continuation.parentId);if(!parentRow)throw new Error('Missing continuation parent.');
            const parent=entry(parentRow);
            if(['pending','syncing','awaiting_review'].includes(parent.status)||parent.status==='blocked'&&!parent.reviewOutcome)continue;
            let reason='';let rebased:SyncOperation|undefined;
            if(parent.status!=='synced'||parent.reviewOutcome&&parent.reviewOutcome.outcome!=='kept')reason='Earlier review changed or rejected work. Review and explicitly rebase this later edit.';
            else{
              const canonical=await tx.getFirstAsync<{revision:string;record_json:string}>('SELECT revision,record_json FROM offline_records WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?',...ids,row.entity_type,row.entity_id);
              const minimum=parent.reviewOutcome?.revision??(parent.receipt?.kind==='applied'?parent.receipt.revision:null);
              if(!canonical||!minimum)reason='A verified current record is required to rebase this later edit.';
              else{
                const current=decodeCanonicalSyncRecord({entityId:row.entity_id},{revision:canonical.revision,record:JSON.parse(canonical.record_json)},minimum);
                const mutation=child.operation.mutation;
                if(mutation.kind!=='update'||!current.record)reason='Record is unavailable or deleted. This later edit needs explicit review; it will not restore a record.';
                else{
                  const allowed=row.entity_type==='vehicle'?['unit','type','year','make','model','vin','plate','notes']:['title','description','priority'];
                  if(Object.keys(mutation.patch).some(field=>!allowed.includes(field)))reason='This continuation needs a dedicated workflow adapter.';
                  else{
                    const merged=mergeSyncUpdate(mutation.base,current.record,mutation.patch);
                    if(merged.kind!=='merged')reason='Shared fields changed after this later edit was made. Review and explicitly rebase it.';
                    else rebased={...child.operation,mutation:{kind:'update',baseRevision:current.revision,base:current.record,patch:createSyncPatch(current.record,merged.record)}};
                  }
                }
              }
            }
            if(!rebased){await tx.runAsync("UPDATE offline_operations SET status='blocked',error=? WHERE user_id=? AND company_id=? AND operation_id=?",reason,...ids,row.operation_id);continue}
            const encoded=encodeOperation(rebased,identity);
            await tx.runAsync('INSERT INTO offline_rebase_history(user_id,company_id,operation_id,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?)',...ids,row.operation_id,row.operation_json,encoded,'automatic_independent',new Date().toISOString());
            await tx.runAsync('UPDATE offline_operations SET operation_json=?,continuation_json=?,error=NULL WHERE user_id=? AND company_id=? AND operation_id=?',encoded,JSON.stringify({...child.continuation,phase:'ready'}),...ids,row.operation_id);
          }
        })},

        /** Expired leases can be retried after a crash. Attempt numbers fence late responses. */
        claimNext(token: string, now = Date.now(), leaseMs = 60_000): Promise<{ entry: OutboxEntry; attempt: OutboxAttempt } | null> {
          required(token, 'attempt token'); milliseconds(now); milliseconds(leaseMs);
          if (leaseMs === 0) throw new Error('Lease must be positive.');
          milliseconds(now + leaseMs);
          return write(async (tx) => {
            const row = await tx.getFirstAsync<Row>(
              `SELECT candidate.* FROM offline_operations candidate
               WHERE candidate.user_id = ? AND candidate.company_id = ?
                 AND (candidate.continuation_json IS NULL OR json_extract(candidate.continuation_json,'$.phase')='ready')
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
                     AND previous.sequence < candidate.sequence AND (previous.status IN ('pending','syncing','awaiting_review') OR (previous.status = 'blocked' AND previous.review_outcome_json IS NULL))
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
            const current = snapshot ? await confirmed(tx,operation.entityType,operation.entityId,decodeCanonicalSyncRecord(operation, snapshot, outcome.revision)) : null;
            const status = outcome.outcome === 'kept' ? 'synced' : outcome.outcome === 'partially_kept' ? 'blocked' : 'not_selected';
            await tx.runAsync(`UPDATE offline_operations SET status = ?, error = ?, notice_dismissed = 0
              WHERE user_id = ? AND company_id = ? AND operation_id = ?`, status,
              outcome.outcome === 'partially_kept' ? 'Reviewed — some changes were kept. Dependent edits need rebase.' : null, ...ids, operationId);
            if (current) {
              await tx.runAsync(`UPDATE offline_projections SET record_json = ?, operation_id = NULL
                WHERE user_id = ? AND company_id = ? AND entity_type = ? AND entity_id = ? AND operation_id = ?`,
                JSON.stringify(current.record), ...ids, operation.entityType, operation.entityId, operationId);
            } else {
              await tx.runAsync('DELETE FROM offline_records WHERE user_id=? AND company_id=? AND entity_type=? AND entity_id=?',...ids,operation.entityType,operation.entityId);
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
            WHERE user_id = ? AND company_id = ? AND operation_id = ? AND status = 'blocked' AND review_outcome_json IS NULL
            AND (continuation_json IS NULL OR json_extract(continuation_json,'$.phase')='ready')`, ...ids, operationId)).changes === 1);
        },

        dismissCompletedNotices(): Promise<void> {
          return write(async tx => { await tx.runAsync(`UPDATE offline_operations SET notice_dismissed = 1 WHERE user_id = ? AND company_id = ?
            AND (status IN ('synced','not_selected') OR (status = 'blocked' AND review_outcome_json IS NOT NULL))
            AND (history_backed_up=1 OR continuation_json IS NULL OR json_extract(continuation_json,'$.phase')<>'ready')`, ...ids); });
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
          let saved = JSON.parse(JSON.stringify(result)) as OutboxDeliveryResult;
          const fence = { ...attempt };
          return write(async (tx) => {
            const row = await tx.getFirstAsync<Row>(
              `SELECT * FROM offline_operations WHERE user_id = ? AND company_id = ? AND operation_id = ?
               AND status = 'syncing' AND attempt_token = ? AND attempts = ?`,
              ...ids, fence.operationId, fence.token, fence.number,
            );
            if (!row) return false;
            if(saved.kind==='applied'){
              const operation=JSON.parse(row.operation_json) as SyncOperation;
              // Generic legacy receipts remain supported; fleet deliveries carry decimal revisions and raw IDs.
              if(['vehicle','issue'].includes(operation.entityType)&&/^[1-9][0-9]{0,17}$/.test(saved.revision)&&(saved.record===null||saved.record.id===operation.entityId)){
                saved={...saved,...await confirmed(tx,operation.entityType,operation.entityId,saved)};
              }
            }
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
