import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Receipt purchase dates (20270102000100): offline receipt.create accepts an
// optional purchasedOn while older devices that never send it keep working;
// owners may correct the date and crew may not.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const details={name:'Fuel',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg',byteSize:2048};
const command=(user,receiptId,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'receipt',entityId:receiptId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'receipt.create',payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const upload=(user,id)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipt-files',$1,$2,$3)",[`${company}/${user}/sync-${id}`,user,JSON.stringify({size:2048})]));
const purchased=async id=>(await row('select purchased_on::text value from public.company_receipts where id=$1',[id]))?.value;
before(async()=>{
  await loadGuardedEditSchema(db);
  await db.exec(migration('20270102000100_receipt_purchase_date'));
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew','c@x')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('offline receipts from older devices still create without a purchase date',async()=>{
  const id=randomUUID();await upload(crew,id);
  assert.equal((await send(crew,command(crew,id,details))).kind,'applied');
  assert.equal(await purchased(id),null);
});

test('offline receipts carry a purchase date when the device sends one',async()=>{
  const id=randomUUID();await upload(crew,id);
  assert.equal((await send(crew,command(crew,id,{...details,purchasedOn:'2026-10-20'}))).kind,'applied');
  assert.equal(await purchased(id),'2026-10-20');
});

test('a malformed purchase date is refused and creates nothing',async()=>{
  for(const purchasedOn of ['10/20/2026','2026-13-40',20261020]){
    const id=randomUUID();await upload(crew,id);
    await assert.rejects(send(crew,command(crew,id,{...details,purchasedOn})),error=>error.code==='22023');
    assert.equal((await db.query('select 1 from public.company_receipts where id=$1',[id])).rows.length,0);
  }
});

test('owners can correct the purchase date; crew cannot',async()=>{
  const id=randomUUID();await upload(crew,id);
  await send(crew,command(crew,id,{...details,purchasedOn:'2026-10-20'}));
  assert.equal((await actor(crew,()=>db.query("update public.company_receipts set purchased_on='2026-10-01' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal(await purchased(id),'2026-10-20');
  await actor(owner,()=>db.query("update public.company_receipts set purchased_on='2026-10-18' where id=$1",[id]));
  assert.equal(await purchased(id),'2026-10-18');
});
