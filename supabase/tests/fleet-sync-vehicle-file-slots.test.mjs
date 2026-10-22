import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000004',crew='20000000-0000-4000-8000-000000000002';
const vehicle='30000000-0000-4000-8000-000000000001',otherVehicle='30000000-0000-4000-8000-000000000003',issue='30000000-0000-4000-8000-000000000002';
const sha='a'.repeat(64);const legacyPhoto={name:'old.jpg',type:'image/jpeg',dataUrl:'',path:`${company}/${owner}/legacy-photo.jpg`};
const base={id:vehicle,unit:'E1',notes:'Base',photo:legacyPhoto};
const present=value=>({present:true,value});
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user=owner,role='authenticated')=>actor(user,async()=>(await row(sql,args)).result,role);
const manifest=(changes={})=>({attachmentId:randomUUID(),userId:owner,companyId:company,entityType:'vehicle',entityId:vehicle,name:'Front.jpg',mimeType:'image/jpeg',byteSize:1024,sha256:sha,deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline',...changes});
async function verified(changes={}){
  const value=manifest(changes);const user=value.userId;const reservation=await call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(value)],user);
  await actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-sync-files',$1,$2,'{\"size\":1024}')",[reservation.path,user]));
  const lease=await call('select public.begin_fleet_sync_attachment_verification($1,$2) result',[company,value.attachmentId],user);
  await call('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4) result',[lease.leaseToken,lease.objectId,1024,sha],null,'service_role');return value;
}
const beginCopy=(value,user=value.userId)=>call('select public.begin_fleet_sync_attachment_copy($1,$2) result',[company,value.attachmentId],user);
const recordCopy=(value,size=1024,digest=sha)=>call('select public.record_fleet_sync_attachment_copy($1,$2,$3,$4,$5) result',[company,value.userId,value.attachmentId,size,digest],null,'service_role');
async function copied(changes={}){
  const value=await verified(changes);const plan=await beginCopy(value);assert.equal(plan.kind,'copy');
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-files',$1,$2,'{\"size\":1024}')",[plan.destinationPath,value.userId]);
  assert.deepEqual(await recordCopy(value),{kind:'ready'});const ready=await beginCopy(value);assert.equal(ready.kind,'ready');return {value,file:ready.value};
}
function operation(patch,{user=owner,original=base,version='1'}={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,provenance:{userId:user,deviceId:'device-1',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:version,base:original,patch}};
}
const sync=(op,user=owner)=>call('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)],user);
const vehicleData=async()=>(await row('select data,version from public.fleet_vehicles where record_id=$1',[vehicle]));
const online=(data,version,user=admin)=>actor(user,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:version,data}])]));
before(async()=>{
  await loadFleetSyncAttachmentSchema(db);
  await db.exec(`insert into storage.buckets(id,name) values('fleet-files','fleet-files');
    create policy "company members read fleet files" on storage.objects for select to authenticated
    using (bucket_id='fleet-files' and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()))`);
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew',admin,'Admin']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',admin,'admin']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:base},{collection:'vehicles',event:'insert',recordId:otherVehicle,data:{id:otherVehicle,unit:'E2'}},{collection:'issues',event:'insert',recordId:issue,data:{id:issue,title:'Leak',vehicleId:vehicle}}])]));
});
after(async()=>{await db.close()});

