import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
// Path-only Storage removals must be re-authorized immediately before they run,
// and proven fleet-files copies must survive legacy deletion paths.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const vehicle='30000000-0000-4000-8000-000000000001';
const sha='a'.repeat(64);
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user=owner,role='authenticated')=>actor(user,async()=>(await row(sql,args)).result,role);
const service=(sql,args)=>call(sql,args,null,'service_role');
const manifest=(changes={})=>({attachmentId:randomUUID(),userId:owner,companyId:company,entityType:'vehicle',entityId:vehicle,name:'Registration.pdf',mimeType:'application/pdf',byteSize:1024,sha256:sha,deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline',...changes});
const putStaging=(path,user=owner)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-sync-files',$1,$2,'{\"size\":1024}')",[path,user]));
const putFile=path=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-files',$1,$2,'{\"size\":1024}')",[path,owner]);
const removeObject=(bucket,path)=>db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,path]);
const exists=async(bucket,path)=>(await row('select count(*)::int count from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).count===1;
const reserve=value=>call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(value)]);
const beginVerify=value=>call('select public.begin_fleet_sync_attachment_verification($1,$2) result',[company,value.attachmentId]);
const complete=(lease,digest=sha)=>service('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4) result',[lease.leaseToken,lease.objectId,1024,digest]);
const release=(lease,removed)=>service('select public.release_fleet_sync_attachment_verification($1,$2) result',[lease.leaseToken,removed]);
const authorizeMismatch=lease=>service('select public.authorize_fleet_sync_attachment_mismatch_removal($1) result',[lease.leaseToken]);
const authorizeCopy=value=>service('select public.authorize_fleet_sync_copy_removal($1,$2,$3) result',[company,value.userId,value.attachmentId]);
async function ageLease(lease,remaining){
  await db.exec('set session_replication_role=replica');
  await db.query("update public.fleet_sync_attachment_verifications set started_at=now()-interval '1 hour',expires_at=now()+$2::interval where lease_token=$1",[lease.leaseToken,remaining]);
  await db.exec('set session_replication_role=origin');
}
async function mismatched(){
  const value=manifest();const reservation=await reserve(value);await putStaging(reservation.path);const lease=await beginVerify(value);
  assert.equal((await complete(lease,'b'.repeat(64))).kind,'mismatch');return {value,reservation,lease};
}
async function verified(){
  const value=manifest();const reservation=await reserve(value);await putStaging(reservation.path);const lease=await beginVerify(value);
  assert.equal((await complete(lease)).kind,'verified');return value;
}
const documentRequest=value=>({schemaVersion:1,requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,attachmentId:value.attachmentId,documentName:'Registration',provenance:{userId:owner,deviceId:'device-1',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'}});
const beginDocument=value=>call('select public.begin_fleet_sync_document_attach($1::jsonb) result',[JSON.stringify(documentRequest(value))]);
const recordDocument=(value,digest=sha)=>service('select public.record_fleet_sync_document_copy($1,$2,$3,$4,$5) result',[company,value.userId,value.attachmentId,1024,digest]);
const beginSlot=value=>call('select public.begin_fleet_sync_attachment_copy($1,$2) result',[company,value.attachmentId]);
const recordSlot=(value,digest=sha)=>service('select public.record_fleet_sync_attachment_copy($1,$2,$3,$4,$5) result',[company,value.userId,value.attachmentId,1024,digest]);
before(async()=>{
  await loadFleetSyncAttachmentSchema(db);
  // Legacy uploader delete policy (202508240002) for the restrictive retention check.
  await db.exec(`insert into storage.buckets(id,name) values('fleet-files','fleet-files');
    create policy "company members read fleet files" on storage.objects for select to authenticated
    using (bucket_id='fleet-files' and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()));
    create policy "uploaders delete own fleet files" on storage.objects for delete to authenticated
    using (bucket_id='fleet-files' and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()) and (storage.foldername(name))[2] = auth.uid()::text)`);
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4)',[owner,'Owner',crew,'Crew']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1'}}])]));
});
after(async()=>{await db.close()});

