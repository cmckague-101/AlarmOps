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
  return {session,sync,transport,worker};
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
  it('labels availability that kept someone else’s newer value and overlays pending settings',async()=>{
    const f=await setup();await f.sync.setAvailability(true,false);await f.sync.setDashboard({fleet:false});
    expect(pendingAvailability(await f.session.list(),user)).toBe(true);expect(pendingDashboard(await f.session.list())).toEqual({fleet:false});
    f.transport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'5',record:{id:user,available:false},keptCurrent:true} as never);
    f.transport.canonical.mockResolvedValue({revision:'5',record:{id:user,available:false}} as never);
    await f.worker.wake();const entry=(await f.session.list()).find(item=>item.operation.entityType==='availability')!;
    expect(entry.status).toBe('synced');expect(offlineSyncEntryLabel(entry)).toMatch(/someone else was kept/);
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
