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
async function setup(restricted=false){
  const sqlite=new DatabaseSync(':memory:');cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);const session=store.activate(scope);
  await session.putRecord('vehicle',vehicle,{revision:'1',record:baseVehicle});await session.putRecord('issue',issue,{revision:'1',record:baseIssue});
  const editor=createOfflineDetailEditor({session,readRecord:vi.fn(),canEdit:()=>true,offline:()=>true,id:nextId,now:()=>date,changed:async()=>{},restrictFields:()=>restricted?{vehicle:['status','assignedTo','assignedFire'],issue:['updates','status','resolvedAt']}:null});cleanup.push(()=>editor.dispose());
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
    await expect(f.editor.save(draft,{updates:[mine],title:'x'})).rejects.toThrow(/separately/);
    await expect(f.editor.save(draft,{updates:[mine],resolvedAt:date})).rejects.toThrow(/separately/);
    await expect(f.editor.save(draft,{updates:[note('a'),note('b')],status:'Resolved',resolvedAt:date})).rejects.toThrow(/exactly one note/);
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

describe('crew offline actions (actual SQLite)',()=>{
  it('lets crew claim for themselves and add notes, but nothing else',async()=>{
    const f=await setup(true);await f.session.putRecord('vehicle',vehicle,{revision:'2',record:{id:vehicle,unit:'E1',status:'Ready'}});
    const draft=await f.editor.prepare({entityType:'vehicle',entityId:vehicle});
    await expect(f.editor.save(draft,{notes:'x'})).rejects.toThrow(/Your role/);
    await expect(f.editor.save(draft,{status:'Assigned',assignedTo:crew})).rejects.toThrow(/for yourself/);
    expect((await f.editor.save(draft,{status:'Assigned',assignedTo:user})).operation.mutation.kind).toBe('update');
    const issueDraft=await f.editor.prepare({entityType:'issue',entityId:issue});
    await expect(f.editor.save(issueDraft,{status:'Resolved',resolvedAt:date})).rejects.toThrow(/Add a note/);
    await expect(f.editor.save(issueDraft,{title:'x',updates:[note('Crew note')]})).rejects.toThrow();
    expect((await f.editor.save(issueDraft,{updates:[note('Crew note')]})).operation.mutation.kind).toBe('update');
    const resolveDraft=await f.editor.prepare({entityType:'issue',entityId:issue});const fixed=note('Fixed it');
    const resolved=await f.editor.save(resolveDraft,{status:'Resolved',resolvedAt:date,updates:[fixed,...(resolveDraft.record.updates as SyncRecord[])]});
    expect(resolved.operation.mutation.kind==='update'&&Object.keys(resolved.operation.mutation.patch).sort()).toEqual(['resolvedAt','status','updates']);
  });
  it('completes a vehicle-only inventory without treating cached issues as missing',async()=>{
    const f=await setup(true);await f.session.restartFleetDownload('crew-plan');const expected=(await f.session.getFleetDownload())!;
    const page={companyId:company,snapshotToken:'a'.repeat(64),serverRequestAt:date,scope:'vehicles' as const,total:1,vehicles:1,issues:0,records:[{entityType:'vehicle' as const,entityId:vehicle,revision:'1',record:baseVehicle}],nextCursor:null};
    expect(await f.session.applyFleetDownloadPage(expected,page)).toBe(true);expect((await f.session.getFleetDownload())?.complete).toBe(true);
    expect((await f.session.listRecords()).some(row=>row.entityType==='issue')).toBe(true);
    const g=await setup(false);await g.session.restartFleetDownload('owner-plan');const all=(await g.session.getFleetDownload())!;
    await expect(g.session.applyFleetDownloadPage(all,{...page,scope:'all'})).rejects.toThrow(/omitted previously verified/);
  });
});
describe('offline issue reports (actual SQLite)',()=>{
  const report=(changes:Record<string,unknown>={})=>({id:'50000000-0000-4000-8000-000000000009',vehicleId:vehicle,title:'Leak',description:'Coolant',priority:'High',status:'Open',updates:[],createdBy:'Owner',createdById:user,createdAt:date,...changes}) as SyncRecord;
  it('saves one report durably, retries the same operation and syncs it through the create endpoint',async()=>{
    const f=await setup();
    for(const bad of [report({createdById:crew}),report({status:'Resolved'}),report({title:' '}),report({extra:1})])await expect(f.editor.createIssue(bad)).rejects.toThrow();
    const first=await f.editor.createIssue(report());expect(first.operation.mutation).toEqual({kind:'create',record:report()});
    expect((await f.editor.createIssue(report())).operation.operationId).toBe(first.operation.operationId);
    await expect(f.editor.createIssue(report({title:'Changed'}))).rejects.toThrow(/original issue/);
    const created={kind:'applied' as const,receivedAt:date,revision:'1',record:report()};
    f.transport.deliver.mockImplementationOnce(async operation=>{expect(operation.mutation.kind).toBe('create');return created});f.transport.canonical.mockResolvedValue({revision:'1',record:report()});
    await f.worker.wake();expect((await f.session.list())[0].status).toBe('synced');
    expect((await f.session.listRecords()).find(row=>row.entityId===report().id)?.revision).toBe('1');
  });
  it('lets restricted roles report only when allowed',async()=>{
    const f=await setup(true);await expect(f.editor.createIssue(report())).rejects.toThrow(/cannot report/);
  });
  it('saves one new vehicle durably, retries the same operation, and refuses crew or invalid vehicles',async()=>{
    const f=await setup();const id=nextId();
    const vehicleRecord=(changes:Record<string,unknown>={})=>({id,unit:'E7',type:'Engine',year:2020,make:'Pierce',model:'Enforcer',vin:'',plate:'',notes:'',status:'Ready',createdAt:date,...changes});
    for(const bad of [vehicleRecord({status:'Assigned'}),vehicleRecord({unit:' '}),vehicleRecord({year:20}),vehicleRecord({photo:{}})])await expect(f.editor.createVehicle(bad)).rejects.toThrow();
    const first=await f.editor.createVehicle(vehicleRecord());expect(first.operation).toMatchObject({entityType:'vehicle',entityId:id,mutation:{kind:'create',record:vehicleRecord()}});
    expect((await f.editor.createVehicle(vehicleRecord())).operation.operationId).toBe(first.operation.operationId);
    await expect(f.editor.createVehicle(vehicleRecord({unit:'E8'}))).rejects.toThrow(/original vehicle/);
    f.transport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'1',record:vehicleRecord()});f.transport.canonical.mockResolvedValue({revision:'1',record:vehicleRecord()});
    await f.worker.wake();expect((await f.session.list())[0].status).toBe('synced');
    expect((await f.session.listRecords()).find(row=>row.entityId===id)?.revision).toBe('1');
    const crewSetup=await setup(true);await expect(crewSetup.editor.createVehicle(vehicleRecord({id:nextId()}))).rejects.toThrow(/owners and admins/);
  });
});
