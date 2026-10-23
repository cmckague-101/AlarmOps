import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadManagerCreateSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline creates by owners/admins: one insert per device ID through the real
// attribution triggers and insert policies; crew are refused as online.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const thread=(user,id,payload={subject:' Staging ',description:'Meet at 0700'})=>command(user,'communication_thread',id,'thread.create',payload);
const training=(user,id,changes={})=>command(user,'training',id,'training.create',{courseCode:'S-130',courseTitle:'Firefighter Training',startsAt:'2026-08-01T15:00:00.000Z',location:'Station 1',instructor:'Lee',capacity:12,courseInformation:'',...changes});
const item=(user,id,changes={})=>command(user,'inventory_item',id,'item.create',{name:'Gloves',quantity:10,...changes});
before(async()=>{await loadManagerCreateSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('an owner creates a thread, training and item once each, attributed by the real triggers',async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];const ops=[thread(owner,ids[0]),training(owner,ids[1]),item(owner,ids[2])];
  for(const op of ops){const result=await send(owner,op);assert.equal(result.notApplied,undefined);assert.equal(result.record.id,op.entityId);assert.deepEqual(await send(owner,op),result)}
  assert.deepEqual(await row('select subject,created_by,created_by_name from public.communication_threads where id=$1',[ids[0]]),{subject:'Staging',created_by:owner,created_by_name:'Owner'});
  assert.equal((await row('select created_by from public.company_trainings where id=$1',[ids[1]])).created_by,owner);
  assert.deepEqual(await row('select name,quantity,created_by from public.company_inventory_items where id=$1',[ids[2]]),{name:'Gloves',quantity:10,created_by:owner});
  await assert.rejects(send(owner,thread(owner,ids[0])),error=>error.code==='23505');
  await assert.rejects(send(owner,training(owner,ids[1])),error=>error.code==='23505');
  await assert.rejects(send(owner,item(owner,ids[2],{name:'Other'})),error=>error.code==='23505');
});
test('an item name already in use is reported and nothing is created',async()=>{
  await send(owner,item(owner,randomUUID()));const id=randomUUID();const result=await send(owner,item(owner,id,{name:' Gloves '}));
  assert.equal(result.notApplied,'name_taken');assert.equal(result.record,null);assert.equal((await row('select count(*)::int count from public.company_inventory_items')).count,1);
});
test('crew are refused as online; invalid payloads are rejected',async()=>{
  for(const op of [thread(crew,randomUUID()),training(crew,randomUUID()),item(crew,randomUUID())])await assert.rejects(send(crew,op),error=>error.code==='42501');
  for(const op of [thread(owner,randomUUID(),{subject:' ',description:'x'}),training(owner,randomUUID(),{capacity:0}),training(owner,randomUUID(),{startsAt:'tomorrow'}),item(owner,randomUUID(),{quantity:-1}),item(owner,randomUUID(),{quantity:1000000})])
    await assert.rejects(send(owner,op),error=>error.code==='22023',JSON.stringify(op.mutation.payload));
});
