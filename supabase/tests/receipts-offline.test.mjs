import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadReceiptSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline receipts: the device uploads into its own receipt-files folder under
// the existing Storage policies, then the command creates the receipt only for
// that exact path and declared size, attributed by the existing trigger.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const details={name:'Fuel',amountCents:4599,fileName:'fuel.jpg',mimeType:'image/jpeg',byteSize:2048};
function command(user,receiptId,payload=details){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'receipt',entityId:receiptId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'receipt.create',payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const path=(user,id)=>`${company}/${user}/sync-${id}`;
const upload=(user,id,size=2048)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipt-files',$1,$2,$3)",[path(user,id),user,JSON.stringify({size})]));
const receipts=async()=>(await db.query('select id,name,amount_cents::int amount,uploaded_by,uploaded_by_name,storage_path from public.company_receipts order by created_at')).rows;
before(async()=>{await loadReceiptSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew Person',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('creates the attributed receipt for the uploaded file once and replays without another',async()=>{
  const id=randomUUID();await upload(crew,id);const op=command(crew,id);const result=await send(op);
  assert.equal(result.notApplied,undefined);assert.equal(result.record.amountCents,4599);assert.equal(result.record.storagePath,path(crew,id));
  assert.deepEqual(await send(op),result);
  assert.deepEqual(await receipts(),[{id,name:'Fuel',amount:4599,uploaded_by:crew,uploaded_by_name:'Crew Person',storage_path:path(crew,id)}]);
  await assert.rejects(send(command(crew,id)),error=>error.code==='23505');
  // The uploader can no longer remove the referenced file.
  await actor(crew,()=>db.query("delete from storage.objects where bucket_id='receipt-files'"));assert.equal((await db.query('select count(*)::int c from storage.objects')).rows[0].c,1);
});
test('waits for the file, and refuses a stored file of another size without creating anything',async()=>{
  const id=randomUUID();await assert.rejects(send(command(crew,id)),error=>error.code==='55000');
  await upload(crew,id,999);const result=await send(command(crew,id));assert.equal(result.notApplied,'file_mismatch');assert.equal(result.record,null);
  assert.deepEqual(await receipts(),[]);
});
test('another member cannot claim a file in someone else\'s folder or reuse their receipt ID',async()=>{
  const id=randomUUID();await upload(crew,id);
  await assert.rejects(upload(tech,randomUUID()).then(()=>actor(tech,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipt-files',$1,$2,'{\"size\":2048}')",[path(crew,randomUUID()),tech]))),error=>error.code==='42501');
  await assert.rejects(send(command(tech,id)),error=>error.code==='55000');
  await send(command(crew,id));await upload(tech,id);
  await assert.rejects(send(command(tech,id)),error=>error.code==='23505');
});
test('validates the payload and requires company membership',async()=>{
  const id=randomUUID();await upload(crew,id);
  for(const payload of [{...details,amountCents:0},{...details,amountCents:1.5},{...details,mimeType:'image/gif'},{...details,name:' '},{...details,byteSize:10485761},{...details,extra:1}])
    await assert.rejects(send(command(crew,id,payload)),error=>error.code==='22023',JSON.stringify(payload));
  await assert.rejects(send(command(outsider,randomUUID())),error=>error.code==='42501');
  assert.deepEqual(await receipts(),[]);
});
