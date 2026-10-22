import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SyncRecord} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineDetailEditor} from './offline-detail-editor';
import {createOfflineSyncWorker,type OfflineSyncTransport} from './offline-sync-worker';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const vehicle='30000000-0000-4000-8000-000000000001',issue='30000000-0000-4000-8000-000000000002';
const scope={userId:user,companyId:company};const date='2026-01-01T00:00:00.000Z';
const baseVehicle={id:vehicle,unit:'E1',status:'Assigned',assignedTo:crew,notes:'n'};
const baseIssue={id:issue,vehicleId:vehicle,title:'Leak',status:'Open',updates:[]};
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
let ids=0;const nextId=()=>`40000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`;
async function setup(){
  const sqlite=new DatabaseSync(':memory:');cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);const session=store.activate(scope);
  await session.putRecord('vehicle',vehicle,{revision:'1',record:baseVehicle});await session.putRecord('issue',issue,{revision:'1',record:baseIssue});
  const editor=createOfflineDetailEditor({session,readRecord:vi.fn(),canEdit:()=>true,offline:()=>true,id:nextId,now:()=>date,changed:async()=>{}});cleanup.push(()=>editor.dispose());
  const transport={deliver:vi.fn<OfflineSyncTransport['deliver']>(),canonical:vi.fn(),outcome:vi.fn().mockResolvedValue(null),readRecord:vi.fn()};
  let token=0;const worker=createOfflineSyncWorker({session,transport,canAccess:()=>true,canRun:()=>true,token:()=>`attempt-${++token}`,now:()=>0,timeoutMs:1000});cleanup.push(()=>worker.stop());
  return {session,editor,transport,worker};
}
const note=(text:string,changes:Record<string,unknown>={})=>({id:nextId(),text,createdBy:'Owner',createdById:user,createdAt:date,...changes});
describe('offline status, assignment and issue updates (actual SQLite)',()=>{
  it('saves consistent status/assignment changes and rejects inconsistent ones locally',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:vehicle});
    for(const [values,remove] of [[{status:'Ready'},[]],[{status:'Out of service'},[]],[{assignedFire:{id:'f',name:'Fire',state:'CA'}},['assignedTo']],[{status:'Parked'},[]],[{assignedTo:'crew'},[]]] as [SyncRecord,string[]][])
      await expect(f.editor.save(draft,values,{remove})).rejects.toThrow();
    const entry=await f.editor.save(draft,{status:'Ready'},{remove:['assignedTo']});
    expect(entry.operation.mutation.kind==='update'&&entry.operation.mutation.patch).toEqual({status:{present:true,value:'Ready'},assignedTo:{present:false}});
    const [record]=(await f.session.list());expect(record.status).toBe('pending');
  });
  it('appends issue notes separately and only as the current user',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'issue',entityId:issue});const mine=note('Checked hose');
    await expect(f.editor.save(draft,{updates:[mine],status:'Resolved',resolvedAt:date})).rejects.toThrow(/separately/);
    await expect(f.editor.save(draft,{updates:[note('x',{createdById:crew})]})).rejects.toThrow(/Invalid issue update/);
    await expect(f.editor.save(draft,{updates:[]})).rejects.toThrow();
    const entry=await f.editor.save(draft,{updates:[mine]});expect(entry.operation.mutation.kind==='update'&&entry.operation.mutation.patch).toEqual({updates:{present:true,value:[mine]}});
    const resolve=await f.editor.prepare({entityType:'issue',entityId:issue});expect(resolve.pendingParentId).toBe(entry.operation.operationId);expect(resolve.record.updates).toEqual([mine]);
    await expect(f.editor.save(resolve,{status:'Resolved'})).rejects.toThrow(/inconsistent/);
    expect((await f.editor.save(resolve,{status:'Resolved',resolvedAt:date})).operation.dependsOn).toEqual([entry.operation.operationId]);
  });
  it('re-appends a waiting note over newer shared notes and blocks status continuations after a concurrent reassignment',async()=>{
    const f=await setup();const first=await f.editor.save(await f.editor.prepare({entityType:'issue',entityId:issue}),{status:'Resolved',resolvedAt:date});
    const mine=note('Later note');const child=await f.editor.save(await f.editor.prepare({entityType:'issue',entityId:issue}),{updates:[mine]});
    const theirs=note('Online note',{createdById:crew,createdBy:'Crew'});const shared={...baseIssue,status:'Resolved',resolvedAt:date,updates:[theirs]};
    f.transport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'2',record:shared});f.transport.canonical.mockResolvedValue({revision:'2',record:shared});
    f.transport.deliver.mockImplementationOnce(async operation=>{expect(operation.mutation.kind==='update'&&operation.mutation.patch.updates).toEqual({present:true,value:[mine,theirs]});return {kind:'applied',receivedAt:date,revision:'3',record:{...shared,updates:[mine,theirs]}}});
    f.transport.canonical.mockResolvedValueOnce({revision:'2',record:shared}).mockResolvedValue({revision:'3',record:{...shared,updates:[mine,theirs]}});
    await f.worker.wake();await f.worker.wake();const entries=await f.session.list();
    expect(entries.find(item=>item.operation.operationId===first.operation.operationId)?.status).toBe('synced');expect(entries.find(item=>item.operation.operationId===child.operation.operationId)?.status).toBe('synced');
    const g=await setup();const parent=await g.editor.save(await g.editor.prepare({entityType:'vehicle',entityId:vehicle}),{notes:'parent'});
    await g.editor.save(await g.editor.prepare({entityType:'vehicle',entityId:vehicle}),{status:'Ready'},{remove:['assignedTo']});
    const reassigned={...baseVehicle,notes:'parent',assignedTo:user};
    g.transport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'3',record:reassigned});g.transport.canonical.mockResolvedValue({revision:'3',record:reassigned});
    await g.worker.wake();const later=(await g.session.list()).find(item=>item.operation.operationId!==parent.operation.operationId);
    expect(later).toMatchObject({status:'blocked',error:expect.stringContaining('explicitly rebase')});expect(g.transport.deliver).toHaveBeenCalledOnce();
  });
});
