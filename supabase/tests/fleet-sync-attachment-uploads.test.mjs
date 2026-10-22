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
