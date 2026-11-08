import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadReceiptSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Per-day CTR photos (20270106000100): rows[].ctr is optional (older rows and
// older mobile builds omit it), must be an image in the creator's form folder
// for both online writes and offline saves, and stays in Storage once submitted.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,formId,payload,cmd='form.save')=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'payroll_form',entityId:formId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=op=>actor(op.provenance.userId,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const photo=(form,overrides={})=>({name:'ctr.jpg',mimeType:'image/jpeg',byteSize:2048,storagePath:`${company}/${crew}/forms/${form}/ctr-day-1.jpg`,...overrides});
const days=(ctr)=>Array.from({length:21},(_,index)=>({date:index===0?'2026-07-01':'',hoursWorked:index===0?8:0,crewIds:[],notes:'',...(ctr===undefined?{}:{ctr:index===0?ctr:null})}));
const insertForm=(id,rows)=>actor(crew,()=>db.query("insert into public.payroll_forms(id,company_id,created_by,created_by_name,rows) values($1,$2,$3,'Crew',$4)",[id,company,crew,JSON.stringify(rows)]));
const storedRows=async id=>(await row('select rows from public.payroll_forms where id=$1',[id])).rows;
before(async()=>{await loadReceiptSchema(db);await db.exec(migration('20270106000100_payroll_day_ctr'))});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.user_sync_receipts cascade;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew Person',tech,'Tech']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech']);
});
after(async()=>{await db.close()});

test('online saves keep a valid CTR photo and still accept rows without one',async()=>{
  const id=randomUUID();await insertForm(id,days());
  await actor(crew,()=>db.query('update public.payroll_forms set rows=$2 where id=$1',[id,JSON.stringify(days(photo(id)))]));
  assert.deepEqual((await storedRows(id))[0].ctr,photo(id));
  await actor(crew,()=>db.query('update public.payroll_forms set rows=$2 where id=$1',[id,JSON.stringify(days(null))]));
  assert.equal((await storedRows(id))[0].ctr,null);
});

test('online saves reject CTR photos outside the form folder or of the wrong shape',async()=>{
  const id=randomUUID();await insertForm(id,days());
  for(const bad of [
    photo(id,{storagePath:`${company}/${tech}/forms/${id}/ctr.jpg`}),
    photo(id,{storagePath:`${company}/${crew}/forms/${randomUUID()}/ctr.jpg`}),
    photo(id,{mimeType:'application/pdf'}),
    photo(id,{byteSize:20*1024*1024}),
    {...photo(id),extra:true},
    'ctr.jpg',
  ])await assert.rejects(actor(crew,()=>db.query('update public.payroll_forms set rows=$2 where id=$1',[id,JSON.stringify(days(bad))])),/payroll_forms_rows_ctr_shape/);
  await assert.rejects(insertForm(randomUUID(),days(photo(id))),/payroll_forms_rows_ctr_shape/);
});

test('offline saves accept days with or without ctr and reject an invalid CTR photo',async()=>{
  const id=randomUUID();
  assert.equal((await send(command(crew,id,{rows:days()}))).notApplied,undefined);
  assert.equal((await storedRows(id))[0].ctr,undefined);
  await send(command(crew,id,{rows:days(photo(id))}));
  assert.deepEqual((await storedRows(id))[0].ctr,photo(id));
  await assert.rejects(send(command(crew,id,{rows:days(photo(id,{storagePath:`${company}/${crew}/forms/${randomUUID()}/x.jpg`}))})),/Invalid payroll CTR photo/);
  await assert.rejects(send(command(crew,id,{rows:days(photo(id,{mimeType:'image/gif'}))})),/Invalid payroll CTR photo/);
  assert.deepEqual((await storedRows(id))[0].ctr,photo(id));
  const created=randomUUID();await send(command(tech,created,{engineNumber:'E-1'}));
  assert.ok((await storedRows(created)).every(day=>day.ctr===null));
});

test('CTR photos can be removed from drafts but are kept once the form is submitted',async()=>{
  const draft=randomUUID(),submitted=randomUUID();
  const draftPhoto=photo(draft),submittedPhoto=photo(submitted);
  for(const path of [draftPhoto.storagePath,submittedPhoto.storagePath])await actor(crew,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('payroll-files',$1,$2,'{\"size\":10}')",[path,crew]));
  await insertForm(submitted,days(submittedPhoto));
  await actor(crew,()=>db.query("update public.payroll_forms set status='pending' where id=$1",[submitted]));
  await insertForm(draft,days(draftPhoto));
  await actor(crew,()=>db.query("delete from storage.objects where bucket_id='payroll-files'"));
  assert.deepEqual((await db.query("select name from storage.objects where bucket_id='payroll-files'")).rows.map(item=>item.name),[submittedPhoto.storagePath]);
});
