import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncOperation, SyncRecord } from '@fireops/domain';
import {createFleetEditGate,projectOfflineFleet} from './offline-fleet-model';
import {offlineDetailFormChanges,offlineDetailFormValues} from './offline-detail-form';
import {createOfflineDetailEditor} from './offline-detail-editor';
import {createOfflineSyncWorker,offlineSyncVisible,offlineSyncNotice} from './offline-sync-worker';
import {
  createOfflineOutbox, type OfflineOutboxSession, type OutboxDatabase, type OutboxSqlConnection, type OutboxSqlValue,
} from './offline-outbox';

const scope = { userId: 'user-1', companyId: 'company-1' };
const receivedAt = '2026-01-01T10:00:00.000Z';
function operation(id = 'op-1', entityId = 'vehicle-1', dependsOn: string[] = []): SyncOperation {
  return {
    schemaVersion: 1, operationId: id, companyId: scope.companyId, entityType: 'vehicle', entityId,
    provenance: { userId: scope.userId, deviceId: 'device-1', savedAt: receivedAt, connectivity: 'offline' },
    dependsOn, mutation: { kind: 'create', record: { name: 'Engine 1' } },
  };
}
function applied(record: SyncRecord | null = { name: 'Confirmed' }) {
  return { kind: 'applied' as const, receivedAt, revision: 'revision-2', record };
}

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

// Real SQL and rollback/commit behavior, without loading Expo/React Native or a UI.
function database(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  let closed = false;
  const close = () => { if (!closed) { sqlite.close(); closed = true; } };
  cleanup.push(close);
  const connection: OutboxSqlConnection = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { return { changes: Number(sqlite.prepare(sql).run(...params).changes) }; },
    async getFirstAsync<T>(sql: string, ...params: OutboxSqlValue[]) {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: OutboxSqlValue[]) { return sqlite.prepare(sql).all(...params) as T[]; },
  };
  const db: OutboxDatabase = {
    ...connection,
    async withExclusiveTransactionAsync(task) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(connection); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, connection, sqlite, close };
}
async function setup(path=':memory:') {
  const fixture = database(path);
  const store = await createOfflineOutbox(fixture.db);
  return { ...fixture, store, session: store.activate(scope) };
}
function barrier() {
  let release!: () => void;
  let reached!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { reached = resolve; });
  return { release, reached, wait, ready };
}

