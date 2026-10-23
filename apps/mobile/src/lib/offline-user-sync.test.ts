import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createPayrollRows,type PayrollForm,type SyncOperation} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineSyncWorker,offlineSyncEntryLabel,type OfflineSyncTransport} from './offline-sync-worker';
import {createOfflineUserSync,editBase,pendingEdits,deviceDocuments,deviceInventoryItems,deviceThreads,deviceTrainings,pendingNotificationPreferences,deviceReceipts,deviceInvoiceForms,overlayInvoiceForms,devicePayrollForms,overlayPayrollForms,deviceReplies,deviceVehicleNotes,pendingCheckouts,pendingTrainingSignups,laterTimestamp,pendingAvailability,pendingDashboard,pendingNotificationReads,pendingTaskChanges,pendingThreadSeen} from './offline-user-sync';
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
  it('queues read markers, overlays them while pending and after sync, and validates server timestamps',async()=>{
    const f=await setup();const notification=nextId(),thread=nextId();
    await expect(f.sync.markNotificationRead('not-a-uuid')).rejects.toThrow();
    for(const bad of ['yesterday','2026-01-01 10:00:00','2026-13-45T00:00:00Z'])await expect(f.sync.markThreadSeen(thread,bad)).rejects.toThrow();
    const read=await f.sync.markNotificationRead(notification);expect(read.operation).toMatchObject({entityType:'notification',entityId:notification,mutation:{kind:'command',command:'notification.read',payload:{}}});
    const micro='2026-01-01T10:00:00.123456+00:00';
    await f.sync.markThreadSeen(thread,'2026-01-01T09:00:00+00:00');const seen=await f.sync.markThreadSeen(thread,micro);
    expect(seen.operation.mutation).toEqual({kind:'command',command:'communication.seen',payload:{seenThrough:micro}});
    let entries=await f.session.list();expect(pendingNotificationReads(entries)).toEqual(new Map([[notification,date]]));expect(pendingThreadSeen(entries).get(thread)).toBe(micro);
    await f.worker.wake();await f.worker.wake();await f.worker.wake();entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);
    expect(f.transport.deliver.mock.calls.map(call=>call[0].mutation.kind==='command'&&call[0].mutation.command)).toEqual(['notification.read','communication.seen','communication.seen']);
    expect(pendingNotificationReads(entries).has(notification)).toBe(true);expect(pendingThreadSeen(entries).get(thread)).toBe(micro);
  });
  it('drops refused read markers from overlays and keeps the most precise later timestamp',async()=>{
    const f=await setup();const notification=nextId();await f.sync.markNotificationRead(notification);
    f.transport.deliver.mockRejectedValue({code:'42501'});await f.worker.wake();await f.worker.resume();
    const [entry]=await f.session.list();expect(entry.status).toBe('blocked');
    expect(laterTimestamp('2026-01-01T10:00:00.123Z','2026-01-01T10:00:00.123456+00:00')).toBe('2026-01-01T10:00:00.123456+00:00');
    expect(laterTimestamp('2026-01-01T11:00:00Z','2026-01-01T10:00:00.999999+00:00')).toBe('2026-01-01T11:00:00Z');expect(laterTimestamp(undefined,'2026-01-01T11:00:00Z')).toBe('2026-01-01T11:00:00Z');
    expect(pendingNotificationReads([{...entry,reviewOutcome:'discarded'} as never]).size).toBe(0);
  });
  it('posts Crew Chat replies once per client ID and reports deleted threads without dropping the text',async()=>{
    const f=await setup();const thread=nextId(),gone=nextId(),id=nextId(),other=nextId();
    await expect(f.sync.postReply({id,threadId:thread,body:'  '})).rejects.toThrow();await expect(f.sync.postReply({id:'x',threadId:thread,body:'Hi'})).rejects.toThrow();
    const saved=await f.sync.postReply({id,threadId:thread,body:' On my way '});expect(saved.operation.mutation).toEqual({kind:'command',command:'reply.create',payload:{threadId:thread,body:'On my way'}});
    await f.sync.postReply({id:other,threadId:gone,body:'Late'});
    expect(deviceReplies(await f.session.list()).map(reply=>[reply.id,reply.state])).toEqual([[id,'saved'],[other,'saved']]);
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===id
      ?{kind:'applied',receivedAt:date,revision:'7',record:{id,threadId:thread,body:'On my way',createdAt:'2026-01-01T12:00:00.5+00:00'}}
      :{kind:'applied',receivedAt:date,revision:'8',record:null,notApplied:'thread_deleted'} as never);
    f.transport.canonical.mockImplementation(async operation=>({revision:operation.entityId===id?'7':'8',record:operation.entityId===id?{id,threadId:thread,body:'On my way',createdAt:'2026-01-01T12:00:00.5+00:00'}:null}));
    await f.worker.wake();await f.worker.wake();await f.worker.wake();const entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);expect(f.transport.deliver).toHaveBeenCalledTimes(2);
    expect(deviceReplies(entries)).toEqual([{id,threadId:thread,body:'On my way',savedAt:date,state:'posted',createdAt:'2026-01-01T12:00:00.5+00:00'}]);
    const deleted=entries.find(entry=>entry.operation.entityId===other)!;expect(offlineSyncEntryLabel(deleted)).toContain('Not posted');expect(deleted.operation.mutation).toMatchObject({payload:{body:'Late'}});
  });
  it('creates vehicle notes once per client ID, per vehicle, and reports deleted vehicles',async()=>{
    const f=await setup();const vehicle=nextId(),gone=nextId(),id=nextId(),other=nextId();
    for(const bad of [{subject:' ',body:'x'},{subject:'x'.repeat(161),body:'x'},{subject:'s',body:''}])await expect(f.sync.createVehicleNote({id,vehicleId:vehicle,...bad})).rejects.toThrow();
    const saved=await f.sync.createVehicleNote({id,vehicleId:vehicle,subject:' Brakes ',body:' Pads at 30% '});
    expect(saved.operation.mutation).toEqual({kind:'command',command:'note.create',payload:{vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%'}});
    await f.sync.createVehicleNote({id:other,vehicleId:gone,subject:'Old',body:'Gone'});
    expect(deviceVehicleNotes(await f.session.list(),vehicle).map(note=>[note.id,note.state])).toEqual([[id,'saved']]);
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===id
      ?{kind:'applied',receivedAt:date,revision:'7',record:{id,vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%',createdAt:'2026-01-01T12:00:00+00:00'}}
      :{kind:'applied',receivedAt:date,revision:'8',record:null,notApplied:'vehicle_deleted'} as never);
    f.transport.canonical.mockImplementation(async operation=>({revision:operation.entityId===id?'7':'8',record:operation.entityId===id?{id,vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%',createdAt:'2026-01-01T12:00:00+00:00'}:null}));
    await f.worker.wake();await f.worker.wake();await f.worker.wake();const entries=await f.session.list();
    expect(deviceVehicleNotes(entries,vehicle)).toEqual([{id,vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%',savedAt:date,state:'posted',createdAt:'2026-01-01T12:00:00+00:00'}]);
    expect(deviceVehicleNotes(entries,gone)).toEqual([]);expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.entityId===other)!)).toContain('vehicle was deleted');
  });
  it('queues gear checkouts in order per item and reports stock shortfalls without applying them',async()=>{
    const f=await setup();const gloves=nextId(),gone=nextId();
    for(const quantity of [0,1.5,1000000])await expect(f.sync.checkOut(gloves,quantity)).rejects.toThrow();
    const first=await f.sync.checkOut(gloves,2);const second=await f.sync.checkOut(gloves,1);await f.sync.checkOut(gone,1);
    expect(first.operation.mutation).toEqual({kind:'command',command:'checkout.add',payload:{quantity:2}});expect(second.operation.dependsOn).toContain(first.operation.operationId);
    expect(pendingCheckouts(await f.session.list())).toEqual(new Map([[gloves,3],[gone,1]]));
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===gone
      ?{kind:'applied',receivedAt:date,revision:'9',record:null,notApplied:'item_deleted'} as never
      :operation.operationId===second.operation.operationId?{kind:'applied',receivedAt:date,revision:'8',record:{id:gloves,checkedOut:2},notApplied:'insufficient_stock'} as never
      :{kind:'applied',receivedAt:date,revision:'7',record:{id:gloves,checkedOut:2}});
    f.transport.canonical.mockImplementation(async operation=>({revision:operation.entityId===gone?'9':'8',record:operation.entityId===gone?null:{id:gloves,checkedOut:2}}));
    for(let i=0;i<4;i++)await f.worker.wake();const entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);expect(pendingCheckouts(entries).size).toBe(0);
    expect(f.transport.deliver.mock.calls.map(call=>call[0].operationId).slice(0,2)).toEqual([first.operation.operationId,second.operation.operationId]);
    expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.operationId===second.operation.operationId)!)).toContain('not enough stock');
    expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.entityId===gone)!)).toContain('item was deleted');
  });
  it('queues training join/cancel in order and labels full classes as not signed up',async()=>{
    const f=await setup();const course=nextId(),full=nextId();
    await expect(f.sync.joinTraining('nope')).rejects.toThrow();
    const join=await f.sync.joinTraining(course);const cancel=await f.sync.cancelTraining(course);await f.sync.joinTraining(full);
    expect(cancel.operation.dependsOn).toContain(join.operation.operationId);
    expect(pendingTrainingSignups(await f.session.list())).toEqual(new Map([[course,false],[full,true]]));
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===full
      ?{kind:'applied',receivedAt:date,revision:'9',record:{id:full,signedUp:false},notApplied:'course_full'} as never
      :{kind:'applied',receivedAt:date,revision:operation.operationId===join.operation.operationId?'7':'8',record:{id:course,signedUp:operation.operationId===join.operation.operationId}});
    f.transport.canonical.mockImplementation(async operation=>({revision:operation.entityId===full?'9':'8',record:{id:operation.entityId,signedUp:false}}));
    for(let i=0;i<4;i++)await f.worker.wake();const entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);expect(pendingTrainingSignups(entries).size).toBe(0);
    expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.entityId===full)!)).toContain('course was full');
  });
  it('queues payroll saves and submission in order, overlays them, and labels refusals without dropping edits',async()=>{
    const f=await setup();const draft=nextId(),sent=nextId();const rows=createPayrollRows('2026-07-01');rows[0]={...rows[0],hoursWorked:9,crewIds:[user]};
    for(const changes of [{},{engineNumber:'x'.repeat(161)},{rows:rows.slice(1)},{rows:rows.map((day,index)=>index?day:{...day,hoursWorked:-1})},{rows:rows.map((day,index)=>index?day:{...day,crewIds:['me']})}])
      await expect(f.sync.savePayrollForm(draft,changes)).rejects.toThrow();
    const first=await f.sync.savePayrollForm(draft,{engineNumber:'E-21',rows});const second=await f.sync.savePayrollForm(draft,{incidents:'Oak Fire'});const submit=await f.sync.submitPayrollForm(draft);
    await f.sync.savePayrollForm(sent,{engineNumber:'late'});
    expect(first.operation.mutation).toEqual({kind:'command',command:'form.save',payload:{engineNumber:'E-21',rows}});expect(submit.operation.dependsOn).toContain(second.operation.operationId);
    const device=devicePayrollForms(await f.session.list());expect(device.get(draft)).toMatchObject({changes:{engineNumber:'E-21',incidents:'Oak Fire',rows},submitted:true});
    const server:PayrollForm={id:sent,companyId:company,createdBy:user,createdByName:'Me',engineNumber:'E-1',incidents:'',attachment:null,rows:createPayrollRows(),status:'pending',submittedAt:date,approvedAt:null,approvedBy:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:date,updatedAt:date};
    const shown=overlayPayrollForms([server],device,{companyId:company,userId:user,name:'Me'});
    expect(shown.map(form=>[form.id,form.status,form.engineNumber])).toEqual([[draft,'pending','E-21'],[sent,'pending','late']]);expect(shown[0].rows[0].hoursWorked).toBe(9);
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===sent?{kind:'applied',receivedAt:date,revision:'9',record:{id:sent,status:'pending'},notApplied:'already_submitted'} as never:{kind:'applied',receivedAt:date,revision:'8',record:{id:draft}});
    f.transport.canonical.mockImplementation(async operation=>({revision:operation.entityId===sent?'9':'8',record:{id:operation.entityId}}));
    for(let i=0;i<6;i++)await f.worker.wake();const entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);expect(devicePayrollForms(entries).size).toBe(0);
    expect(f.transport.deliver.mock.calls.filter(call=>call[0].entityId===draft).map(call=>call[0].mutation.kind==='command'&&call[0].mutation.command)).toEqual(['form.save','form.save','form.submit']);
    expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.entityId===sent)!)).toContain('already submitted');
    expect(entries.find(entry=>entry.operation.entityId===sent)!.operation.mutation).toMatchObject({payload:{engineNumber:'late'}});
  });
  it('queues invoice saves and submission per field, overlays a new draft, and labels refusals',async()=>{
    const f=await setup();const draft=nextId(),customer=nextId();
    for(const changes of [{},{invoiceAmount:-1},{invoiceAmount:1.005},{invoiceDate:'07/04/2026'},{customerId:'county'}])await expect(f.sync.saveInvoiceForm(draft,changes)).rejects.toThrow();
    const first=await f.sync.saveInvoiceForm(draft,{invoiceNumber:'INV-7',invoiceDate:'2026-07-04',invoiceAmount:1250.5,customerId:''});
    const second=await f.sync.saveInvoiceForm(draft,{customerId:customer});const submit=await f.sync.submitInvoiceForm(draft);
    expect(submit.operation.dependsOn).toContain(second.operation.operationId);expect(first.operation.mutation).toMatchObject({command:'form.save',payload:{invoiceAmount:1250.5,customerId:''}});
    const shown=overlayInvoiceForms([],deviceInvoiceForms(await f.session.list()),{companyId:company,userId:user,name:'Me'});
    expect(shown).toHaveLength(1);expect(shown[0]).toMatchObject({id:draft,status:'submitted',invoiceNumber:'INV-7',customerId:customer,invoiceAmount:1250.5});
    f.transport.deliver.mockImplementation(async operation=>operation.operationId===submit.operation.operationId?{kind:'applied',receivedAt:date,revision:'9',record:{id:draft,status:'draft'},notApplied:'incomplete'} as never:{kind:'applied',receivedAt:date,revision:'8',record:{id:draft,status:'draft'}});
    f.transport.canonical.mockImplementation(async()=>({revision:'9',record:{id:draft,status:'draft'}}));
    for(let i=0;i<5;i++)await f.worker.wake();const entries=await f.session.list();
    expect(entries.every(entry=>entry.status==='synced')).toBe(true);expect(deviceInvoiceForms(entries).size).toBe(0);
    expect(offlineSyncEntryLabel(entries.find(entry=>entry.operation.operationId===submit.operation.operationId)!)).toContain('Not submitted');
  });
  it('keeps the receipt file before saving the command and labels mismatched uploads',async()=>{
    const f=await setup();const kept:string[]=[];
    const files={keep:vi.fn(async(id:string)=>{kept.push(id);return 2048}),read:vi.fn(),uri:vi.fn(),remove:vi.fn()};
    const sync=createOfflineUserSync({session:f.session,id:nextId,now:()=>date,offline:()=>true,canEdit:()=>true,changed:async()=>{},receiptFiles:files});
    const id=nextId();
    for(const bad of [{name:' '},{amountCents:0},{amountCents:1.5},{mimeType:'image/gif'},{fileName:'a\nb'}])
      await expect(sync.createReceipt({id,name:'Fuel',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg',...bad},'file:///tmp/fuel.jpg')).rejects.toThrow();
    expect(files.keep).not.toHaveBeenCalled();
    const saved=await sync.createReceipt({id,name:' Fuel ',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg'},'file:///tmp/fuel.jpg');
    expect(kept).toEqual([id]);expect(saved.operation.mutation).toEqual({kind:'command',command:'receipt.create',payload:{name:'Fuel',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg',byteSize:2048}});
    expect(deviceReceipts(await f.session.list()).map(item=>[item.id,item.state])).toEqual([[id,'saved']]);
    f.transport.deliver.mockResolvedValue({kind:'applied',receivedAt:date,revision:'3',record:null,notApplied:'file_mismatch'} as never);f.transport.canonical.mockResolvedValue({revision:'3',record:null});
    for(let i=0;i<3;i++)await f.worker.wake();const entry=(await f.session.list())[0];
    expect(entry.status).toBe('synced');expect(offlineSyncEntryLabel(entry)).toContain('file is kept on this device');expect(deviceReceipts([entry])).toEqual([]);
  });
  it('queues own notification preferences per key and feedback once per ID',async()=>{
    const f=await setup();
    for(const changes of [{},{vehicleAssigned:false},{pushEnabled:'no'}] as Record<string,unknown>[])await expect(f.sync.setNotificationPreferences(changes as Record<string,boolean>)).rejects.toThrow();
    const first=await f.sync.setNotificationPreferences({pushEnabled:false});const second=await f.sync.setNotificationPreferences({trainingCreated:false,pushEnabled:true});
    expect(first.operation.entityId).toBe(user);expect(second.operation.dependsOn).toContain(first.operation.operationId);
    expect(pendingNotificationPreferences(await f.session.list())).toEqual({pushEnabled:true,trainingCreated:false});
    const id=nextId();
    for(const bad of [{category:'bug'},{message:' '},{source:'web'}])await expect(f.sync.sendFeedback({id,category:'idea',message:'Hi',source:'ios',...bad})).rejects.toThrow();
    const sent=await f.sync.sendFeedback({id,category:'idea',message:' Hi ',source:'ios'});expect(sent.operation.mutation).toEqual({kind:'command',command:'feedback.send',payload:{category:'idea',message:'Hi',source:'ios'}});
    expect((await f.sync.sendFeedback({id,category:'idea',message:'Hi',source:'ios'})).operation.operationId).not.toBe(sent.operation.operationId);
  });
  it('creates threads, trainings and inventory items once per ID and labels taken item names',async()=>{
    const f=await setup();const thread=nextId(),course=nextId(),gloves=nextId();
    await expect(f.sync.createThread({id:thread,subject:' ',description:'x'})).rejects.toThrow();
    await expect(f.sync.createTraining({id:course,courseCode:'S-130',courseTitle:'T',startsAt:'tomorrow',location:'L',instructor:'I',capacity:5,courseInformation:''})).rejects.toThrow();
    await expect(f.sync.createInventoryItem({id:gloves,name:'Gloves',quantity:-1})).rejects.toThrow();
    await f.sync.createThread({id:thread,subject:' Staging ',description:'0700'});
    await f.sync.createTraining({id:course,courseCode:'S-130',courseTitle:'Training',startsAt:'2026-08-01T15:00:00.000Z',location:'Station',instructor:'Lee',capacity:12,courseInformation:''});
    const item=await f.sync.createInventoryItem({id:gloves,name:' Gloves ',quantity:4});expect(item.operation.mutation).toEqual({kind:'command',command:'item.create',payload:{name:'Gloves',quantity:4}});
    const entries=await f.session.list();
    expect(deviceThreads(entries).map(row=>[row.id,row.subject,row.state])).toEqual([[thread,'Staging','saved']]);
    expect(deviceTrainings(entries).map(row=>row.courseTitle)).toEqual(['Training']);expect(deviceInventoryItems(entries).map(row=>row.quantity)).toEqual([4]);
    f.transport.deliver.mockImplementation(async operation=>operation.entityId===gloves?{kind:'applied',receivedAt:date,revision:'9',record:null,notApplied:'name_taken'} as never:{kind:'applied',receivedAt:date,revision:'8',record:{id:operation.entityId,createdAt:date}});
    f.transport.canonical.mockImplementation(async operation=>({revision:'9',record:operation.entityId===gloves?null:{id:operation.entityId,createdAt:date}}));
    for(let i=0;i<5;i++)await f.worker.wake();const done=await f.session.list();
    expect(offlineSyncEntryLabel(done.find(entry=>entry.operation.entityId===gloves)!)).toContain('already exists');expect(deviceInventoryItems(done)).toEqual([]);
    expect(deviceThreads(done).map(row=>row.state)).toEqual(['posted']);
  });
  it('keeps a company document file within the fleet-file limit before saving the command',async()=>{
    const f=await setup();let size=2048;
    const files={keep:vi.fn(async()=>size),read:vi.fn(),uri:vi.fn(),remove:vi.fn()};
    const sync=createOfflineUserSync({session:f.session,id:nextId,now:()=>date,offline:()=>true,canEdit:()=>true,changed:async()=>{},receiptFiles:files});
    const id=nextId();
    await expect(sync.createCompanyDocument({id,name:'SOP',fileName:'sop.txt',mimeType:'text/plain'},'file:///tmp/sop.txt')).rejects.toThrow();expect(files.keep).not.toHaveBeenCalled();
    size=9*1024*1024;await expect(sync.createCompanyDocument({id,name:'SOP',fileName:'sop.pdf',mimeType:'application/pdf'},'file:///tmp/sop.pdf')).rejects.toThrow(/8 MB/);expect(files.remove).toHaveBeenCalledWith(id);
    size=2048;const saved=await sync.createCompanyDocument({id,name:' SOP ',fileName:'sop.pdf',mimeType:'application/pdf'},'file:///tmp/sop.pdf');
    expect(saved.operation.mutation).toEqual({kind:'command',command:'document.create',payload:{name:'SOP',fileName:'sop.pdf',mimeType:'application/pdf',byteSize:2048}});
    expect(deviceDocuments(await f.session.list()).map(item=>item.name)).toEqual(['SOP']);
  });
  it('chains guarded edits on their own earlier commands, overlays them and labels refusals',async()=>{
    const f=await setup();const course=nextId(),seen={updatedAt:'2026-01-01T00:00:00.123456+00:00'};
    const values={courseCode:'S-130',courseTitle:'Training',startsAt:'2026-08-01T15:00:00.000Z',location:'Station',instructor:'Lee',capacity:12,courseInformation:''};
    expect(editBase(await f.session.list(),'training',course,seen)).toEqual(seen);
    const first=await f.sync.updateTraining(course,{...values,location:'Station 2'},editBase(await f.session.list(),'training',course,seen));
    expect(first.operation.mutation).toMatchObject({command:'training.update',payload:{location:'Station 2',base:seen}});
    const second=await f.sync.deleteTraining(course,editBase(await f.session.list(),'training',course,seen));
    expect(second.operation.mutation).toMatchObject({payload:{base:{afterOperation:first.operation.operationId}}});expect(second.operation.dependsOn).toContain(first.operation.operationId);
    expect(pendingEdits(await f.session.list(),'training',{update:'training.update',delete:'training.delete'}).get(course)).toMatchObject({deleted:true,changes:{location:'Station 2'}});
    await expect(f.sync.reviewPayroll(nextId(),'reject',seen,' ')).rejects.toThrow(/notes/);
    await expect(f.sync.updateInventoryItem(nextId(),{},seen)).rejects.toThrow();
    f.transport.deliver.mockImplementation(async operation=>operation.operationId===first.operation.operationId?{kind:'applied',receivedAt:date,revision:'4',record:{id:course},notApplied:'changed_elsewhere'} as never:{kind:'applied',receivedAt:date,revision:'5',record:{id:course},notApplied:'changed_elsewhere'} as never);
    f.transport.canonical.mockResolvedValue({revision:'5',record:{id:course}});
    for(let i=0;i<4;i++)await f.worker.wake();const done=await f.session.list();
    expect(offlineSyncEntryLabel(done[0])).toContain('their version was kept');expect(pendingEdits(done,'training',{update:'training.update',delete:'training.delete'}).size).toBe(0);
    // Applied after the shown download's watermark: later edits still chain on it.
    expect(editBase(done.map(entry=>({...entry,receipt:{kind:'applied',revision:'9',receivedAt:date,record:null}}) as never),'training',course,seen,'5')).toEqual({afterOperation:second.operation.operationId});
  });
});
