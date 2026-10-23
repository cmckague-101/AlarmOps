import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline edits/deletes apply only to records unchanged since the device saw
// them; otherwise nothing changes and the device is told 'changed_elsewhere'.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003';
const vehicle='30000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload,dependsOn=[])=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn,mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const stamp=async(table,id)=>(await row(`select to_json(updated_at)#>>'{}' value from public.${table} where id=$1`,[id])).value;
const touch=async(table,id)=>{await db.exec('set session_replication_role=replica');await db.query(`update public.${table} set updated_at=updated_at+interval '1 second' where id=$1`,[id]);await db.exec('set session_replication_role=origin')};
const values={courseCode:'S-130',courseTitle:'Training',startsAt:'2026-08-01T15:00:00.000Z',location:'Station 1',instructor:'Lee',capacity:12,courseInformation:''};
before(async()=>{await loadGuardedEditSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x'),($3,'Tech','t@x')",[owner,crew,tech]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech']);
});
after(async()=>{await db.close()});

test('training edits apply only to the version seen; chained device edits follow their own receipts; deletes likewise',async()=>{
  const id=randomUUID();const create=command(owner,'training',id,'training.create',values);await send(owner,create);
  const first=command(owner,'training',id,'training.update',{...values,location:'Station 2',base:{afterOperation:create.operationId}},[create.operationId]);
  assert.equal((await send(owner,first)).record.location,'Station 2');
  const second=command(owner,'training',id,'training.update',{...values,location:'Station 3',base:{afterOperation:first.operationId}},[first.operationId]);
  assert.equal((await send(owner,second)).record.location,'Station 3');
  const seen=await stamp('company_trainings',id);await touch('company_trainings',id);
  const stale=await send(owner,command(owner,'training',id,'training.update',{...values,location:'Old view',base:{updatedAt:seen}}));
  assert.equal(stale.notApplied,'changed_elsewhere');assert.equal(stale.record.location,'Station 3');
  assert.equal((await send(owner,command(owner,'training',id,'training.delete',{base:{updatedAt:seen}}))).notApplied,'changed_elsewhere');
  const fresh=await stamp('company_trainings',id);
  await assert.rejects(send(crew,command(crew,'training',id,'training.delete',{base:{updatedAt:fresh}})),error=>error.code==='42501');
  assert.equal((await send(owner,command(owner,'training',id,'training.delete',{base:{updatedAt:fresh}}))).record,null);
  assert.equal((await send(owner,command(owner,'training',id,'training.delete',{base:{updatedAt:fresh}}))).notApplied,undefined);
  assert.equal((await send(owner,command(owner,'training',id,'training.update',{...values,base:{updatedAt:fresh}}))).notApplied,'record_deleted');
});
test('inventory renames, stock edits, check-in and deletes are guarded and keep checked-out stock',async()=>{
  const id=randomUUID();await send(owner,command(owner,'inventory_item',id,'item.create',{name:'Gloves',quantity:5}));
  await send(crew,command(crew,'inventory_checkout',id,'checkout.add',{quantity:3}));
  let seen=await stamp('company_inventory_items',id);
  assert.equal((await send(owner,command(owner,'inventory_item',id,'item.update',{quantity:2,base:{updatedAt:seen}}))).notApplied,'below_checked_out');
  const renamed=await send(owner,command(owner,'inventory_item',id,'item.update',{name:'Gloves L',quantity:8,base:{updatedAt:seen}}));
  assert.equal(renamed.record.name,'Gloves L');assert.equal(renamed.record.quantity,8);
  assert.equal((await send(owner,command(owner,'inventory_item',id,'item.update',{name:'Stale',base:{updatedAt:seen}}))).notApplied,'changed_elsewhere');
  const checkout=(await row('select to_json(updated_at)#>>\'{}\' value from public.company_inventory_checkouts where item_id=$1',[id])).value;
  await send(crew,command(crew,'inventory_checkout',id,'checkout.add',{quantity:1}));
  assert.equal((await send(owner,command(owner,'inventory_return',id,'return.checkin',{userId:crew,quantity:3,base:{updatedAt:checkout}}))).notApplied,'changed_elsewhere');
  const latest=(await row('select to_json(updated_at)#>>\'{}\' value from public.company_inventory_checkouts where item_id=$1',[id])).value;
  const returned=await send(owner,command(owner,'inventory_return',id,'return.checkin',{userId:crew,quantity:4,base:{updatedAt:latest}}));
  assert.deepEqual(returned.record.checkouts,{});
  await assert.rejects(send(crew,command(crew,'inventory_return',id,'return.checkin',{userId:crew,quantity:1,base:{updatedAt:latest}})),error=>error.code==='42501');
  seen=await stamp('company_inventory_items',id);
  assert.equal((await send(owner,command(owner,'inventory_item',id,'item.delete',{base:{updatedAt:seen}}))).record,null);
});
test('receipt edits and deletes compare the values seen; vehicle notes and payroll reviews compare the version seen',async()=>{
  const receipt=randomUUID();const path=`${company}/${crew}/sync-${receipt}`;
  await actor(crew,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipt-files',$1,$2,'{\"size\":10}')",[path,crew]));
  await send(crew,command(crew,'receipt',receipt,'receipt.create',{name:'Fuel',amountCents:100,fileName:'f.jpg',mimeType:'image/jpeg',byteSize:10}));
  const base={name:'Fuel',amountCents:100,storagePath:path};
  await assert.rejects(send(crew,command(crew,'receipt',receipt,'receipt.update',{name:'Mine',base})),error=>error.code==='42501');
  assert.equal((await send(owner,command(owner,'receipt',receipt,'receipt.update',{amountCents:150,base}))).record.amountCents,150);
  assert.equal((await send(owner,command(owner,'receipt',receipt,'receipt.delete',{base}))).notApplied,'changed_elsewhere');
  assert.equal((await send(owner,command(owner,'receipt',receipt,'receipt.delete',{base:{...base,amountCents:150}}))).record,null);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1'}}])]));
  const note=randomUUID();await send(tech,command(tech,'vehicle_note',note,'note.create',{vehicleId:vehicle,subject:'Oil',body:'Low'}));
  const noteSeen=await stamp('vehicle_notes',note);
  assert.equal((await send(owner,command(owner,'vehicle_note',note,'note.update',{subject:'Oil',body:'Topped up',base:{updatedAt:noteSeen}}))).record.body,'Topped up');
  assert.equal((await send(tech,command(tech,'vehicle_note',note,'note.delete',{base:{updatedAt:noteSeen}}))).notApplied,'changed_elsewhere');
  await assert.rejects(send(crew,command(crew,'vehicle_note',note,'note.delete',{base:{updatedAt:noteSeen}})),error=>error.code==='42501');
  const days=Array.from({length:21},()=>({date:'',hoursWorked:0,crewIds:[],notes:''}));const form=randomUUID();
  await send(crew,command(crew,'payroll_form',form,'form.save',{rows:days}));await send(crew,command(crew,'payroll_form',form,'form.submit',{}));
  let formSeen=await stamp('payroll_forms',form);
  await assert.rejects(send(crew,command(crew,'payroll_review',form,'review.approve',{base:{updatedAt:formSeen}})),error=>error.code==='42501');
  assert.equal((await send(owner,command(owner,'payroll_review',form,'review.mark_paid',{base:{updatedAt:formSeen}}))).notApplied,'changed_elsewhere');
  const approve=command(owner,'payroll_review',form,'review.approve',{base:{updatedAt:formSeen}});assert.equal((await send(owner,approve)).record.status,'approved');
  assert.equal((await send(owner,command(owner,'payroll_review',form,'review.reject',{notes:'Fix',base:{updatedAt:formSeen}}))).notApplied,'changed_elsewhere');
  assert.equal((await send(owner,command(owner,'payroll_review',form,'review.mark_paid',{base:{afterOperation:approve.operationId}},[approve.operationId]))).record.status,'paid');
});
test('managers delete Crew Chat replies; invalid bases are refused',async()=>{
  const thread=randomUUID();await send(owner,command(owner,'communication_thread',thread,'thread.create',{subject:'S',description:'D'}));
  const reply=randomUUID();await send(crew,command(crew,'communication_reply',reply,'reply.create',{threadId:thread,body:'Hi'}));
  await assert.rejects(send(crew,command(crew,'communication_reply',reply,'reply.delete',{})),error=>error.code==='42501');
  assert.equal((await send(owner,command(owner,'communication_reply',reply,'reply.delete',{}))).record,null);
  const id=randomUUID();await send(owner,command(owner,'training',id,'training.create',values));
  for(const base of [{},{updatedAt:'yesterday'},{afterOperation:'x'},{updatedAt:'2026-01-01T00:00:00Z',extra:1}])
    await assert.rejects(send(owner,command(owner,'training',id,'training.delete',{base})),error=>['22023','22007','22008'].includes(error.code),JSON.stringify(base));
});