test('replaces a slot with a proven copy through the verified detail path, keeping the old file',async()=>{
  const {value,file}=await copied();assert.deepEqual(file,{name:'Front.jpg',type:'image/jpeg',dataUrl:'',path:`${company}/${owner}/sync-${value.attachmentId}`});
  const op=operation({photo:present(file)});const result=await sync(op);assert.equal(result.kind,'applied');assert.deepEqual(result.record.photo,file);
  assert.deepEqual(await sync(op),result);assert.equal((await vehicleData()).version,2);
  assert.equal((await row("select count(*)::int count from storage.objects where bucket_id='fleet-files'")).count,1);
  assert.equal((await row('select reason from public.fleet_sync_attachment_releases where attachment_id=$1',[value.attachmentId])).reason,'copied');
  assert.equal((await sync(operation({registration:{present:false}},{original:result.record,version:'2'}))).kind,'applied');
});
test('rejects unproven, foreign, misbound or hand-written slot values before changing the record',async()=>{
  const unproven=await verified();await beginCopy(unproven);const path=`${company}/${owner}/sync-${unproven.attachmentId}`;
  await assert.rejects(sync(operation({photo:present({name:'Front.jpg',type:'image/jpeg',dataUrl:'',path})})),error=>error.code==='55000');
  const {file}=await copied();
  for(const bad of [{...file,path:`${company}/${owner}/legacy.jpg`},{...file,name:'Other.jpg'},{...file,type:'image/png'},{...file,dataUrl:'data:x'},{...file,extra:1},'photo.jpg'])
    await assert.rejects(sync(operation({photo:present(bad)})),error=>['22023','55000'].includes(error.code),JSON.stringify(bad));
  await assert.rejects(sync(operation({photo:present(file)},{user:admin}),admin),error=>error.code==='42501');
  const other=await copied({entityId:otherVehicle});await assert.rejects(sync(operation({photo:present(other.file)})),error=>error.code==='55000');
  await assert.rejects(sync({...operation({photo:present(file)}),entityType:'issue',entityId:issue,mutation:{kind:'update',baseRevision:'1',base:{id:issue,title:'Leak',vehicleId:vehicle},patch:{photo:present(file)}}}),/different sync adapter/);
  assert.deepEqual((await vehicleData()).data.photo,legacyPhoto);
  await db.query("delete from storage.objects where bucket_id='fleet-files' and name=$1",[file.path]);await assert.rejects(sync(operation({photo:present(file)})),error=>error.code==='55000');
});
test('overlapping slot replacements require review; approval revalidates the proven copy',async()=>{
  const mine=await copied();const theirs=await copied({userId:admin,entityId:vehicle});
  await online({...base,photo:theirs.file},1);
  const pending=await sync(operation({photo:present(mine.file)}));assert.equal(pending.kind,'awaiting_review');assert.deepEqual((await vehicleData()).data.photo,theirs.file);
  const snapshot=await call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle]);
  const option=snapshot.fields.photo.options[0];assert.deepEqual(option.value,present(mine.file));
  const request={requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,reviewToken:snapshot.reviewToken,choices:{photo:option.source}};
  await db.query("update storage.objects set id=gen_random_uuid() where bucket_id='fleet-files' and name=$1",[mine.file.path]);
  await assert.rejects(call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify(request)]),error=>error.code==='55000');
  await db.query("update storage.objects set id=(select copy_object_id from public.fleet_sync_attachment_copies where destination_path=$1) where bucket_id='fleet-files' and name=$1",[mine.file.path]);
  const decision=await call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify({...request,requestId:randomUUID()})],admin);assert.ok(decision);
  assert.deepEqual((await vehicleData()).data.photo,mine.file);assert.equal((await row("select count(*)::int count from storage.objects where bucket_id='fleet-files'")).count,2);
});
test('copies require current manager access, verified bytes, vehicle uploads and a single use',async()=>{
  const unverified=manifest();await call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(unverified)]);await assert.rejects(beginCopy(unverified),error=>error.code==='55000');
  const issueUpload=await verified({entityType:'issue',entityId:issue});await assert.rejects(beginCopy(issueUpload),error=>error.code==='22023');
  const value=await verified();await assert.rejects(beginCopy(value,crew),error=>error.code==='42501');await assert.rejects(beginCopy(value,admin),error=>error.code==='P0002');
  await beginCopy(value);const document={schemaVersion:1,requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,attachmentId:value.attachmentId,documentName:'Doc',provenance:{userId:owner,deviceId:'device-1',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'}};
  await assert.rejects(call('select public.begin_fleet_sync_document_attach($1::jsonb) result',[JSON.stringify(document)]),error=>error.code==='PT409');
  const documented=await verified();await call('select public.begin_fleet_sync_document_attach($1::jsonb) result',[JSON.stringify({...document,requestId:randomUUID(),attachmentId:documented.attachmentId})]);
  await assert.rejects(beginCopy(documented),error=>error.code==='PT409');
  const released=await verified();await call('select public.request_fleet_sync_attachment_release($1,$2) result',[company,released.attachmentId]);await assert.rejects(beginCopy(released),error=>error.code==='55000');
});
test('copy proof is service-only, hash-checked and immutable',async()=>{
  const value=await verified();const plan=await beginCopy(value);assert.deepEqual(await recordCopy(value),{kind:'missing'});
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('fleet-files',$1,$2)",[plan.destinationPath,owner]);
  assert.deepEqual(await recordCopy(value,1024,'b'.repeat(64)),{kind:'mismatch'});
  await assert.rejects(call('select public.record_fleet_sync_attachment_copy($1,$2,$3,$4,$5) result',[company,owner,value.attachmentId,1024,sha]),error=>error.code==='42501');
  assert.deepEqual(await recordCopy(value),{kind:'ready'});await assert.rejects(db.query('update public.fleet_sync_attachment_copies set copy_object_id=gen_random_uuid()'),/append-only/);
});