describe('durable mobile outbox', () => {
  it('atomically saves local data and a detached pending intent', async () => {
    const { session } = await setup();
    const projected = { name: 'Engine 1' };
    const saved = await session.enqueue(operation(), projected);
    projected.name = 'mutated';
    expect(saved).toMatchObject({ status: 'pending', attempts: 0, error: null, receipt: null });
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-1', record: { name: 'Engine 1' } });
    expect((await session.list())[0].projection).toEqual({ name: 'Engine 1' });
  });

  it('rolls back the intent when saving its local projection fails, and allows retry', async () => {
    const { session, sqlite } = await setup();
    sqlite.exec(`CREATE TRIGGER fail_projection BEFORE INSERT ON offline_projections BEGIN SELECT RAISE(FAIL, 'disk full'); END;`);
    await expect(session.enqueue(operation(), { name: 'Engine 1' })).rejects.toThrow('disk full');
    expect(await session.list()).toEqual([]);
    expect(await session.getProjection('vehicle', 'vehicle-1')).toBeNull();
    sqlite.exec('DROP TRIGGER fail_projection');
    await expect(session.enqueue(operation(), { name: 'Engine 1' })).resolves.toMatchObject({ status: 'pending' });
  });

  it('survives closing/reopening the database and recovers an interrupted attempt after lease expiry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fireops-outbox-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'sync.db');
    const first = database(path);
    const old = (await createOfflineOutbox(first.db)).activate(scope);
    await old.enqueue(operation(), { name: 'Engine 1' });
    const interrupted = await old.claimNext('attempt-1', 100, 50);
    const delivered={kind:'applied' as const,receivedAt,revision:'2',record:{id:'vehicle-1',name:'Server accepted'}};
    await old.recordDelivery(interrupted!.attempt,delivered);
    first.close();
    const second = database(path);
    const restored = (await createOfflineOutbox(second.db)).activate(scope);
    expect((await restored.list())[0].delivery).toEqual(delivered);
    expect(await restored.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-1', record: { name: 'Engine 1' } });
    expect(await restored.claimNext('too-soon', 149)).toBeNull();
    const retry = await restored.claimNext('attempt-2', 150);
    expect(retry?.attempt.number).toBe(2);
    expect(retry?.entry.operation.operationId).toBe('op-1');
    expect(await restored.finishAttempt(interrupted!.attempt, applied())).toBe(false);
    expect(await restored.finishAttempt(retry!.attempt, applied())).toBe(true);
    expect((await restored.list())[0].status).toBe('synced');
    await restored.dismissCompletedNotices();second.close();
    const third=database(path);const reopened=(await createOfflineOutbox(third.db)).activate(scope);
    expect((await reopened.list())[0]).toMatchObject({status:'synced',noticeDismissed:true});
  });

  it('preserves data across scoped sessions without exposing it to another user or company', async () => {
    const { session, store } = await setup();
    await session.enqueue(operation(), { name: 'private' });
    for (const other of [{ ...scope, userId: 'user-2' }, { ...scope, companyId: 'company-2' }]) {
      const switched = store.activate(other);
      expect(await switched.list()).toEqual([]);
      expect(await switched.getProjection('vehicle', 'vehicle-1')).toBeNull();
      expect(await switched.claimNext('attempt', 1)).toBeNull();
      expect(() => switched.enqueue(operation(), {})).toThrow(/different account or company/);
    }
    await expect(session.list()).rejects.toThrow(/no longer active/);
    expect((await store.activate(scope).list()).length).toBe(1);
  });

  it('captures scope and payload before awaiting, without following caller mutations', async () => {
    const { store } = await setup();
    const mutableScope = { ...scope };
    const session = store.activate(mutableScope);
    mutableScope.userId = 'other';
    const intent = operation();
    const promise = session.enqueue(intent, { name: 'original' });
    (intent as { entityId: string }).entityId = 'different';
    (intent.dependsOn as string[]).push('missing');
    await promise;
    expect((await session.list())[0].operation.entityId).toBe('vehicle-1');
    expect((await session.list())[0].operation.dependsOn).toEqual([]);
  });

  it('rolls back in-flight work when the active scope changes before commit', async () => {
    const { session, store, connection } = await setup();
    const gate = barrier();
    const run = connection.runAsync;
    connection.runAsync = async (sql, ...params) => {
      if (sql.includes('INSERT INTO offline_projections')) { gate.reached(); await gate.wait; }
      return run(sql, ...params);
    };
    const pending = session.enqueue(operation(), {});
    const rejected = expect(pending).rejects.toThrow(/no longer active/);
    await gate.ready;
    store.activate({ ...scope, companyId: 'other' });
    gate.release();
    await rejected;
    const restored = store.activate(scope);
    expect(await restored.list()).toEqual([]);
    expect(await restored.getProjection('vehicle', 'vehicle-1')).toBeNull();
  });

  it('pauses old sessions and refuses their late acknowledgments without deleting saved work', async () => {
    const { store, session } = await setup();
    await session.enqueue(operation(), {});
    const claim = await session.claimNext('attempt', 100);
    store.pause();
    await expect(session.finishAttempt(claim!.attempt, applied())).rejects.toThrow(/no longer active/);
    expect((await store.activate(scope).list())[0].status).toBe('syncing');
  });

  it('does not return a read that completes after account switching', async () => {
    const { store, session, db } = await setup();
    const gate = barrier();
    const getAll = db.getAllAsync;
    db.getAllAsync = async <T>(sql: string, ...params: OutboxSqlValue[]) => {
      const rows = await getAll<T>(sql, ...params);
      gate.reached(); await gate.wait; return rows;
    };
    const reading = session.list();
    const rejected = expect(reading).rejects.toThrow(/no longer active/);
    await gate.ready;
    store.pause(); gate.release();
    await rejected;
  });

  it('deduplicates equivalent JSON and never reinstates older data on an enqueue retry', async () => {
    const { session } = await setup();
    const first = operation();
    await session.enqueue(first, { a: 1, b: 2 });
    await session.enqueue(operation('op-2', 'vehicle-1', ['op-1']), { a: 3 });
    const duplicate = await session.enqueue({ ...first }, { b: 2, a: 1 });
    expect(duplicate.operation.operationId).toBe('op-1');
    expect((await session.list()).length).toBe(2);
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-2', record: { a: 3 } });
    await expect(session.enqueue(first, { a: 999 })).rejects.toThrow(/reused/);
    await expect(session.enqueue({ ...first, entityId: 'different' }, { a: 1, b: 2 })).rejects.toThrow(/reused/);
  });

  it('keeps an acknowledged operation acknowledged when the caller retries its original save', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), { name: 'local' });
    const claim = await session.claimNext('attempt', 0);
    await session.finishAttempt(claim!.attempt, applied());
    expect((await session.enqueue(operation(), { name: 'local' })).status).toBe('synced');
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: null, record: { name: 'Confirmed' } });
  });

  it('validates delivery results before changing an in-flight operation', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), {});
    const claim = await session.claimNext('attempt', 0);
    expect(() => session.finishAttempt(claim!.attempt, { ...applied(), revision: '' })).toThrow();
    expect(() => session.finishAttempt(claim!.attempt, { ...applied(), record: { value: NaN } })).toThrow();
    expect(() => session.finishAttempt(claim!.attempt, { kind: 'retry', retryAt: -1, error: 'lost' })).toThrow();
    expect(() => session.finishAttempt(claim!.attempt, { kind: 'awaiting_review', conflictId: '', receivedAt })).toThrow();
    expect((await session.list())[0]).toMatchObject({ status: 'syncing', receipt: null });
  });

  it('serializes concurrent enqueues and claims without duplicating work', async () => {
    const { session } = await setup();
    await Promise.all([session.enqueue(operation(), {}), session.enqueue(operation(), {})]);
    const results = await Promise.all([session.claimNext('one', 0), session.claimNext('two', 0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await session.list()).toHaveLength(1);
  });

  it('does not accept missing, duplicate, self, or other-scope dependencies', async () => {
    const { session, store } = await setup();
    await expect(session.enqueue(operation('child', 'child', ['missing']), {})).rejects.toThrow(/dependency/);
    expect(() => session.enqueue(operation('self', 'child', ['self']), {})).toThrow(/itself/);
    expect(() => session.enqueue(operation('duplicate', 'child', ['parent', 'parent']), {})).toThrow(/dependencies/);
    await session.enqueue(operation('parent'), {});
    const other = store.activate({ ...scope, companyId: 'other' });
    await expect(other.enqueue({ ...operation('child', 'child', ['parent']), companyId: 'other' }, {})).rejects.toThrow(/dependency/);
  });

  it('requires an explicit dependency for later edits and waits for predecessor acceptance', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), {});
    await expect(session.enqueue(operation('op-2'), {})).rejects.toThrow(/previous unsynced/);
    await session.enqueue(operation('op-2', 'vehicle-1', ['op-1']), {});
    const first = await session.claimNext('first', 0);
    expect(first?.entry.operation.operationId).toBe('op-1');
    expect(await session.claimNext('second', 0)).toBeNull();
    await session.finishAttempt(first!.attempt, applied());
    expect((await session.claimNext('second', 0))?.entry.operation.operationId).toBe('op-2');
  });

  it('respects cross-record dependencies without blocking unrelated work', async () => {
    const { session } = await setup();
    await session.enqueue(operation('parent', 'parent'), {});
    await session.enqueue(operation('child', 'child', ['parent']), {});
    await session.enqueue(operation('unrelated', 'unrelated'), {});
    const parent = await session.claimNext('parent', 0);
    await session.finishAttempt(parent!.attempt, { kind: 'blocked', error: 'Permission revoked' });
    expect((await session.claimNext('unrelated', 0))?.entry.operation.operationId).toBe('unrelated');
    expect(await session.claimNext('child', 0)).toBeNull();
  });

  it('fails closed if a dependency row references missing data', async () => {
    const { session, sqlite } = await setup();
    await session.enqueue(operation(), {});
    sqlite.prepare('INSERT INTO offline_dependencies VALUES (?, ?, ?, ?)').run(scope.userId, scope.companyId, 'op-1', 'missing');
    expect(await session.claimNext('attempt', 0)).toBeNull();
  });

  it('persists retries and backoff, fencing stale results even when a caller reuses an attempt token', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), {});
    const first = await session.claimNext('same-token', 10, 20);
    await session.finishAttempt(first!.attempt, { kind: 'retry', error: 'Connection lost', retryAt: 100 });
    expect((await session.list())[0]).toMatchObject({ status: 'pending', attempts: 1, error: 'Connection lost' });
    expect(await session.claimNext('same-token', 99)).toBeNull();
    const second = await session.claimNext('same-token', 100);
    expect(second?.attempt.number).toBe(2);
    expect(await session.finishAttempt(first!.attempt, applied())).toBe(false);
    expect(await session.finishAttempt(second!.attempt, applied())).toBe(true);
    expect(await session.finishAttempt(second!.attempt, applied({ name: 'duplicate' }))).toBe(false);
    expect((await session.list())[0]).toMatchObject({ status: 'synced', error: null, attempts: 2, receipt: applied() });
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: null, record: { name: 'Confirmed' } });
  });

  it('retains conflict proposals, provenance and receipt without calling them synced', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), { status: 'out of service' });
    const claim = await session.claimNext('attempt', 0);
    const receipt = { kind: 'awaiting_review' as const, receivedAt, conflictId: 'conflict-1' };
    await session.finishAttempt(claim!.attempt, receipt);
    expect((await session.list())[0]).toMatchObject({ status: 'awaiting_review', receipt, operation: operation() });
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-1', record: { status: 'out of service' } });
    expect(await session.claimNext('again', 999_999)).toBeNull();
  });

  it('never overwrites a newer local projection with an older acknowledgment', async () => {
    const { session } = await setup();
    await session.enqueue(operation(), { name: 'first' });
    const first = await session.claimNext('first', 0);
    await session.enqueue(operation('op-2', 'vehicle-1', ['op-1']), { name: 'second' });
    await session.finishAttempt(first!.attempt, applied({ name: 'server first' }));
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-2', record: { name: 'second' } });
    const second = await session.claimNext('second', 0);
    await session.finishAttempt(second!.attempt, applied({ name: 'server second' }));
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: null, record: { name: 'server second' } });
  });

  it('represents confirmed deletions separately from a record that was never downloaded', async () => {
    const { session } = await setup();
    const intent: SyncOperation = { ...operation(), mutation: { kind: 'delete', baseRevision: 'revision-1', base: {} } };
    await session.enqueue(intent, null);
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-1', record: null });
    const claim = await session.claimNext('delete', 0);
    await session.finishAttempt(claim!.attempt, applied(null));
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: null, record: null });
    expect(await session.getProjection('vehicle', 'unknown')).toBeNull();
  });

  it('rolls back an acknowledgment when updating the confirmed projection fails', async () => {
    const { session, sqlite } = await setup();
    await session.enqueue(operation(), { name: 'local' });
    const claim = await session.claimNext('attempt', 0);
    sqlite.exec(`CREATE TRIGGER fail_confirmation BEFORE UPDATE ON offline_projections BEGIN SELECT RAISE(FAIL, 'write failed'); END;`);
    await expect(session.finishAttempt(claim!.attempt, applied())).rejects.toThrow('write failed');
    expect((await session.list())[0]).toMatchObject({ status: 'syncing', receipt: null });
    expect(await session.getProjection('vehicle', 'vehicle-1')).toEqual({ operationId: 'op-1', record: { name: 'local' } });
    sqlite.exec('DROP TRIGGER fail_confirmation');
    expect(await session.finishAttempt(claim!.attempt, applied())).toBe(true);
  });

  it('rejects unsupported database versions without modifying existing data', async () => {
    const { db, sqlite } = database();
    sqlite.exec('PRAGMA user_version = 8; CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES (\'preserve\');');
    await expect(createOfflineOutbox(db)).rejects.toThrow(/Unsupported offline database version/);
    expect(sqlite.prepare('SELECT value FROM future_data').get()).toEqual({ value: 'preserve' });
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
  });

  it('upgrades v1 storage without losing queued work, projections or ordering', async () => {
    const {session,store,sqlite,db}=await setup();await session.enqueue(operation(),{name:'Saved'});store.pause();
    sqlite.exec('DROP TABLE offline_attachment_refs; DROP TABLE offline_attachments; ALTER TABLE offline_operations DROP COLUMN attachment_ids_json; ALTER TABLE offline_operations DROP COLUMN history_backed_up; ALTER TABLE offline_operations DROP COLUMN delivery_json; ALTER TABLE offline_operations DROP COLUMN review_outcome_json; ALTER TABLE offline_operations DROP COLUMN notice_dismissed; ALTER TABLE offline_operations DROP COLUMN continuation_json; DROP TABLE offline_rebase_history; DROP TABLE offline_records; DROP TABLE offline_devices; DROP TABLE offline_fleet_downloads; DROP TABLE offline_fleet_download_members; PRAGMA user_version=1;');
    const restored=(await createOfflineOutbox(db)).activate(scope);
    expect((await restored.list())[0]).toMatchObject({status:'pending',delivery:null,reviewOutcome:null,noticeDismissed:false});
    expect(await restored.getProjection('vehicle','vehicle-1')).toEqual({operationId:'op-1',record:{name:'Saved'}});
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({user_version:7});
  });

  it('persists delivery before catch-up and retains it across retries without replacing local data', async () => {
    const {session}=await setup();const op={...operation(),mutation:{kind:'update' as const,baseRevision:'1',base:{id:'vehicle-1',notes:'Old'},patch:{notes:{present:true as const,value:'New'}}}};
    await session.enqueue(op,{id:'vehicle-1',notes:'New'});const first=await session.claimNext('first',0);
    const delivered={kind:'applied' as const,receivedAt,revision:'2',record:{id:'vehicle-1',notes:'Accepted'}};
    await session.recordDelivery(first!.attempt,delivered);
    expect((await session.list())[0]).toMatchObject({status:'syncing',delivery:delivered,receipt:null});
    expect((await session.getProjection('vehicle','vehicle-1'))?.operationId).toBe('op-1');
    await session.finishAttempt(first!.attempt,{kind:'retry',retryAt:100,error:'Refresh unavailable'});
    const retry=await session.claimNext('retry',100);expect(retry?.entry.delivery).toEqual(delivered);
    await session.finishAttempt(retry!.attempt,{kind:'applied',receivedAt,revision:'3',record:{id:'vehicle-1',notes:'Latest'}});
    await session.dismissCompletedNotices();expect((await session.list())[0]).toMatchObject({status:'synced',noticeDismissed:true,delivery:delivered});
    expect(await session.finishAttempt(retry!.attempt,delivered)).toBe(false);
  });

  it('records a verified review outcome without inventing a deleted or readable canonical record', async () => {
    const {session}=await setup();const op={...operation(),mutation:{kind:'update' as const,baseRevision:'1',base:{id:'vehicle-1',notes:'Old'},patch:{notes:{present:true as const,value:'New'}}}};
    await session.enqueue(op,{id:'vehicle-1',notes:'New'});const claim=await session.claimNext('review',0);
    await session.recordDelivery(claim!.attempt,{kind:'awaiting_review',receivedAt,conflictId:'conflict-1'});
    const result={kind:'reviewed' as const,decisionId:'decision-1',conflictId:'conflict-1',operationId:'op-1',decidedAt:receivedAt,revision:'3',outcome:'kept' as const,keptFields:['notes'],discardedFields:[]};
    await session.recordReviewOutcome('op-1',result);
    expect((await session.list())[0]).toMatchObject({status:'awaiting_review',reviewOutcome:result});
    await session.finishReview('op-1');expect((await session.list())[0].status).toBe('synced');
    expect(await session.getProjection('vehicle','vehicle-1')).toBeNull();
    expect(await session.finishReview('op-1')).toBe(false);
  });

  it('partly kept work cannot be retried and its decision cannot erase a newer dependent overlay', async () => {
    const {session,store}=await setup();const op={...operation(),mutation:{kind:'update' as const,baseRevision:'1',base:{id:'vehicle-1',notes:'Old'},patch:{notes:{present:true as const,value:'New'},vin:{present:true as const,value:'VIN'}}}};
    await session.enqueue(op,{id:'vehicle-1',notes:'New',vin:'VIN'});
    await session.enqueue({...op,operationId:'child',dependsOn:['op-1']},{id:'vehicle-1',notes:'Later'});
    const claim=await session.claimNext('review',0);await session.recordDelivery(claim!.attempt,{kind:'awaiting_review',receivedAt,conflictId:'conflict-1'});
    await session.recordReviewOutcome('op-1',{kind:'reviewed',decisionId:'decision-1',conflictId:'conflict-1',operationId:'op-1',decidedAt:receivedAt,revision:'3',outcome:'partially_kept',keptFields:['notes'],discardedFields:['vin']});
    await session.finishReview('op-1',{revision:'4',record:{id:'vehicle-1',notes:'Confirmed'}});
    expect(await session.retryBlocked('op-1')).toBe(false);expect(await session.claimNext('child',100)).toBeNull();
    expect(await session.getProjection('vehicle','vehicle-1')).toEqual({operationId:'child',record:{id:'vehicle-1',notes:'Later'}});
    expect(await store.countUnresolvedForUser(scope.userId)).toBe(1);
    await session.dismissCompletedNotices();expect((await session.list())[0]).toMatchObject({status:'blocked',noticeDismissed:true});
  });

  it('sign-out counts include pending work across that user’s companies, but not another account', async () => {
    const {session,store}=await setup();await session.enqueue(operation(),{});
    const second=store.activate({...scope,companyId:'company-2'});await second.enqueue({...operation(),companyId:'company-2'},{});
    const other=store.activate({...scope,userId:'other'});await other.enqueue({...operation(),provenance:{...operation().provenance,userId:'other'}},{});
    expect(await store.countUnresolvedForUser(scope.userId)).toBe(2);expect(await store.countUnresolvedForUser('other')).toBe(1);
  });

  it('validates stored mutation shapes and projections instead of silently losing JSON data', async () => {
    const { session } = await setup();
    const invalid = [
      { ...operation(), schemaVersion: 2 },
      { ...operation(), operationId: '' },
      { ...operation(), provenance: { ...operation().provenance, connectivity: 'maybe' } },
      { ...operation(), provenance: { ...operation().provenance, savedAt: 'invalid' } },
      { ...operation(), mutation: { kind: 'unknown' } },
      { ...operation(), mutation: { kind: 'update', baseRevision: '', base: {}, patch: {} } },
      { ...operation(), mutation: { kind: 'update', baseRevision: 'r1', base: {}, patch: { name: { present: true } } } },
      { ...operation(), mutation: { kind: 'create', record: { value: NaN } } },
    ];
    for (const intent of invalid) expect(() => session.enqueue(intent as SyncOperation, {})).toThrow();
    expect(() => session.enqueue(operation(), { value: undefined } as unknown as SyncRecord)).toThrow();
    expect(() => session.enqueue(operation(), { value: Infinity })).toThrow();
    expect(() => session.claimNext('', 0)).toThrow();
    expect(() => session.claimNext('token', 0, 0)).toThrow();
    expect(() => session.claimNext('token', -1)).toThrow();
    expect(await session.list()).toEqual([]);
  });
});