test('authorizes mismatch removal only for the leased object with ample lease left',async()=>{
  const {reservation,lease}=await mismatched();
  assert.deepEqual(await authorizeMismatch(lease),{kind:'remove',path:reservation.path,objectId:lease.objectId});
  await ageLease(lease,'4 minutes');assert.deepEqual(await authorizeMismatch(lease),{kind:'stale',reason:'lease_ending'});
  await ageLease(lease,'9 minutes');await removeObject('fleet-sync-files',reservation.path);assert.deepEqual(await authorizeMismatch(lease),{kind:'stale',reason:'missing'});
  await release(lease,true);assert.deepEqual(await authorizeMismatch(lease),{kind:'stale',reason:'released'});
});
test('a stalled verifier cannot remove bytes re-uploaded after its lease expired',async()=>{
  const stalled=await mismatched();await ageLease(stalled.lease,'-1 minute');
  // A later verification takes over, removes the mismatched object and releases.
  const next=await beginVerify(stalled.value);assert.equal(next.kind,'lease');assert.equal((await complete(next,'c'.repeat(64))).kind,'mismatch');
  assert.equal((await authorizeMismatch(next)).kind,'remove');await removeObject('fleet-sync-files',stalled.reservation.path);await release(next,true);
  await putStaging(stalled.reservation.path);
  assert.deepEqual(await authorizeMismatch(stalled.lease),{kind:'stale',reason:'lease_ending'});
  assert.equal(await exists('fleet-sync-files',stalled.reservation.path),true);
});
test('mismatch removal authorization is service-only and requires a mismatch outcome',async()=>{
  const value=manifest();const reservation=await reserve(value);await putStaging(reservation.path);const lease=await beginVerify(value);
  await assert.rejects(authorizeMismatch(lease),error=>error.code==='PT409');
  await assert.rejects(call('select public.authorize_fleet_sync_attachment_mismatch_removal($1) result',[lease.leaseToken]),error=>error.code==='42501');
  await assert.rejects(service('select public.authorize_fleet_sync_attachment_mismatch_removal($1) result',[randomUUID()]),error=>error.code==='P0002');
});
test('mismatched document copies are removable only until a copy is proven',async()=>{
  const value=await verified();const started=await beginDocument(value);await putFile(started.destinationPath);
  assert.deepEqual(await recordDocument(value,'b'.repeat(64)),{kind:'mismatch'});
  assert.equal((await authorizeCopy(value)).kind,'remove');assert.equal((await authorizeCopy(value)).path,started.destinationPath);
  await removeObject('fleet-files',started.destinationPath);assert.deepEqual(await authorizeCopy(value),{kind:'stale',reason:'missing'});
  // Another invocation copies the good bytes and proves them; a stalled
  // mismatch handler must now leave the canonical copy alone.
  await putFile(started.destinationPath);assert.deepEqual(await recordDocument(value),{kind:'ready'});
  assert.deepEqual(await authorizeCopy(value),{kind:'stale',reason:'proven'});
});
test('slot copies are fenced the same way; requests must exist and callers be the service',async()=>{
  const value=await verified();const plan=await beginSlot(value);await putFile(plan.destinationPath);
  assert.deepEqual(await recordSlot(value,'b'.repeat(64)),{kind:'mismatch'});assert.equal((await authorizeCopy(value)).kind,'remove');
  assert.deepEqual(await recordSlot(value),{kind:'ready'});assert.deepEqual(await authorizeCopy(value),{kind:'stale',reason:'proven'});
  await assert.rejects(authorizeCopy(manifest()),error=>error.code==='P0002');
  await assert.rejects(call('select public.authorize_fleet_sync_copy_removal($1,$2,$3) result',[company,owner,value.attachmentId]),error=>error.code==='42501');
});
test('proven copies survive direct uploader deletes and the legacy delete filter',async()=>{
  const value=await verified();const started=await beginDocument(value);await putFile(started.destinationPath);assert.deepEqual(await recordDocument(value),{kind:'ready'});
  const ordinary=`${company}/${owner}/${randomUUID()}-photo.jpg`;const unproven=`${company}/${owner}/sync-${randomUUID()}`;await putFile(ordinary);await putFile(unproven);
  await actor(owner,()=>db.query("delete from storage.objects where bucket_id='fleet-files'"));
  assert.equal(await exists('fleet-files',started.destinationPath),true);assert.equal(await exists('fleet-files',ordinary),false);assert.equal(await exists('fleet-files',unproven),false);
  const paths=[ordinary,started.destinationPath,`${other}/${owner}/sync-${value.attachmentId}`];
  assert.deepEqual(await service('select public.fleet_sync_protected_copy_paths($1,$2) result',[company,paths]),[started.destinationPath]);
  assert.deepEqual(await service('select public.fleet_sync_protected_copy_paths($1,$2) result',[other,paths]),[]);
  await assert.rejects(call('select public.fleet_sync_protected_copy_paths($1,$2) result',[company,paths]),error=>error.code==='42501');
});
