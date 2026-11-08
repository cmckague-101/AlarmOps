import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Receipt projects and auto-fill (20270112000100): receipts carry an optional
// project online and offline, owners may correct it, and auto-fill requests are
// claimed only for members of companies that have it turned on, within limits.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const details={name:'Fuel',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg',byteSize:2048};
const command=(user,receiptId,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'receipt',entityId:receiptId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'receipt.create',payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const upload=(user,id)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipt-files',$1,$2,$3)",[`${company}/${user}/sync-${id}`,user,JSON.stringify({size:2048})]));
const project=async id=>(await row('select project from public.company_receipts where id=$1',[id]))?.project;
const claim=async(companyId,user)=>{await db.exec('set role service_role');try{return (await row('select public.claim_receipt_autofill($1,$2) result',[companyId,user])).result}finally{await db.exec('reset role')}};
before(async()=>{
  await loadGuardedEditSchema(db);
  await db.exec(migration('20270102000100_receipt_purchase_date'));
  await db.exec(migration('20270112000100_receipt_projects_autofill'));
  await db.exec("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$");
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.receipt_autofill_usage;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other Co','OC-1')",[company,other]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew','c@x'),($3,'Outsider','x@x')",[owner,crew,outsider]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$5)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('online receipts save an optional project',async()=>{
  const insert=(name,value)=>actor(crew,()=>db.query("insert into public.company_receipts(company_id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,project) values($1,$2,100,'a.jpg','image/jpeg',10,$3,$4,'',$5) returning id",[company,name,`${company}/${crew}/${randomUUID()}`,crew,value]));
  const withProject=(await insert('Fuel','Pine Valley Fire')).rows[0].id;
  const without=(await insert('Meals',null)).rows[0].id;
  assert.equal(await project(withProject),'Pine Valley Fire');
  assert.equal(await project(without),null);
  await assert.rejects(insert('Lodging','   '));
  await assert.rejects(insert('Lodging','x'.repeat(121)));
});

test('offline receipts from older devices still create without a project',async()=>{
  for(const payload of [details,{...details,purchasedOn:'2026-10-20'}]){
    const id=randomUUID();await upload(crew,id);
    assert.equal((await send(crew,command(crew,id,payload))).kind,'applied');
    assert.equal(await project(id),null);
  }
});

test('offline receipts carry a trimmed project when the device sends one',async()=>{
  const id=randomUUID();await upload(crew,id);
  assert.equal((await send(crew,command(crew,id,{...details,purchasedOn:'2026-10-20',project:'  Pine Valley Fire '}))).kind,'applied');
  assert.equal(await project(id),'Pine Valley Fire');
});

test('a malformed project or unknown field is refused and creates nothing',async()=>{
  for(const extra of [{project:''},{project:'   '},{project:'x'.repeat(121)},{project:42},{category:'fuel'}]){
    const id=randomUUID();await upload(crew,id);
    await assert.rejects(send(crew,command(crew,id,{...details,...extra})),error=>error.code==='22023');
    assert.equal((await db.query('select 1 from public.company_receipts where id=$1',[id])).rows.length,0);
  }
});

test('owners can correct the project; crew cannot',async()=>{
  const id=randomUUID();await upload(crew,id);
  await send(crew,command(crew,id,{...details,project:'Pine Valley Fire'}));
  assert.equal((await actor(crew,()=>db.query("update public.company_receipts set project='Mine' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal(await project(id),'Pine Valley Fire');
  await actor(owner,()=>db.query("update public.company_receipts set project='Cedar Creek' where id=$1",[id]));
  assert.equal(await project(id),'Cedar Creek');
});

test('members can read the auto-fill flag but cannot turn it on',async()=>{
  assert.equal((await actor(crew,()=>row('select receipt_autofill_enabled value from public.companies where id=$1',[company]))).value,false);
  await assert.rejects(actor(owner,()=>db.query('update public.companies set receipt_autofill_enabled=true where id=$1',[company])));
});

test('auto-fill is claimed only for members of companies that have it on',async()=>{
  assert.equal(await claim(company,crew),'disabled');
  await db.query('update public.companies set receipt_autofill_enabled=true where id=$1',[company]);
  assert.equal(await claim(company,crew),'ok');
  assert.equal(await claim(company,outsider),'not_member');
  assert.equal(await claim(other,outsider),'disabled');
  assert.equal((await row('select count(*)::int n from public.receipt_autofill_usage where company_id=$1 and user_id=$2',[company,crew])).n,1);
});

test('auto-fill stops at the daily per-person limit and recovers after 24 hours',async()=>{
  await db.query('update public.companies set receipt_autofill_enabled=true where id=$1',[company]);
  await db.query("insert into public.receipt_autofill_usage(company_id,user_id) select $1,$2 from generate_series(1,200)",[company,crew]);
  assert.equal(await claim(company,crew),'limit');
  assert.equal(await claim(company,owner),'ok');
  await db.query("update public.receipt_autofill_usage set created_at=now()-interval '25 hours' where user_id=$1",[crew]);
  assert.equal(await claim(company,crew),'ok');
});

test('auto-fill stops at the daily company limit',async()=>{
  await db.query('update public.companies set receipt_autofill_enabled=true where id=$1',[company]);
  await db.query("insert into public.receipt_autofill_usage(company_id,user_id) select $1,$2 from generate_series(1,2000)",[company,owner]);
  assert.equal(await claim(company,crew),'limit');
});

test('clients cannot claim auto-fill or read usage directly',async()=>{
  await assert.rejects(actor(crew,()=>db.query('select public.claim_receipt_autofill($1,$2)',[company,crew])));
  await assert.rejects(actor(crew,()=>db.query('select * from public.receipt_autofill_usage')));
});
