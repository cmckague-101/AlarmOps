import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003',admin='20000000-0000-4000-8000-000000000004';
const vehicle='30000000-0000-4000-8000-000000000001',issue='30000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const manifest=(changes={})=>({attachmentId:randomUUID(),userId:owner,companyId:company,entityType:'vehicle',entityId:vehicle,name:'Photo.jpg',mimeType:'image/jpeg',byteSize:1024,sha256:'a'.repeat(64),deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline',...changes});
const reserve=(value,user=owner)=>actor(user,async()=>(await row('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(value)])).result);
const putObject=(path,user=owner,size=1024)=>actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-sync-files',$1,$2,$3::jsonb)",[path,user,JSON.stringify({size})]));
const count=async()=>(await row('select count(*)::int count from public.fleet_sync_attachment_uploads')).count;
before(async()=>{await loadFleetSyncAttachmentSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',outsider,'Outsider',admin,'Admin']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$3),($1,$8,$9)',[company,owner,'owner',crew,'fire_fighter',other,outsider,admin,'admin']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1'}},{collection:'issues',event:'insert',recordId:issue,data:{id:issue,title:'Leak',vehicleId:vehicle}}])]));
});
after(async()=>{await db.close()});

test('reserves a stable private path and replays the identical reservation without new rows',async()=>{
  const value=manifest();const first=await reserve(value);
  assert.equal(first.schemaVersion,1);assert.equal(first.bucket,'fleet-sync-files');assert.equal(first.path,`${company}/${owner}/${value.attachmentId}`);
  assert.deepEqual(first.manifest,value);assert.equal(first.contentType,'image/jpeg');assert.equal(first.object,null);assert.equal(first.receipt,null);
  assert.deepEqual(await reserve(value),first);assert.equal(await count(),1);
  assert.equal((await row("select public from storage.buckets where id='fleet-sync-files'")).public,false);
});
test('rejects reusing an attachment identity for different bytes or provenance',async()=>{
  const value=manifest();await reserve(value);
  for(const change of [{sha256:'b'.repeat(64)},{byteSize:2048},{name:'Other.jpg'},{savedAt:'2026-01-02T12:00:00.000Z'},{deviceId:'device-2'},{entityType:'issue',entityId:issue}])
    await assert.rejects(reserve({...value,...change}),error=>error.code==='PT409');
  assert.equal(await count(),1);
});
test('rechecks current account, manager role, company and target availability',async()=>{
  await assert.rejects(reserve(manifest({userId:crew}),owner),error=>error.code==='42501');
  await assert.rejects(reserve(manifest({userId:crew}),crew),error=>error.code==='42501');
  await assert.rejects(reserve(manifest({userId:outsider}),outsider),error=>error.code==='42501');
  await assert.rejects(reserve(manifest({companyId:other})),error=>error.code==='42501');
  await assert.rejects(reserve(manifest({entityId:randomUUID()})),error=>error.code==='42501');
  await assert.rejects(reserve(manifest({entityType:'issue'})),error=>error.code==='42501');
  await assert.rejects(reserve(manifest(),null),error=>error.code==='42501');
  assert.equal((await reserve(manifest({userId:admin}),admin)).manifest.userId,admin);
  assert.equal((await reserve(manifest({entityType:'issue',entityId:issue}))).manifest.entityType,'issue');
  const kept=manifest();await reserve(kept);await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);
  await assert.rejects(reserve(kept),error=>error.code==='42501');
});
test('validates manifest shape, declared size, digest, file type and provenance',async()=>{
  const invalid=[{byteSize:0},{byteSize:10*1024*1024+1},{byteSize:1.5},{byteSize:'1024'},{sha256:'A'.repeat(64)},{sha256:'a'.repeat(63)},{name:' '},{name:'a\nb'},{name:'x'.repeat(256)},
    {deviceId:''},{deviceId:'x'.repeat(201)},{savedAt:'yesterday'},{connectivity:'cellular'},{entityType:'crew'},{attachmentId:'not-a-uuid'},{attachmentId:randomUUID().toUpperCase()}];
  for(const change of invalid)await assert.rejects(reserve(manifest(change)),error=>error.code==='22023',JSON.stringify(change));
  for(const mimeType of [null,'text/html','image/svg+xml'])await assert.rejects(reserve(manifest({mimeType})),/not supported/);
  const extra={...manifest(),extra:true};await assert.rejects(reserve(extra),error=>error.code==='22023');
  const {deviceId:_,...missing}=manifest();await assert.rejects(reserve(missing),error=>error.code==='22023');
  assert.equal(await count(),0);
});
test('limits retained unattached remote bytes per user across companies',async()=>{
  await db.query('insert into public.company_members values($1,$2,$3)',[other,owner,'owner']);
  const otherVehicle=randomUUID();await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[other,JSON.stringify([{collection:'vehicles',event:'insert',recordId:otherVehicle,data:{id:otherVehicle,unit:'X1'}}])]));
  for(let index=0;index<9;index++)await reserve(manifest({byteSize:10*1024*1024}));
  await reserve(manifest({companyId:other,entityId:otherVehicle,byteSize:10*1024*1024}));
  await assert.rejects(reserve(manifest({byteSize:1})),error=>error.code==='53400');
  const first=(await row('select manifest from public.fleet_sync_attachment_uploads limit 1')).manifest;assert.equal((await reserve(first)).manifest.attachmentId,first.attachmentId);
});
test('storage accepts only the reserving manager at the exact unverified path',async()=>{
  const value=manifest();const reservation=await reserve(value);
  await assert.rejects(putObject(`${company}/${owner}/${randomUUID()}`),error=>error.code==='42501');
  await assert.rejects(putObject(reservation.path,admin),error=>error.code==='42501');
  await assert.rejects(putObject(reservation.path,crew),error=>error.code==='42501');
  await putObject(reservation.path);
  const replay=await reserve(value);assert.equal(replay.object.byteSize,1024);assert.match(replay.object.objectId,/^[0-9a-f-]{36}$/);
  await assert.rejects(putObject(reservation.path),error=>error.code==='23505');
});
test('clients cannot overwrite, delete or read other users objects; demotion stops uploads',async()=>{
  const reservation=await reserve(manifest());await putObject(reservation.path);
  const updated=await actor(owner,()=>db.query("update storage.objects set metadata='{\"size\":1}' where name=$1",[reservation.path]));assert.equal(updated.affectedRows,0);
  const deleted=await actor(owner,()=>db.query('delete from storage.objects where name=$1',[reservation.path]));assert.equal(deleted.affectedRows,0);
  assert.equal((await actor(owner,()=>db.query('select id from storage.objects'))).rows.length,1);
  for(const user of [admin,crew,outsider])assert.equal((await actor(user,()=>db.query('select id from storage.objects'))).rows.length,0);
  const later=await reserve(manifest());await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);
  await assert.rejects(putObject(later.path),error=>error.code==='42501');
  assert.equal((await actor(owner,()=>db.query('select id from storage.objects'))).rows.length,0);
});
test('reservation rows are private and immutable; a verification receipt can be set exactly once',async()=>{
  const reservation=await reserve(manifest());
  for(const user of [owner,crew])await assert.rejects(actor(user,()=>db.query('select * from public.fleet_sync_attachment_uploads')),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query("update public.fleet_sync_attachment_uploads set receipt='{}'")),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query("insert into public.fleet_sync_attachment_uploads(company_id,user_id,attachment_id,entity_type,entity_id,byte_size,sha256,content_type,manifest,object_path,verified_object_id,verified_at,receipt) select company_id,user_id,gen_random_uuid(),entity_type,entity_id,byte_size,sha256,content_type,manifest,object_path,gen_random_uuid(),now(),'{}' from public.fleet_sync_attachment_uploads")),error=>error.code==='42501');
  await assert.rejects(db.query("update public.fleet_sync_attachment_uploads set sha256=$1",['b'.repeat(64)]),/immutable/);
  await assert.rejects(db.query('delete from public.fleet_sync_attachment_uploads'),/immutable/);
  await db.query("update public.fleet_sync_attachment_uploads set verified_object_id=gen_random_uuid(),verified_at=now(),receipt='{\"kind\":\"uploaded\"}'");
  await assert.rejects(db.query("update public.fleet_sync_attachment_uploads set receipt='{\"kind\":\"forged\"}'"),/immutable/);
  assert.deepEqual((await reserve(reservation.manifest)).receipt,{kind:'uploaded'});
  await assert.rejects(putObject(reservation.path),error=>error.code==='42501');
  await db.query('delete from public.companies where id=$1',[company]);assert.equal(await count(),0);
});

