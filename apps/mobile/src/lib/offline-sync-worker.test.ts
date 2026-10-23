import {createOfflineDetailEditor} from './offline-detail-editor';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SyncOperation,SyncReviewOutcome} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineSyncWorker,offlineSyncEntryLabel,offlineSyncNotice,offlineSyncVisible,type OfflineSyncWorker} from './offline-sync-worker';

const scope={userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001'};
const entity='30000000-0000-4000-8000-000000000001';
const operationId='40000000-0000-4000-8000-000000000001';
const date='2026-01-01T12:00:00.000Z';
const base={id:entity,unit:'Engine 1',notes:'Old'};
const accepted={kind:'applied' as const,receivedAt:date,revision:'2',record:{...base,notes:'Submitted'}};
const canonical={revision:'3',record:{...base,notes:'Latest shared value'}};
const pending={kind:'awaiting_review' as const,receivedAt:date,conflictId:'50000000-0000-4000-8000-000000000001'};
const outcome=(kind:SyncReviewOutcome['outcome']='kept'):SyncReviewOutcome=>({kind:'reviewed',decisionId:'60000000-0000-4000-8000-000000000001',conflictId:pending.conflictId,operationId,decidedAt:date,revision:'3',outcome:kind,keptFields:kind==='not_selected'?[]:['notes'],discardedFields:kind==='not_selected'?['notes']:kind==='partially_kept'?['vin']:[]});
const op=():SyncOperation=>({schemaVersion:1,operationId,companyId:scope.companyId,entityType:'vehicle',entityId:entity,provenance:{userId:scope.userId,deviceId:'device-1',savedAt:date,connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:'1',base,patch:{notes:{present:true,value:'Submitted'}}}});
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();vi.useRealTimers()});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
async function setup(operation=op()){
  const sqlite=new DatabaseSync(':memory:');cleanups.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={
    async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...params){return {changes:Number(sqlite.prepare(sql).run(...params).changes)}},
    async getFirstAsync<T>(sql:string,...params:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...params) as T|undefined)??null},
    async getAllAsync<T>(sql:string,...params:OutboxSqlValue[]){return sqlite.prepare(sql).all(...params) as T[]},
  };
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(task){sqlite.exec('BEGIN IMMEDIATE');try{await task(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);let session=store.activate(scope);
  await session.enqueue(operation,{...base,notes:'Submitted'});
  const transport={deliver:vi.fn().mockResolvedValue(accepted),canonical:vi.fn().mockResolvedValue(canonical),outcome:vi.fn().mockResolvedValue(null),readRecord:vi.fn().mockResolvedValue(canonical)};
  const mode={online:true,foreground:true,access:true,read:false};let time=0;let token=0;
  const make=(nextSession=session)=>{const worker=createOfflineSyncWorker({session:nextSession,transport,canAccess:()=>mode.access,canRun:()=>mode.online&&mode.foreground,canReadRecords:()=>mode.read,token:()=>`attempt-${++token}`,now:()=>time,timeoutMs:1000});cleanups.push(()=>worker.stop());return worker};
  const worker=make();
  return {sqlite,store,transport,mode,worker,get session(){return session},advance(value:number){time+=value},restart(){worker.stop();session=store.activate(scope);return make(session)}};
}
async function entry(fixture:Awaited<ReturnType<typeof setup>>){return (await fixture.session.list())[0]}

async function stageChild(f:Awaited<ReturnType<typeof setup>>){
  await f.session.putRecord('vehicle',entity,{revision:'1',record:base});
  const editor=createOfflineDetailEditor({session:f.session,readRecord:f.transport.readRecord,canEdit:()=>true,offline:()=>true,id:()=> '40000000-0000-4000-8000-000000000002',changed:async()=>{}});
  cleanups.push(()=>editor.dispose());return editor.save(await editor.prepare({entityType:'vehicle',entityId:entity}),{unit:'Later unit'});
}
describe('native durable sync worker (real SQLite, no native UI)',()=>{
  it('retries an unavailable history endpoint with unchanged operation and history, never claiming synced early',async()=>{
    const f=await setup();await stageChild(f);const childResult={...accepted,revision:'4',record:{...canonical.record,unit:'Later unit'}};
    f.transport.deliver.mockResolvedValueOnce(accepted).mockRejectedValueOnce({code:'PGRST202'}).mockResolvedValue(childResult);f.transport.canonical.mockResolvedValueOnce(canonical).mockResolvedValue(childResult);
    await f.worker.wake();const waiting=(await f.session.list())[1];expect(waiting.status).toBe('pending');expect(waiting.delivery).toBeNull();expect(f.worker.getSnapshot().setupPending).toBe(true);
    const first=f.transport.deliver.mock.calls[1];expect(first[2]).toEqual(await f.session.listRebases(waiting.operation.operationId));expect(first[2]).toHaveLength(1);
    f.advance(3000);await f.worker.wake();const retried=f.transport.deliver.mock.calls[2];expect(retried[0]).toEqual(first[0]);expect(retried[2]).toEqual(first[2]);expect((await f.session.list())[1].status).toBe('synced');
  });
  it('fails closed when a ready continuation has lost its history',async()=>{
    const f=await setup();await stageChild(f);const root=(await f.session.claimNext('manual-parent',0))!;await f.session.finishAttempt(root.attempt,{kind:'applied',receivedAt:date,...canonical});await f.session.materializeContinuations();
    f.sqlite.exec('DELETE FROM offline_rebase_history');await f.worker.wake();expect(f.transport.deliver).not.toHaveBeenCalled();expect((await f.session.list())[1].status).not.toBe('synced');expect(await f.store.countUnresolvedForUser(scope.userId)).toBe(1);
  });
  it('publishes scoped raw records for the read model, but not after manager access is withdrawn',async()=>{
    const f=await setup();f.mode.read=true;await f.worker.wake();expect(f.worker.getSnapshot().records[0]).toMatchObject(canonical);
    f.mode.read=false;await f.worker.refresh();expect(f.worker.getSnapshot().records).toEqual([]);
  });
  it('refreshes previously downloaded bases after reconnect even without queued work',async()=>{
    const f=await setup();await f.worker.wake();f.transport.deliver.mockClear();f.mode.read=true;
    const latest={revision:'4',record:{...base,notes:'Latest download'}};f.transport.readRecord.mockResolvedValue(latest);
    await f.worker.resume();expect(f.transport.deliver).not.toHaveBeenCalled();expect((await f.session.listRecords())[0]).toMatchObject(latest);
    f.mode.online=false;f.worker.pause();await f.worker.wake();expect(f.transport.readRecord).toHaveBeenCalledTimes(1);
  });
  it('does not downgrade cached revisions and removes forbidden cached bases without fabricating deletions',async()=>{
    const f=await setup();await f.worker.wake();f.mode.read=true;f.transport.readRecord.mockResolvedValue({revision:'1',record:base});
    await f.worker.wake();expect((await f.session.listRecords())[0].revision).toBe('3');expect(f.worker.getSnapshot().error).not.toBeNull();
    f.transport.readRecord.mockRejectedValue({code:'42501'});await f.worker.wake();expect(await f.session.listRecords()).toEqual([]);
    expect((await entry(f)).status).toBe('synced');expect((await entry(f)).operation.mutation).toEqual(op().mutation);
  });
  it('does not upload offline/background, then confirms with a fresh record rather than the old receipt',async()=>{
    const f=await setup();f.mode.online=false;await f.worker.wake();expect(f.transport.deliver).not.toHaveBeenCalled();
    expect(offlineSyncNotice(f.worker.getSnapshot())?.message).toContain('waiting to sync');
    f.mode.online=true;f.mode.foreground=false;await f.worker.wake();expect(f.transport.deliver).not.toHaveBeenCalled();
    f.mode.foreground=true;await f.worker.wake();
    expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(1);
    expect(await f.session.getProjection('vehicle',entity)).toEqual({operationId:null,record:canonical.record});
    expect(offlineSyncNotice(f.worker.getSnapshot())?.message).toBe('Offline changes synced');
    await f.worker.dismiss();expect(offlineSyncNotice(f.worker.getSnapshot())).toBeNull();expect(await f.session.list()).toHaveLength(1);
  });
  it('coalesces wakeups instead of sending the same operation concurrently',async()=>{
    const f=await setup();const response=deferred<unknown>();f.transport.deliver.mockReturnValueOnce(response.promise);
    const first=f.worker.wake();const second=f.worker.wake();expect(second).toBe(first);
    await vi.waitFor(()=>expect(f.transport.deliver).toHaveBeenCalledTimes(1));response.resolve(accepted);await first;
    expect((await entry(f)).status).toBe('synced');
  });
  it('persists delivery across interrupted catch-up and restart, without re-uploading accepted work',async()=>{
    const f=await setup();f.transport.canonical.mockRejectedValueOnce(new Error('Network lost'));await f.worker.wake();
    expect(await entry(f)).toMatchObject({status:'pending',delivery:accepted});
    const restored=f.restart();f.advance(3000);await restored.wake();
    expect(f.transport.deliver).toHaveBeenCalledTimes(1);expect((await entry(f)).status).toBe('synced');
  });
  it.each(['inflight','accepted','retry'] as const)('resume recovers %s work even if the saved lease/retry clock is far in the future',async phase=>{
    const f=await setup();const old=await f.session.claimNext('old-process',10_000_000);
    if(phase==='accepted')await f.session.recordDelivery(old!.attempt,accepted);
    if(phase==='retry')await f.session.finishAttempt(old!.attempt,{kind:'retry',retryAt:10_000_000,error:'Old clock'});
    const restored=f.restart();const first=restored.resume();expect(restored.resume()).toBe(first);await first;
    expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(phase==='accepted'?0:1);
  });
  it('times out stuck requests, retains work and retries with the same operation ID',async()=>{
    const f=await setup();vi.useFakeTimers();f.transport.deliver.mockReturnValueOnce(new Promise(()=>{}));
    const running=f.worker.wake();await vi.waitFor(()=>expect(f.transport.deliver).toHaveBeenCalledTimes(1));await vi.advanceTimersByTimeAsync(1100);await running;
    expect(await entry(f)).toMatchObject({status:'pending',delivery:null});f.advance(3000);await f.worker.wake();
    expect(f.transport.deliver.mock.calls.map(call=>call[0].operationId)).toEqual([operationId,operationId]);
    expect((await entry(f)).status).toBe('synced');
  });
  it('ignores late responses after pause/account change and recovers the expired lease',async()=>{
    const f=await setup();const response=deferred<unknown>();f.transport.deliver.mockReturnValueOnce(response.promise);
    const running=f.worker.wake();await vi.waitFor(()=>expect(f.transport.deliver).toHaveBeenCalledTimes(1));f.mode.online=false;f.worker.pause();await running;
    response.resolve(accepted);await Promise.resolve();expect((await entry(f)).status).not.toBe('synced');expect((await entry(f)).delivery).toBeNull();
    f.mode.online=true;f.advance(60_001);await f.worker.wake();expect((await entry(f)).status).toBe('synced');
  });
  it('does not write a receipt into another account or scope after logout',async()=>{
    const f=await setup();const response=deferred<unknown>();f.transport.deliver.mockReturnValueOnce(response.promise);
    const running=f.worker.wake();await vi.waitFor(()=>expect(f.transport.deliver).toHaveBeenCalledTimes(1));
    f.mode.access=false;f.worker.stop();f.store.pause();const other=f.store.activate({...scope,userId:'other-user'});
    response.resolve(accepted);await running;expect(await other.list()).toEqual([]);
    const original=f.store.activate(scope);expect((await original.list())[0].status).not.toBe('synced');
  });
  it('uploads a conflict once, polls its decision and presents a truthful final notice',async()=>{
    const f=await setup();f.transport.deliver.mockResolvedValue(pending);await f.worker.wake();
    expect((await entry(f)).status).toBe('awaiting_review');expect(offlineSyncNotice(f.worker.getSnapshot())?.message).toContain('owner/admin review');
    f.transport.outcome.mockResolvedValue(outcome());await f.worker.wake();expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(1);
  });
  it('persists review results before catch-up and does not keep polling an already known decision',async()=>{
    const f=await setup();f.transport.deliver.mockResolvedValue(pending);await f.worker.wake();f.transport.outcome.mockResolvedValue(outcome());f.transport.canonical.mockRejectedValueOnce(new Error('Read failed'));
    await f.worker.wake();expect(await entry(f)).toMatchObject({status:'awaiting_review',reviewOutcome:outcome()});
    await f.worker.wake();expect(f.transport.outcome).toHaveBeenCalledTimes(1);expect((await entry(f)).status).toBe('synced');
  });
  it.each(['kept','not_selected'] as const)('can report a verified %s decision after demotion without inventing a readable/deleted record',async kind=>{
    const f=await setup();f.transport.deliver.mockResolvedValue(pending);await f.worker.wake();f.transport.outcome.mockResolvedValue(outcome(kind));f.transport.canonical.mockRejectedValue({code:'42501'});
    await f.worker.wake();expect((await entry(f)).status).toBe(kind==='kept'?'synced':'not_selected');expect(await f.session.getProjection('vehicle',entity)).toBeNull();
  });
  it('never retries the rejected part of a partly kept operation',async()=>{
    const original=op();if(original.mutation.kind!=='update')throw new Error('Expected update');
    const f=await setup({...original,mutation:{...original.mutation,patch:{...original.mutation.patch,vin:{present:true,value:'VIN-2'}}}});
    f.transport.deliver.mockResolvedValue(pending);await f.worker.wake();f.transport.outcome.mockResolvedValue(outcome('partially_kept'));await f.worker.wake();
    expect((await entry(f)).status).toBe('blocked');expect(offlineSyncEntryLabel(await entry(f))).toContain('some changes were kept');
    await f.worker.retry(operationId);await f.worker.wake();expect(f.transport.deliver).toHaveBeenCalledTimes(1);
    await f.worker.dismiss();expect(offlineSyncVisible(await entry(f))).toBe(false);
  });
  it('does not confirm stale, malformed or mismatched server reads',async()=>{
    const f=await setup();f.transport.canonical.mockResolvedValueOnce({revision:'1',record:base});await f.worker.wake();
    expect(await entry(f)).toMatchObject({status:'pending',delivery:accepted});expect((await f.session.getProjection('vehicle',entity))?.operationId).toBe(operationId);
    f.advance(3000);f.transport.canonical.mockResolvedValueOnce({revision:'3',record:{id:'other',notes:'Wrong'}});await f.worker.wake();expect((await entry(f)).status).not.toBe('synced');
    f.advance(5000);await f.worker.wake();expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(1);
  });
  it('handles an authoritative later deletion distinctly from an unreadable record',async()=>{
    const f=await setup();f.transport.canonical.mockResolvedValue({revision:'3',record:null});await f.worker.wake();
    expect((await entry(f)).status).toBe('synced');expect(await f.session.getProjection('vehicle',entity)).toEqual({operationId:null,record:null});
  });
  it('retains work when migrations are missing and skips re-upload after only the read RPC is missing',async()=>{
    const f=await setup();f.transport.deliver.mockRejectedValueOnce({code:'PGRST202'});await f.worker.wake();expect(f.worker.getSnapshot().setupPending).toBe(true);
    f.advance(3000);f.transport.canonical.mockRejectedValueOnce({code:'42883'});await f.worker.wake();expect((await entry(f)).delivery).toEqual(accepted);
    f.advance(5000);await f.worker.wake();expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(2);
  });
  it('blocks unsupported workflows and dependent edits instead of blindly replaying them',async()=>{
    const f=await setup({...op(),entityType:'activity',mutation:{kind:'create',record:base}});await f.worker.wake();expect((await entry(f)).status).toBe('blocked');expect(f.transport.deliver).not.toHaveBeenCalled();
    const second=await setup();await second.worker.wake();await second.session.enqueue({...op(),operationId:'child',dependsOn:[operationId]},base);await second.worker.wake();
    expect((await second.session.list())[1].status).toBe('blocked');expect(second.transport.deliver).toHaveBeenCalledTimes(1);
  });
  it('permission failure preserves the operation and only an explicit retry resends it',async()=>{
    const f=await setup();f.transport.deliver.mockRejectedValueOnce({code:'42501'});await f.worker.wake();expect((await entry(f)).status).toBe('blocked');
    await f.worker.wake();expect(f.transport.deliver).toHaveBeenCalledTimes(1);await f.worker.retry(operationId);await f.worker.wake();expect((await entry(f)).status).toBe('synced');
  });
  it('retains a receipt and avoids re-upload when committing the verified snapshot fails',async()=>{
    const f=await setup();f.sqlite.exec(`CREATE TRIGGER fail_confirm BEFORE UPDATE ON offline_operations WHEN NEW.status='synced' BEGIN SELECT RAISE(FAIL,'disk full'); END;`);
    await f.worker.wake();expect(await entry(f)).toMatchObject({status:'syncing',delivery:accepted});expect(f.worker.getSnapshot().error).toContain('storage');
    f.sqlite.exec('DROP TRIGGER fail_confirm');f.advance(60_001);await f.worker.wake();expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver).toHaveBeenCalledTimes(1);
  });
  it('retries the original operation ID if the server accepted work but acknowledgment storage failed',async()=>{
    const f=await setup();f.sqlite.exec(`CREATE TRIGGER fail_delivery BEFORE UPDATE ON offline_operations WHEN NEW.delivery_json IS NOT NULL BEGIN SELECT RAISE(FAIL,'disk full'); END;`);
    await f.worker.wake();expect(await entry(f)).toMatchObject({status:'syncing',delivery:null});expect(f.worker.getSnapshot().error).toContain('storage');
    f.sqlite.exec('DROP TRIGGER fail_delivery');f.advance(60_001);await f.worker.wake();expect((await entry(f)).status).toBe('synced');expect(f.transport.deliver.mock.calls.map(call=>call[0].operationId)).toEqual([operationId,operationId]);
  });
  it('fails closed on malformed saved metadata instead of hiding pending work or replaying it',async()=>{
    const f=await setup();f.sqlite.exec("UPDATE offline_operations SET review_outcome_json='{}'");await f.worker.wake();
    expect(f.worker.getSnapshot().loaded).toBe(true);expect(offlineSyncNotice(f.worker.getSnapshot())?.message).toBe('Sync status needs attention');
    expect(f.transport.deliver).not.toHaveBeenCalled();expect(await f.store.countUnresolvedForUser(scope.userId)).toBe(1);
  });
  it('storage failure before claiming never reports synced or drops the intent',async()=>{
    const f=await setup();f.sqlite.exec(`CREATE TRIGGER fail_write BEFORE UPDATE ON offline_operations BEGIN SELECT RAISE(FAIL,'disk full'); END;`);
    await f.worker.wake();expect((await entry(f)).status).toBe('pending');expect(f.worker.getSnapshot().error).toContain('storage');expect(f.transport.deliver).not.toHaveBeenCalled();
    f.sqlite.exec('DROP TRIGGER fail_write');await f.worker.wake();expect((await entry(f)).status).toBe('synced');
  });
});