const rawVehicle={id:'vehicle-1',unit:'E1',type:'Engine',year:2024,make:'Ford',model:'F',notes:'base',status:'Ready'};
describe('verified offline detail bases',()=>{
  it('keeps complete detached raw records, tombstones and monotonic 18-digit revisions',async()=>{
    const {session}=await setup();const record={...rawVehicle,nested:{value:1}};
    await session.putRecord('vehicle',record.id,{revision:'9007199254740992',record});record.nested.value=2;
    expect((await session.listRecords())[0].record).toMatchObject({nested:{value:1}});
    await session.putRecord('vehicle',record.id,{revision:'9007199254740993',record:null});
    await session.putRecord('vehicle',record.id,{revision:'9007199254740992',record:rawVehicle});
    expect((await session.listRecords())[0]).toMatchObject({revision:'9007199254740993',record:null});
    await expect(session.putRecord('vehicle',record.id,{revision:'9007199254740993',record:rawVehicle})).rejects.toThrow('conflicting data');
    expect(()=>session.putRecord('vehicle',record.id,{revision:'4',record:{id:'wrong'}})).toThrow('identity');
  });
  it('scopes cached records and persists per-account device IDs across companies and restarts',async()=>{
    const {session,store,db}=await setup();await session.putRecord('vehicle',rawVehicle.id,{revision:'1',record:rawVehicle});
    expect(await session.getDeviceId(()=> 'device-a')).toBe('device-a');
    const otherCompany=store.activate({...scope,companyId:'other-company'});
    expect(await otherCompany.listRecords()).toEqual([]);expect(await otherCompany.getDeviceId(()=> 'wrong')).toBe('device-a');
    const otherUser=store.activate({...scope,userId:'other-user'});
    expect(await otherUser.listRecords()).toEqual([]);expect(await otherUser.getDeviceId(()=> 'device-b')).toBe('device-b');
    store.pause();const restored=(await createOfflineOutbox(db)).activate(scope);
    expect(await restored.getDeviceId(()=> 'wrong')).toBe('device-a');expect(await restored.listRecords()).toHaveLength(1);
    await expect(session.listRecords()).rejects.toThrow('no longer active');
  });
  it('migrates v2 without discarding pending operations or delivery metadata',async()=>{
    const {session,sqlite,db,store}=await setup();await session.enqueue(operation(),{name:'pending'});store.pause();
    sqlite.exec('DROP TABLE offline_attachment_refs; DROP TABLE offline_attachments; ALTER TABLE offline_operations DROP COLUMN attachment_ids_json; ALTER TABLE offline_operations DROP COLUMN history_backed_up; ALTER TABLE offline_operations DROP COLUMN continuation_json; DROP TABLE offline_rebase_history; DROP TABLE offline_records; DROP TABLE offline_devices; DROP TABLE offline_fleet_downloads; DROP TABLE offline_fleet_download_members; PRAGMA user_version=2;');
    const migrated=(await createOfflineOutbox(db)).activate(scope);
    expect(await migrated.list()).toHaveLength(1);expect(await migrated.listRecords()).toEqual([]);
    expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({user_version:7});
  });
  it('commits canonical raw data and completion together, without downgrading a newer download',async()=>{
    const {session,sqlite}=await setup();await session.enqueue(operation(),{name:'pending'});const {attempt}=(await session.claimNext('token',0))!;
    sqlite.exec("CREATE TRIGGER fail_raw BEFORE INSERT ON offline_records BEGIN SELECT RAISE(FAIL, 'disk full'); END;");
    await expect(session.finishAttempt(attempt,{kind:'applied',receivedAt,revision:'2',record:rawVehicle})).rejects.toThrow('disk full');
    expect((await session.list())[0].status).toBe('syncing');expect(await session.listRecords()).toEqual([]);
    sqlite.exec('DROP TRIGGER fail_raw');
    const newest={...rawVehicle,notes:'newer server edit'};await session.putRecord('vehicle',rawVehicle.id,{revision:'4',record:newest});
    await session.finishAttempt(attempt,{kind:'applied',receivedAt,revision:'2',record:rawVehicle});
    expect((await session.list())[0]).toMatchObject({status:'synced',receipt:{revision:'4',record:newest}});
    expect(await session.getProjection('vehicle',rawVehicle.id)).toMatchObject({operationId:null,record:newest});
  });
});

