import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCompanyDocumentSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline company documents: the device uploads into its own fleet-files folder,
// then the command creates the document only for that exact path and size.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const details={name:'SOP',fileName:'sop.pdf',mimeType:'application/pdf',byteSize:4096};
const command=(user,id,payload=details)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'company_document',entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'document.create',payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const upload=(user,id,size=4096)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-files',$1,$2,$3)",[`${company}/${user}/doc-${id}`,user,JSON.stringify({size})]));
before(async()=>{await loadCompanyDocumentSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('an owner creates the document for the uploaded file once',async()=>{
  const id=randomUUID();await assert.rejects(send(owner,command(owner,id)),error=>error.code==='55000');
  await upload(owner,id);const op=command(owner,id);const result=await send(owner,op);
  assert.equal(result.notApplied,undefined);assert.equal(result.record.storagePath,`${company}/${owner}/doc-${id}`);assert.deepEqual(await send(owner,op),result);
  assert.deepEqual(await row('select name,file_name,created_by from public.company_documents where id=$1',[id]),{name:'SOP',file_name:'sop.pdf',created_by:owner});
  await assert.rejects(send(owner,command(owner,id)),error=>error.code==='23505');
});
test('a stored file of another size creates nothing; crew and invalid documents are refused',async()=>{
  const id=randomUUID();await upload(owner,id,10);assert.equal((await send(owner,command(owner,id))).notApplied,'file_mismatch');
  const other=randomUUID();await upload(crew,other);await assert.rejects(send(crew,command(crew,other)),error=>error.code==='42501');
  for(const payload of [{...details,mimeType:'text/plain'},{...details,byteSize:8388609},{...details,name:' '}])await assert.rejects(send(owner,command(owner,randomUUID(),payload)),error=>error.code==='22023');
  assert.equal((await row('select count(*)::int count from public.company_documents')).count,0);
});
