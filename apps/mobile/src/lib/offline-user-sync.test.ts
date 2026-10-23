import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SyncOperation} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineSyncWorker,offlineSyncEntryLabel,type OfflineSyncTransport} from './offline-sync-worker';
import {createOfflineUserSync,pendingAvailability,pendingDashboard,pendingTaskChanges} from './offline-user-sync';
import {offlineSyncAdapterBlock} from './offline-sync-protocol';
import {createNativeSyncTransport} from './offline-sync-transport';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001';const scope={userId:user,companyId:company};const date='2026-01-01T00:00:00.000Z';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
let n=0;const nextId=()=>`40000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
async function setup(){
  const sqlite=new DatabaseSync(':memory:');cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);const session=store.activate(scope);
  const sync=createOfflineUserSync({session,id:nextId,now:()=>date,offline:()=>true,canEdit:()=>true,changed:async()=>{}});
  let revision=0;const transport={deliver:vi.fn<OfflineSyncTransport['deliver']>(async operation=>({kind:'applied',receivedAt:date,revision:String(++revision),record:operation.mutation.kind==='command'&&operation.mutation.command==='task.create'?{id:operation.entityId,...operation.mutation.payload}:null})),
    canonical:vi.fn(async(operation:SyncOperation)=>({revision:String(revision),record:operation.mutation.kind==='command'&&operation.mutation.command==='task.create'?{id:operation.entityId,...operation.mutation.payload}:null})),outcome:vi.fn().mockResolvedValue(null),readRecord:vi.fn()};
  let token=0;const worker=createOfflineSyncWorker({session,transport,canAccess:()=>true,canRun:()=>true,token:()=>`attempt-${++token}`,now:()=>0,timeoutMs:1000});cleanup.push(()=>worker.stop());
  return {session,sync,transport,worker,sqlite};
}
describe('offline user-owned commands (actual SQLite)',()=>{
  it('creates and completes a task in order, overlaying pending changes until synced',async()=>{
    const f=await setup();const id=nextId();
    await expect(f.sync.createTask({id,subject:' ',description:'',dueDate:'2026-01-05'})).rejects.toThrow();
    const create=await f.sync.createTask({id,subject:' Filters ',description:'',dueDate:'2026-01-05'});expect(create.operation.mutation).toEqual({kind:'command',command:'task.create',payload:{subject:'Filters',description:'',dueDate:'2026-01-05'}});
    expect(pendingTaskChanges(await f.session.list()).created.map(task=>task.id)).toEqual([id]);
    const complete=await f.sync.completeTask(id);expect(complete.operation.dependsOn).toEqual([create.operation.operationId]);
    const pending=pendingTaskChanges(await f.session.list());expect(pending.created).toEqual([]);expect(pending.completed.has(id)).toBe(true);
    await f.worker.wake();await f.worker.wake();
    expect(f.transport.deliver.mock.calls.map(call=>call[0].mutation.kind==='command'&&call[0].mutation.command)).toEqual(['task.create','task.complete']);
    expect((await f.session.list()).every(entry=>entry.status==='synced')).toBe(true);expect(pendingTaskChanges(await f.session.list()).completed.size).toBe(0);
  });
  it('blocks retired task identities without automatic retries or replacement IDs',async()=>{
    const f=await setup();const saved=await f.sync.createTask({id:nextId(),subject:'Filters',description:'',dueDate:'2026-01-05'});
    f.transport.deliver.mockRejectedValue({code:'23505'});await f.worker.wake();await f.worker.resume();
    const retained=(await f.session.list())[0];expect(retained.status).toBe('blocked');expect(retained.error).toContain('identity was already used');expect(retained.operation).toEqual(saved.operation);expect(f.transport.deliver).toHaveBeenCalledTimes(1);expect(f.transport.canonical).not.toHaveBeenCalled();
    await f.worker.retry(saved.operation.operationId);await f.worker.wake();expect(f.transport.deliver.mock.calls.map(call=>call[0])).toEqual([saved.operation,saved.operation]);expect(await f.session.list()).toHaveLength(1);
  });
  it('labels availability that kept someone else’s newer value and overlays pending settings',async()=>{
    const f=await setup();await f.sync.setAvailability(true,false);await f.sync.setDashboard({resources:false});
    expect(pendingAvailability(await f.session.list(),user)).toBe(true);expect(pendingDashboard(await f.session.list())).toEqual({resources:false});
    f.transport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'5',record:{id:user,available:false},keptCurrent:true} as never);
    f.transport.canonical.mockResolvedValue({revision:'5',record:{id:user,available:false}} as never);
    await f.worker.wake();const entry=(await f.session.list()).find(item=>item.operation.entityType==='availability')!;
    expect(entry.status).toBe('synced');expect(offlineSyncEntryLabel(entry)).toMatch(/someone else was kept/);
  });
  it('chains repeated availability and independent dashboard edits without replacing earlier intent',async()=>{
    const f=await setup();const first=await f.sync.setAvailability(true,false);const second=await f.sync.setAvailability(false,true);const third=await f.sync.setAvailability(true,false);
    expect(second.operation.dependsOn).toEqual([first.operation.operationId]);expect(third.operation.dependsOn).toEqual([second.operation.operationId]);
    await f.sync.setDashboard({resources:false});await f.sync.setDashboard({tasks:false});expect(pendingDashboard(await f.session.list())).toEqual({resources:false,tasks:false});expect(pendingAvailability(await f.session.list(),user)).toBe(true);
    await f.worker.wake();expect((await f.session.list()).every(entry=>entry.status==='synced')).toBe(true);
  });
  it('atomically chains concurrent callers over the actual current command head',async()=>{
    const f=await setup();const results=await Promise.all([f.sync.setDashboard({resources:false}),f.sync.setDashboard({tasks:false}),f.sync.setDashboard({resources:true})]);expect(results[1].operation.dependsOn).toEqual([results[0].operation.operationId]);expect(results[2].operation.dependsOn).toEqual([results[1].operation.operationId]);expect(pendingDashboard(await f.session.list())).toEqual({resources:true,tasks:false});
  });
  it('retries a lost local acknowledgment with original identity, dependencies and provenance',async()=>{
    const f=await setup();const seed=await f.sync.setDashboard({tasks:false});let lost=true;let offline=true;let time=date;
    const sync=createOfflineUserSync({session:{...f.session,enqueue:async(...args:Parameters<typeof f.session.enqueue>)=>{const result=await f.session.enqueue(...args);if(lost){lost=false;throw new Error('Local acknowledgment lost')}return result}},id:nextId,now:()=>time,offline:()=>offline,canEdit:()=>true,changed:async()=>{}});
    await expect(sync.setDashboard({resources:false})).rejects.toThrow('acknowledgment');const original=(await f.session.list())[1];expect(original.operation.dependsOn).toEqual([seed.operation.operationId]);offline=false;time='2026-01-02T00:00:00Z';const retried=await sync.setDashboard({resources:false});expect(retried.operation).toEqual(original.operation);expect(await f.session.list()).toHaveLength(2);
    const later=await sync.setDashboard({resources:false});expect(later.operation.operationId).not.toBe(original.operation.operationId);expect(later.operation.dependsOn).toEqual([original.operation.operationId]);
  });
  it('rolls back failed dependency insertion and retries the captured command',async()=>{
    const f=await setup();const first=await f.sync.setDashboard({tasks:false});
    f.sqlite.exec("CREATE TRIGGER fail_command_dependency BEFORE INSERT ON offline_dependencies BEGIN SELECT RAISE(ABORT,'Dependency write failed'); END");
    await expect(f.sync.setDashboard({tasks:true})).rejects.toThrow('Dependency write failed');expect(await f.session.list()).toHaveLength(1);expect(pendingDashboard(await f.session.list())).toEqual({tasks:false});
    f.sqlite.exec('DROP TRIGGER fail_command_dependency');const saved=await f.sync.setDashboard({tasks:true});expect(saved.operation.dependsOn).toEqual([first.operation.operationId]);expect(await f.session.list()).toHaveLength(2);
  });
  it('freezes input values before asynchronous device lookup',async()=>{
    const f=await setup();const changes={resources:false};const saving=f.sync.setDashboard(changes);changes.resources=true;const saved=await saving;expect(saved.operation.mutation).toMatchObject({payload:{changes:{resources:false}}});
  });
  it('rejects unsupported dashboard values before claiming a device save',async()=>{
    const f=await setup();for(const changes of [{unknown:false},{tasks:'false'},{}])await expect(f.sync.setDashboard(changes as Record<string,boolean>)).rejects.toThrow();expect(await f.session.list()).toHaveLength(0);
  });
  it('allows only known user commands and routes them to the user endpoints',async()=>{
    const op:SyncOperation={schemaVersion:1,operationId:'o',companyId:company,entityType:'personal_task',entityId:'t',provenance:{userId:user,deviceId:'d',savedAt:date,connectivity:'offline'},dependsOn:['p'],mutation:{kind:'command',command:'task.complete',payload:{}}};
    expect(offlineSyncAdapterBlock(op)).toBeNull();expect(offlineSyncAdapterBlock({...op,mutation:{kind:'command',command:'task.update',payload:{}}})).toContain('not enabled');
    const builder={setHeader:vi.fn().mockReturnThis(),abortSignal:vi.fn().mockResolvedValue({data:{},error:null})};
    const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:user},access_token:'t'}},error:null})},rpc:vi.fn(()=>builder)};
    const transport=createNativeSyncTransport(client as unknown as SupabaseClient,scope,()=>true);const signal=new AbortController().signal;
    await transport.deliver(op,signal);await transport.canonical(op,signal);
    expect(client.rpc).toHaveBeenNthCalledWith(1,'sync_user_command',{operation:op});expect(client.rpc).toHaveBeenNthCalledWith(2,'get_user_sync_state',{target_company_id:company,entity_type:'personal_task',record_id:'t'});
  });
});