async function detailSetup(offline=true,path=':memory:'){
  const fixture=await setup(path);await fixture.session.putRecord('vehicle',rawVehicle.id,{revision:'1',record:rawVehicle});
  let sequence=0;let allowed=true;let disconnected=offline;let reads=0;let notices=0;
  const editor=createOfflineDetailEditor({session:fixture.session,canEdit:()=>allowed,offline:()=>disconnected,id:()=>`id-${++sequence}`,now:()=>receivedAt,
    readRecord:async()=>{reads++;return {revision:'2',record:{...rawVehicle,notes:'fresh'}}},changed:async()=>{notices++}});
  return {...fixture,editor,disallow:()=>{allowed=false},setOffline:(value:boolean)=>{disconnected=value},reads:()=>reads,notices:()=>notices};
}
async function blockedLaterEdit(){
  const fixture=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
  await fixture.editor.save(await fixture.editor.prepare(target),{notes:'one'});
  const child=await fixture.editor.save(await fixture.editor.prepare(target),{notes:'two'});
  const parent=(await fixture.session.claimNext('parent',0))!;
  await fixture.session.finishAttempt(parent.attempt,{kind:'applied',receivedAt,revision:'3',record:{...rawVehicle,notes:'Shared value'}});
  await fixture.session.materializeContinuations();return {...fixture,child,target};
}
async function oldCompletedHistory(path=':memory:'){
  const f=await detailSetup(true,path);const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
  await f.editor.save(await f.editor.prepare(target),{notes:'Parent'});const child=await f.editor.save(await f.editor.prepare(target),{unit:'Later unit'});
  const parent=(await f.session.claimNext('parent',0))!;const parentRecord={...rawVehicle,notes:'Parent'};
  await f.session.finishAttempt(parent.attempt,{kind:'applied',receivedAt,revision:'2',record:parentRecord});await f.session.materializeContinuations();
  const next=(await f.session.claimNext('old-child',0))!;const proof={kind:'applied' as const,receivedAt,revision:'3',record:{...parentRecord,unit:'Later unit'}};
  await f.session.finishAttempt(next.attempt,proof);return {...f,child,proof};
}
function recoveryWorker(session:OfflineOutboxSession,proof:unknown){
  const transport={deliver:vi.fn(),canonical:vi.fn(),outcome:vi.fn(),backfillHistory:vi.fn().mockResolvedValue(proof)};
  const worker=createOfflineSyncWorker({session,transport,canAccess:()=>true,canRun:()=>true,canReadRecords:()=>true,token:()=> 'unused'});cleanup.push(()=>worker.stop());return {worker,transport};
}
describe('older-build device history recovery',()=>{
  it('upgrades real v4 storage, recovers dismissed completed history and retains confirmation across close/reopen',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'fireops-history-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'history.db');const old=await oldCompletedHistory(path);
    old.editor.dispose();old.store.pause();old.sqlite.exec('DROP TABLE offline_attachment_refs; DROP TABLE offline_attachments; ALTER TABLE offline_operations DROP COLUMN attachment_ids_json; UPDATE offline_operations SET notice_dismissed=1; ALTER TABLE offline_operations DROP COLUMN history_backed_up; DROP TABLE offline_fleet_downloads; DROP TABLE offline_fleet_download_members; PRAGMA user_version=4;');old.close();
    const reopened=database(path);const upgraded=await createOfflineOutbox(reopened.db);const session=upgraded.activate(scope);expect((await session.list())[1]).toMatchObject({status:'synced',noticeDismissed:true,historyBackupPending:true});expect(await upgraded.countUnresolvedForUser(scope.userId)).toBe(1);expect(offlineSyncVisible((await session.list())[1])).toBe(true);
    const {worker,transport}=recoveryWorker(session,old.proof);await worker.wake();expect(transport.deliver).not.toHaveBeenCalled();expect(transport.backfillHistory).toHaveBeenCalledOnce();expect(await upgraded.countUnresolvedForUser(scope.userId)).toBe(0);
    const saved=(await session.list())[1];expect(saved.historyBackupPending).toBe(false);expect(saved.operation.operationId).toBe(old.child.operation.operationId);worker.stop();upgraded.pause();reopened.close();
    const last=database(path);const restored=(await createOfflineOutbox(last.db)).activate(scope);expect((await restored.list())[1].historyBackupPending).toBe(false);
  });
  it.each(['PGRST202','42501','55000','22023'])('retains history and sign-out protection after %s without normal delivery',async code=>{
    const f=await oldCompletedHistory();const {worker,transport}=recoveryWorker(f.session,f.proof);transport.backfillHistory.mockRejectedValue({code});await worker.wake();
    expect(transport.deliver).not.toHaveBeenCalled();expect((await f.session.list())[1]).toMatchObject({status:'synced',historyBackupPending:true});expect(await f.store.countUnresolvedForUser(scope.userId)).toBe(1);expect(worker.getSnapshot().error).not.toBeNull();expect(offlineSyncNotice(worker.getSnapshot())?.dismissible).toBe(false);
    await f.session.dismissCompletedNotices();expect((await f.session.list())[1].noticeDismissed).toBe(false);
  });
  it('rolls back failed local confirmations and retries the exact retained history',async()=>{
    const f=await oldCompletedHistory();const {worker,transport}=recoveryWorker(f.session,f.proof);f.sqlite.exec("CREATE TRIGGER fail_history_ack BEFORE UPDATE OF history_backed_up ON offline_operations BEGIN SELECT RAISE(FAIL,'disk full'); END;");
    await worker.wake();expect((await f.session.list())[1].historyBackupPending).toBe(true);const first=transport.backfillHistory.mock.calls[0];f.sqlite.exec('DROP TRIGGER fail_history_ack');await worker.wake();expect(transport.backfillHistory.mock.calls[1][0]).toEqual(first[0]);expect(transport.backfillHistory.mock.calls[1][2]).toEqual(first[2]);expect((await f.session.list())[1].historyBackupPending).toBe(false);
  });
  it('upgrades v5 without losing history confirmations or business intent',async()=>{
    const f=await oldCompletedHistory();await f.session.confirmHistoryBackup(f.child.operation.operationId,await f.session.listRebases(f.child.operation.operationId),f.proof);const before=await f.session.list();f.editor.dispose();f.store.pause();
    f.sqlite.exec('DROP TABLE offline_attachment_refs; DROP TABLE offline_attachments; ALTER TABLE offline_operations DROP COLUMN attachment_ids_json; DROP TABLE offline_fleet_downloads; DROP TABLE offline_fleet_download_members; PRAGMA user_version=5;');const restored=(await createOfflineOutbox(f.db)).activate(scope);expect(await restored.list()).toEqual(before);expect(await restored.getFleetDownload()).toBeNull();expect(f.sqlite.prepare('PRAGMA user_version').get()).toEqual({user_version:7});
  });
  it('does not let one missing submission prevent other history backups',async()=>{
    const f=await oldCompletedHistory();const id=f.child.operation.operationId;
    f.sqlite.prepare(`INSERT INTO offline_operations(user_id,company_id,operation_id,entity_type,entity_id,operation_json,projection_json,status,attempts,receipt_json,continuation_json)
      SELECT user_id,company_id,'extra-child',entity_type,entity_id,replace(operation_json,?,'extra-child'),projection_json,status,attempts,receipt_json,continuation_json FROM offline_operations WHERE operation_id=?`).run(id,id);
    f.sqlite.prepare(`INSERT INTO offline_rebase_history(user_id,company_id,operation_id,before_json,after_json,reason,created_at)
      SELECT user_id,company_id,'extra-child',replace(before_json,?,'extra-child'),replace(after_json,?,'extra-child'),reason,created_at FROM offline_rebase_history WHERE operation_id=?`).run(id,id,id);
    const {worker,transport}=recoveryWorker(f.session,f.proof);transport.backfillHistory.mockRejectedValueOnce({code:'55000'});await worker.wake();
    expect(transport.backfillHistory).toHaveBeenCalledTimes(2);expect((await f.session.list())[2].historyBackupPending).toBe(false);expect(await f.store.countUnresolvedForUser(scope.userId)).toBe(1);expect(worker.getSnapshot().error).toContain('not replayed');expect(transport.deliver).not.toHaveBeenCalled();
  });
  it('ignores late recovery confirmation after pause and account replacement',async()=>{
    const f=await oldCompletedHistory();const {worker,transport}=recoveryWorker(f.session,f.proof);let resolve!:(value:unknown)=>void;transport.backfillHistory.mockReturnValue(new Promise(yes=>{resolve=yes}));const running=worker.wake();await vi.waitFor(()=>expect(transport.backfillHistory).toHaveBeenCalledOnce());worker.pause();const other=f.store.activate({...scope,userId:'other'});resolve(f.proof);await running;expect(await other.list()).toEqual([]);expect(await f.store.countUnresolvedForUser(scope.userId)).toBe(1);
  });
  it('rejects altered history confirmation without changing completed wire intent',async()=>{
    const f=await oldCompletedHistory();const history=await f.session.listRebases(f.child.operation.operationId);history[0].createdAt='2026-02-01T00:00:00Z';
    await expect(f.session.confirmHistoryBackup(f.child.operation.operationId,history,f.proof)).rejects.toThrow('History changed');expect((await f.session.list())[1].historyBackupPending).toBe(true);
  });
});