const begin=(value,user=owner)=>actor(user,async()=>(await row('select public.begin_fleet_sync_attachment_verification($1,$2) result',[value.companyId,value.attachmentId])).result);
const complete=(lease,objectId,size,digest)=>actor(null,async()=>(await row('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4) result',[lease,objectId,size,digest])).result,'service_role');
const release=(lease,removed=true)=>actor(null,async()=>(await row('select public.release_fleet_sync_attachment_verification($1,$2) result',[lease,removed])).result,'service_role');
const leased=async(value=manifest())=>{const reservation=await reserve(value);await putObject(reservation.path);return {value,reservation,lease:await begin(value)}};
test('trusted verifier issues one receipt for matching stored bytes and replays it',async()=>{
  const value=manifest();await reserve(value);assert.equal((await begin(value)).kind,'not_uploaded');
  const {lease}=await leased(value);assert.equal(lease.kind,'lease');assert.equal(lease.byteSize,1024);assert.equal(lease.sha256,value.sha256);
  await assert.rejects(begin(value),error=>error.code==='PT409');
  const result=await complete(lease.leaseToken,lease.objectId,1024,value.sha256);assert.equal(result.kind,'verified');
  const receipt=result.reservation.receipt;assert.deepEqual({...receipt,verifiedAt:undefined},{schemaVersion:1,kind:'uploaded',companyId:company,userId:owner,attachmentId:value.attachmentId,entityType:'vehicle',entityId:vehicle,bucket:'fleet-sync-files',path:lease.path,byteSize:1024,sha256:value.sha256,objectId:lease.objectId,verifiedAt:undefined});
  assert.deepEqual(await complete(lease.leaseToken,lease.objectId,1,'b'.repeat(64)),result);
  assert.deepEqual((await begin(value)).reservation.receipt,receipt);assert.deepEqual((await reserve(value)).receipt,receipt);
});
test('mismatched bytes never get a receipt and re-upload waits for verifier removal',async()=>{
  const {value,reservation,lease}=await leased();
  const result=await complete(lease.leaseToken,lease.objectId,1024,'b'.repeat(64));assert.equal(result.kind,'mismatch');assert.equal(result.reservation.receipt,null);
  await actor(null,()=>db.query('delete from storage.objects where id=$1',[lease.objectId]),'service_role');
  await assert.rejects(putObject(reservation.path),error=>error.code==='42501');assert.equal((await begin(value)).kind,'not_uploaded');
  assert.deepEqual(await release(lease.leaseToken),{kind:'released',objectRemoved:true});
  await putObject(reservation.path);const next=await begin(value);assert.equal(next.kind,'lease');assert.notEqual(next.objectId,lease.objectId);
  assert.equal((await complete(next.leaseToken,next.objectId,1024,value.sha256)).kind,'verified');
  const attempts=(await db.query('select outcome,observed_sha256 from public.fleet_sync_attachment_verifications order by started_at')).rows;
  assert.deepEqual(attempts,[{outcome:'mismatch',observed_sha256:'b'.repeat(64)},{outcome:'verified',observed_sha256:value.sha256}]);
});
test('replaced or missing objects, revoked access and expired leases fail closed',async()=>{
  const first=await leased();assert.equal((await complete(first.lease.leaseToken,randomUUID(),1024,first.value.sha256)).kind,'missing');
  const second=await leased();await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);
  assert.deepEqual(await complete(second.lease.leaseToken,second.lease.objectId,1024,second.value.sha256),{kind:'access_revoked'});
  await db.query("update public.company_members set role='owner' where user_id=$1",[owner]);
  const third=await leased();await db.exec('set session_replication_role=replica');await db.query("update public.fleet_sync_attachment_verifications set started_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' where lease_token=$1",[third.lease.leaseToken]);await db.exec('set session_replication_role=origin');
  assert.equal((await complete(third.lease.leaseToken,third.lease.objectId,1024,third.value.sha256)).kind,'expired');
  assert.equal((await row('select count(*)::int count from public.fleet_sync_attachment_uploads where receipt is not null')).count,0);
  assert.equal((await begin(third.value)).kind,'lease');
});
test('only the service verifier records observations; clients cannot begin for others',async()=>{
  const {value,lease}=await leased();
  await assert.rejects(actor(owner,()=>db.query('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4)',[lease.leaseToken,lease.objectId,1024,value.sha256])),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('select public.release_fleet_sync_attachment_verification($1,true)',[lease.leaseToken])),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('select * from public.fleet_sync_attachment_verifications')),error=>error.code==='42501');
  await assert.rejects(begin(value,admin),error=>error.code==='P0002');for(const user of [crew,outsider])await assert.rejects(begin(value,user),error=>error.code==='42501');
  await assert.rejects(release(lease.leaseToken),error=>error.code==='PT409');
  await complete(lease.leaseToken,lease.objectId,1024,value.sha256);
  await assert.rejects(actor(null,()=>db.query("update public.fleet_sync_attachment_verifications set outcome='mismatch'"),'service_role'),/append-only/);
  await assert.rejects(actor(null,()=>db.query("update public.fleet_sync_attachment_uploads set receipt='{}'"),'service_role'),/immutable/);
});