describe('explicit local continuation rebase',()=>{
  it('requires every field choice and rejects stale canonical review snapshots',async()=>{
    const f=await blockedLaterEdit();const review=await f.editor.prepareRebase(f.child.operation.operationId);
    expect(review.fields.notes).toEqual({before:{present:true,value:'one'},saved:{present:true,value:'two'},current:{present:true,value:'Shared value'}});
    await expect(f.editor.rebase(review,{})).rejects.toThrow('every saved field');
    await f.session.putRecord('vehicle',rawVehicle.id,{revision:'4',record:{...rawVehicle,notes:'New shared value'}});
    await expect(f.editor.rebase(review,{notes:'saved'})).rejects.toThrow('stale');expect((await f.session.list())[1].attempts).toBe(0);
  });
  it('preserves discarded values in history and creates a legitimate fresh no-op when current is selected',async()=>{
    const f=await blockedLaterEdit();const review=await f.editor.prepareRebase(f.child.operation.operationId);const rebased=await f.editor.rebase(review,{notes:'current'});
    expect(rebased.operation).toMatchObject({operationId:f.child.operation.operationId,dependsOn:[],mutation:{baseRevision:'3',base:{notes:'Shared value'},patch:{}}});
    expect(rebased.continuation).toMatchObject({phase:'ready',explicit:true});expect(rebased.projection).toMatchObject({notes:'Shared value'});
    const history=await f.session.listRebases(f.child.operation.operationId);expect(history[0].before.mutation).toMatchObject({patch:{notes:{value:'two'}}});expect(history[0].reason).toContain('current');
    const claimed=(await f.session.claimNext('child',0))!;expect(claimed.entry.operation.operationId).toBe(f.child.operation.operationId);
    expect((await f.editor.rebase(review,{notes:'current'})).attempts).toBe(1);expect(await f.session.listRebases(f.child.operation.operationId)).toHaveLength(1);
    await expect(f.editor.rebase(review,{notes:'saved'})).rejects.toThrow('not awaiting');
  });
  it('chooses saved values only over the verified raw base and leaves original provenance intact',async()=>{
    const f=await blockedLaterEdit();const review=await f.editor.prepareRebase(f.child.operation.operationId);const rebased=await f.editor.rebase(review,{notes:'saved'});
    expect(rebased.operation.mutation).toMatchObject({baseRevision:'3',base:{notes:'Shared value'},patch:{notes:{value:'two'}}});expect(rebased.operation.provenance).toEqual(f.child.operation.provenance);
  });
  it('rejects borrowed or mutated review objects instead of changing an unseen intent',async()=>{
    const f=await blockedLaterEdit();const review=await f.editor.prepareRebase(f.child.operation.operationId);
    await expect(f.editor.rebase({...review},{notes:'saved'})).rejects.toThrow('Reload');
    (review.current as {revision:string}).revision='999';await expect(f.editor.rebase(review,{notes:'saved'})).rejects.toThrow('Reload');
  });
  it('rolls back local choices, dependency removal, history and projection together',async()=>{
    const f=await blockedLaterEdit();const review=await f.editor.prepareRebase(f.child.operation.operationId);
    f.sqlite.exec("CREATE TRIGGER fail_choice BEFORE UPDATE ON offline_projections BEGIN SELECT RAISE(FAIL,'disk full'); END;");
    await expect(f.editor.rebase(review,{notes:'current'})).rejects.toThrow('disk full');expect(await f.session.listRebases(f.child.operation.operationId)).toEqual([]);
    expect((await f.session.list())[1]).toMatchObject({status:'blocked',continuation:{phase:'waiting'}});expect(await f.session.claimNext('no',0)).toBeNull();
  });
  it('explicitly severs rejected-parent dependencies without resubmitting its discarded fields',async()=>{
    const f=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};const parent=await f.editor.save(await f.editor.prepare(target),{notes:'Discarded parent note'});
    const child=await f.editor.save(await f.editor.prepare(target),{unit:'Later unit'});const claimed=(await f.session.claimNext('parent',0))!;
    await f.session.recordDelivery(claimed.attempt,{kind:'awaiting_review',receivedAt,conflictId:'conflict'});
    await f.session.recordReviewOutcome(parent.operation.operationId,{kind:'reviewed',operationId:parent.operation.operationId,decisionId:'decision',conflictId:'conflict',decidedAt:receivedAt,revision:'2',outcome:'not_selected',keptFields:[],discardedFields:['notes']});
    await f.session.finishReview(parent.operation.operationId,{revision:'2',record:{...rawVehicle,notes:'Shared note'}});await f.session.materializeContinuations();
    const review=await f.editor.prepareRebase(child.operation.operationId);const rebased=await f.editor.rebase(review,{unit:'saved'});
    expect(rebased.operation.mutation).toMatchObject({base:{notes:'Shared note'},patch:{unit:{value:'Later unit'}}});expect(rebased.operation.dependsOn).toEqual([]);expect((await f.session.claimNext('later',0))!.entry.operation.operationId).toBe(child.operation.operationId);
  });
  it('does not revive a deleted record through local rebase',async()=>{
    const f=await blockedLaterEdit();await f.session.putRecord('vehicle',rawVehicle.id,{revision:'4',record:null});await expect(f.editor.prepareRebase(f.child.operation.operationId)).rejects.toThrow('deleted');
  });
});

describe('atomic native detail-edit boundary',()=>{
  it('saves three offline edits, including a revert, then rebases each against verified parent results',async()=>{
    const {editor,session}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    const first=await editor.save(await editor.prepare(target),{notes:'one'});
    const secondDraft=await editor.prepare(target);expect(secondDraft.record.notes).toBe('one');
    const second=await editor.save(secondDraft,{notes:'base'});
    const third=await editor.save(await editor.prepare(target),{plate:'AA'});
    expect(second.continuation).toEqual({parentId:first.operation.operationId,phase:'waiting'});
    let current={revision:'1',record:{...rawVehicle} as SyncRecord};const history=new Map([['1',current.record]]);const sent:SyncOperation[]=[];
    const worker=createOfflineSyncWorker({session,canAccess:()=>true,canRun:()=>true,token:()=>`token-${sent.length}`,transport:{
      async deliver(operation){sent.push(operation);if(operation.mutation.kind!=='update')throw new Error('wrong kind');expect(operation.mutation.base).toEqual(history.get(operation.mutation.baseRevision));
        const patch=operation.mutation.patch;const record={...current.record};for(const [key,value] of Object.entries(patch)){if(value.present)record[key]=value.value;else delete record[key]}
        current={revision:String(Number(current.revision)+1),record};history.set(current.revision,record);return {kind:'applied',receivedAt,...current};},
      async canonical(){if(current.revision==='2'){current={revision:'3',record:{...current.record,unit:'Remote unit'}};history.set('3',current.record)}return current},outcome:async()=>null,
    }});cleanup.push(()=>worker.stop());await worker.resume();
    expect(sent).toHaveLength(3);expect((await session.list()).every(row=>row.status==='synced')).toBe(true);expect(current.record).toMatchObject({notes:'base',plate:'AA',unit:'Remote unit'});
    expect((await session.listRebases(second.operation.operationId))[0]).toMatchObject({reason:'automatic_independent',after:{mutation:{baseRevision:'3'}}});
    expect((await session.listRebases(third.operation.operationId))[0].before.provenance).toEqual(third.operation.provenance);
    expect((await editor.save(secondDraft,{notes:'base'})).status).toBe('synced');expect(await session.list()).toHaveLength(3);
  });
  it('never claims a local continuation before canonical materialization, even after parent status changes',async()=>{
    const {editor,session}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    await editor.save(await editor.prepare(target),{notes:'one'});const child=await editor.save(await editor.prepare(target),{notes:'two'});
    const root=(await session.claimNext('root',0))!;await session.finishAttempt(root.attempt,{kind:'applied',receivedAt,revision:'2',record:{...rawVehicle,notes:'one'}});
    expect(await session.claimNext('must-not-send-local-base',0)).toBeNull();expect(child.attempts).toBe(0);
    await session.materializeContinuations();expect((await session.claimNext('child',0))!.entry.operation.mutation).toMatchObject({baseRevision:'2',base:{notes:'one'},patch:{notes:{value:'two'}}});
  });
  it('blocks overlapping canonical changes without silently promoting them to a fresh base',async()=>{
    const {editor,session}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    await editor.save(await editor.prepare(target),{notes:'one'});const child=await editor.save(await editor.prepare(target),{notes:'two'});
    const root=(await session.claimNext('root',0))!;await session.finishAttempt(root.attempt,{kind:'applied',receivedAt,revision:'3',record:{...rawVehicle,notes:'Another editor'}});
    await session.materializeContinuations();expect((await session.list())[1]).toMatchObject({status:'blocked',attempts:0,continuation:{phase:'waiting'}});
    expect(await session.retryBlocked(child.operation.operationId)).toBe(false);expect(await session.claimNext('no',0)).toBeNull();expect(await session.listRebases(child.operation.operationId)).toEqual([]);
  });
  it('requires explicit rebase after parent rejection and preserves all later values',async()=>{
    const {editor,session}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    const root=await editor.save(await editor.prepare(target),{notes:'one'});const child=await editor.save(await editor.prepare(target),{unit:'Later unit'});
    const claimed=(await session.claimNext('root',0))!;await session.recordDelivery(claimed.attempt,{kind:'awaiting_review',receivedAt,conflictId:'conflict'});
    await session.recordReviewOutcome(root.operation.operationId,{kind:'reviewed',operationId:root.operation.operationId,decisionId:'decision',conflictId:'conflict',decidedAt:receivedAt,revision:'2',outcome:'not_selected',keptFields:[],discardedFields:['notes']});
    await session.finishReview(root.operation.operationId,{revision:'2',record:rawVehicle});await session.materializeContinuations();
    const later=(await session.list())[1];expect(later.status).toBe('blocked');expect(later.projection).toMatchObject({unit:'Later unit'});expect(later.operation).toEqual(child.operation);expect(await session.claimNext('no',0)).toBeNull();
  });
  it('rolls back materialization and its audit together when storage fails',async()=>{
    const {editor,session,sqlite}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    await editor.save(await editor.prepare(target),{notes:'one'});const child=await editor.save(await editor.prepare(target),{notes:'two'});const root=(await session.claimNext('root',0))!;
    await session.finishAttempt(root.attempt,{kind:'applied',receivedAt,revision:'2',record:{...rawVehicle,notes:'one'}});
    sqlite.exec("CREATE TRIGGER fail_rebase BEFORE INSERT ON offline_rebase_history BEGIN SELECT RAISE(FAIL,'disk full'); END;");
    await expect(session.materializeContinuations()).rejects.toThrow('disk full');expect((await session.list())[1].continuation?.phase).toBe('waiting');expect(await session.listRebases(child.operation.operationId)).toEqual([]);
  });
  it('rejects stale sibling saves instead of branching around an intervening local edit',async()=>{
    const {editor,session}=await detailSetup();const target={entityType:'vehicle' as const,entityId:rawVehicle.id};await editor.save(await editor.prepare(target),{notes:'one'});
    const a=await editor.prepare(target);const b=await editor.prepare(target);await editor.save(a,{notes:'two'});
    await expect(editor.save(b,{notes:'other'})).rejects.toThrow('changed locally');expect(await session.list()).toHaveLength(2);
  });
  it('can explicitly use an owned verified download during a server outage without claiming an offline connection state',async()=>{
    const {editor,reads}=await detailSetup(false);const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id},{downloadedOnly:true});
    expect(reads()).toBe(0);expect(draft.revision).toBe('1');expect((await editor.save(draft,{notes:'During outage'})).operation.provenance.connectivity).toBe('online');
    await expect(editor.prepare({entityType:'issue',entityId:'never-downloaded'},{downloadedOnly:true})).rejects.toThrow('online once');
  });
  it('publishes permission-denied cache removal and cannot use that base through the downloaded-only path',async()=>{
    const {session}=await setup();await session.putRecord('vehicle',rawVehicle.id,{revision:'1',record:rawVehicle});const published:unknown[]=[];
    const editor=createOfflineDetailEditor({session,canEdit:()=>true,offline:()=>false,id:()=> 'id',changed:async()=>{},downloaded:async()=>{published.push(await session.listRecords())},readRecord:async()=>{throw {code:'42501'}}});
    await expect(editor.prepare({entityType:'vehicle',entityId:rawVehicle.id})).rejects.toMatchObject({code:'42501'});expect(published).toEqual([[]]);
    await expect(editor.prepare({entityType:'vehicle',entityId:rawVehicle.id},{downloadedOnly:true})).rejects.toThrow('online once');
  });
  it('reserves a record against in-flight legacy writes before atomic enqueue, with stable retry identity',async()=>{
    const {session}=await setup();await session.putRecord('vehicle',rawVehicle.id,{revision:'1',record:rawVehicle});let sequence=0;
    const gate=createFleetEditGate(session,()=>true);const target={entityType:'vehicle' as const,entityId:rawVehicle.id};
    const editor=createOfflineDetailEditor({session,canEdit:()=>true,offline:()=>true,id:()=>`id-${++sequence}`,changed:async()=>{},readRecord:async()=>null,reserve:(target,owner)=>gate.acquire([target],owner)});
    const draft=await editor.prepare(target);const release=await gate.legacy([target],'legacy');
    await expect(editor.save(draft,{notes:'mine'})).rejects.toThrow('progress');expect(await session.list()).toEqual([]);release();
    expect((await editor.save(draft,{notes:'mine'})).operation.operationId).toBe('id-2');
    await expect(gate.legacy([target],'later legacy')).rejects.toThrow('must sync');
  });
  it('bounds a stuck verified download even if session restoration ignores abort',async()=>{
    const {session}=await setup();const readRecord=vi.fn(()=>new Promise(()=>{}));
    const editor=createOfflineDetailEditor({session,canEdit:()=>true,offline:()=>false,id:()=> 'device',changed:async()=>{},readRecord});
    const rejected=expect(editor.prepare({entityType:'vehicle',entityId:rawVehicle.id})).rejects.toThrow('interrupted');
    await vi.waitFor(()=>expect(readRecord).toHaveBeenCalledOnce());editor.dispose();await rejected;expect(await session.listRecords()).toEqual([]);
  });
  it('retains a saved edit and verified base across file close/reopen, then reconciles on reconnect',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'fireops-details-'));cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
    const path=join(directory,'details.db');const first=database(path);const old=(await createOfflineOutbox(first.db)).activate(scope);
    await old.putRecord('vehicle',rawVehicle.id,{revision:'1',record:rawVehicle});let id=0;
    const editor=createOfflineDetailEditor({session:old,canEdit:()=>true,offline:()=>true,id:()=>`saved-${++id}`,now:()=>receivedAt,
      readRecord:async()=>{throw new Error('must not read offline')},changed:async()=>{throw new Error('notice refresh failed')}});
    const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    const form=offlineDetailFormValues(draft);form.notes='mine';const saved=await editor.save(draft,offlineDetailFormChanges(draft,form));
    editor.dispose();first.close();const restored=(await createOfflineOutbox(database(path).db)).activate(scope);
    expect((await restored.list())[0].operation).toEqual(saved.operation);expect((await restored.listRecords())[0].record).toEqual(rawVehicle);
    expect(await restored.getDeviceId(()=> 'wrong')).toBe('saved-1');
    const preview=projectOfflineFleet([],{scope,loaded:true,offline:true,records:await restored.listRecords(),entries:await restored.list()});
    expect(preview.records[0].record).toMatchObject({notes:'mine',status:'Ready'});expect(preview.pending['vehicle:vehicle-1']).toContain('Local proposal');
    const canonical={revision:'2',record:{...rawVehicle,notes:'mine',status:'Out of service'}};
    const worker=createOfflineSyncWorker({session:restored,canAccess:()=>true,canRun:()=>true,token:()=> 'attempt',
      transport:{deliver:async operation=>{expect(operation).toEqual(saved.operation);return {kind:'applied',receivedAt,...canonical}},canonical:async()=>canonical,outcome:async()=>null}});
    cleanup.push(()=>worker.stop());await worker.resume();expect((await restored.list())[0].status).toBe('synced');
    expect((await restored.listRecords())[0]).toMatchObject(canonical);expect(await restored.getProjection('vehicle',rawVehicle.id)).toMatchObject({operationId:null,record:canonical.record});
    const confirmed=projectOfflineFleet([],{scope,loaded:true,offline:false,records:await restored.listRecords(),entries:await restored.list()});
    expect(confirmed.records[0].record).toEqual(canonical.record);expect(confirmed.pending).toEqual({});
  });
  it('validates issue priority and queues only changed issue scalar fields',async()=>{
    const {editor,session}=await detailSetup();const issue={id:'issue-1',title:'Pump leak',description:'Inspect pump',priority:'Low',vehicleId:rawVehicle.id,status:'Open'};
    await session.putRecord('issue',issue.id,{revision:'3',record:issue});const draft=await editor.prepare({entityType:'issue',entityId:issue.id});
    await expect(editor.save(draft,{priority:'Urgent'})).rejects.toThrow('priority');
    const entry=await editor.save(draft,{title:issue.title,description:'Leak confirmed',priority:'High'});
    expect(entry.operation.mutation).toEqual({kind:'update',baseRevision:'3',base:issue,patch:{description:{present:true,value:'Leak confirmed'},priority:{present:true,value:'High'}}});
  });
  it('saves offline intent and local projection using complete verified base, not display-normalized data',async()=>{
    const {editor,session,reads,notices}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    (draft.record as {notes:string}).notes='tampered display';const entry=await editor.save(draft,{notes:'my edit'});
    expect(reads()).toBe(0);expect(notices()).toBe(1);
    expect(entry.operation).toMatchObject({provenance:{connectivity:'offline',savedAt:receivedAt,deviceId:'id-1'},mutation:{kind:'update',baseRevision:'1',base:rawVehicle,patch:{notes:{present:true,value:'my edit'}}}});
    expect(await session.getProjection('vehicle',rawVehicle.id)).toMatchObject({record:{...rawVehicle,notes:'my edit'}});
  });
  it('fetches authoritative POST data online before capturing a base',async()=>{
    const {editor,reads}=await detailSetup(false);const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    expect(draft).toMatchObject({revision:'2',record:{notes:'fresh'}});expect(reads()).toBe(1);
    expect((await editor.save(draft,{notes:'mine'})).operation.provenance.connectivity).toBe('online');
  });
  it('requires a previously verified, non-deleted record offline',async()=>{
    const {editor,session}=await detailSetup();await expect(editor.prepare({entityType:'issue',entityId:'unknown'})).rejects.toThrow('online once');
    await session.putRecord('vehicle',rawVehicle.id,{revision:'2',record:null});await expect(editor.prepare({entityType:'vehicle',entityId:rawVehicle.id})).rejects.toThrow('deleted');
  });
  it('rejects unsupported fields and invalid values without saving anything',async()=>{
    const {editor,session}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    for(const values of [{status:'Out of service'},{year:24},{unit:''},{notes:null},{notes:'x'.repeat(10001)},{notes:undefined}])await expect(editor.save(draft,values as unknown as SyncRecord)).rejects.toThrow();
    await expect(editor.save(draft,{notes:'base'})).rejects.toThrow('No detail changes');expect(await session.list()).toEqual([]);
  });
  it('deduplicates concurrent saves and refuses changed retry payloads',async()=>{
    const {editor,session}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    const [one,two]=await Promise.all([editor.save(draft,{notes:'mine'}),editor.save(draft,{notes:'mine'})]);
    expect(one.operation.operationId).toBe(two.operation.operationId);expect(await session.list()).toHaveLength(1);
    await expect(editor.save(draft,{notes:'different'})).rejects.toThrow('original values');
  });
  it('allows a fresh verified edit after rejection, without automatically retrying rejected intent',async()=>{
    const {editor,session}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});const saved=await editor.save(draft,{notes:'rejected'});
    const claimed=(await session.claimNext('attempt',0))!;await session.recordDelivery(claimed.attempt,{kind:'awaiting_review',receivedAt,conflictId:'conflict'});
    await session.recordReviewOutcome(saved.operation.operationId,{kind:'reviewed',operationId:saved.operation.operationId,decisionId:'decision',conflictId:'conflict',decidedAt:receivedAt,revision:'2',outcome:'not_selected',keptFields:[],discardedFields:['notes']});
    const current={...rawVehicle,notes:'manager choice'};await session.finishReview(saved.operation.operationId,{revision:'2',record:current});
    const fresh=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});expect(fresh.record).toEqual(current);
    const next=await editor.save(fresh,{notes:'explicit new edit'});const nextClaim=(await session.claimNext('next',0))!;
    expect(nextClaim.entry.operation.operationId).toBe(next.operation.operationId);expect((await session.list())[0].status).toBe('not_selected');
  });
  it('atomically rejects a second independent edit until the first is resolved',async()=>{
    const {editor,session}=await detailSetup();const one=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});const two=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    const result=await Promise.allSettled([editor.save(one,{notes:'one'}),editor.save(two,{notes:'two'})]);
    expect(result.filter(item=>item.status==='fulfilled')).toHaveLength(1);expect(await session.list()).toHaveLength(1);
    expect((await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id})).pendingParentId).toBe((await session.list())[0].operation.operationId);
  });
  it('retries the exact same intent after a transaction rollback',async()=>{
    const {editor,sqlite,session}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    sqlite.exec("CREATE TRIGGER fail_detail BEFORE INSERT ON offline_projections BEGIN SELECT RAISE(FAIL,'disk full'); END;");
    await expect(editor.save(draft,{notes:'mine'})).rejects.toThrow('disk full');expect(await session.list()).toEqual([]);
    sqlite.exec('DROP TRIGGER fail_detail');expect((await editor.save(draft,{notes:'mine'})).operation.operationId).toBe('id-2');
  });
  it('rejects borrowed drafts, account changes and disposed editors',async()=>{
    const {editor,session,store,disallow}=await detailSetup();const draft=await editor.prepare({entityType:'vehicle',entityId:rawVehicle.id});
    await expect(editor.save({...draft},{notes:'mine'})).rejects.toThrow('Reload verified');
    disallow();await expect(editor.save(draft,{notes:'mine'})).rejects.toThrow('permissions');
    expect(await session.list()).toEqual([]);store.activate({...scope,userId:'other'});await expect(editor.prepare({entityType:'vehicle',entityId:rawVehicle.id})).rejects.toThrow();
    editor.dispose();await expect(editor.save(draft,{notes:'mine'})).rejects.toThrow();
  });
});
