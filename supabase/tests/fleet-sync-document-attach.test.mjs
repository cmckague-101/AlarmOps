import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',admin='20000000-0000-4000-8000-000000000004';
const vehicle='30000000-0000-4000-8000-000000000001',issue='30000000-0000-4000-8000-000000000002';
const sha='a'.repeat(64);
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user=owner,role='authenticated')=>actor(user,async()=>(await row(sql,args)).result,role);
const manifest=(changes={})=>({attachmentId:randomUUID(),userId:owner,companyId:company,entityType:'vehicle',entityId:vehicle,name:'Registration.pdf',mimeType:'application/pdf',byteSize:1024,sha256:sha,deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline',...changes});
const request=(value,changes={})=>({schemaVersion:1,requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:value.entityId,attachmentId:value.attachmentId,documentName:'Registration',provenance:{userId:value.userId,deviceId:'device-1',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},...changes});
const begin=(value,user=owner)=>call('select public.begin_fleet_sync_document_attach($1::jsonb) result',[JSON.stringify(value)],user);
const complete=(value,user=owner)=>call('select public.complete_fleet_sync_document_attach($1::jsonb) result',[JSON.stringify(value)],user);
const recordCopy=(value,size=1024,digest=sha)=>call('select public.record_fleet_sync_document_copy($1,$2,$3,$4,$5) result',[company,value.userId,value.attachmentId,size,digest],null,'service_role');
const putFile=(bucket,path,user=owner)=>db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',[bucket,path,user,JSON.stringify({size:1024})]);
const vehicleData=async()=>(await row('select data,version from public.fleet_vehicles where record_id=$1',[vehicle]));
async function verified(changes={},user=owner){
  const value=manifest({userId:user,...changes});const reservation=await call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(value)],user);
  await actor(user,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-sync-files',$1,$2,'{\"size\":1024}')",[reservation.path,user]));
  const lease=await call('select public.begin_fleet_sync_attachment_verification($1,$2) result',[company,value.attachmentId],user);
  await call('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4) result',[lease.leaseToken,lease.objectId,1024,sha],null,'service_role');
  return value;
}
async function copied(value,req=request(value)){const started=await begin(req);await putFile('fleet-files',started.destinationPath);assert.deepEqual(await recordCopy(value),{kind:'ready'});return {req,started}}
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
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1',notes:'Base'}},{collection:'issues',event:'insert',recordId:issue,data:{id:issue,title:'Leak',vehicleId:vehicle}}])]));
});
after(async()=>{await db.close()});

test('appends one verified vehicle document atomically and replays without another mutation',async()=>{
  const value=await verified();const req=request(value);const started=await begin(req);
  assert.deepEqual(started,{kind:'copy',sourcePath:`${company}/${owner}/${value.attachmentId}`,destinationPath:`${company}/${owner}/sync-${value.attachmentId}`,byteSize:1024,sha256:sha,contentType:'application/pdf'});
  await putFile('fleet-files',started.destinationPath);assert.deepEqual(await recordCopy(value),{kind:'ready'});assert.deepEqual(await begin(req),{kind:'ready'});
  const effects=(await row('select count(*)::int count from public.sync_test_effects')).count;
  const result=await complete(req);assert.equal(result.kind,'applied');assert.equal(result.revision,'2');assert.equal(result.path,started.destinationPath);
  const {data}=await vehicleData();assert.deepEqual(data.documents,[{id:value.attachmentId,name:'Registration',file:{name:'Registration.pdf',type:'application/pdf',dataUrl:'',path:started.destinationPath}}]);assert.equal(data.notes,'Base');
  assert.deepEqual(await complete(req),result);assert.deepEqual(await begin(req),{kind:'completed',result});
  assert.equal((await row('select count(*)::int count from public.sync_test_effects')).count,effects+1);assert.equal((await vehicleData()).version,2);
});
test('preserves concurrent online edits and releases unattached quota only after applying',async()=>{
  const value=await verified();const {req}=await copied(value);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:1,data:{id:vehicle,unit:'E1',notes:'Online edit',documents:[{id:'existing',name:'Insurance',file:{name:'i.pdf',type:'application/pdf',dataUrl:'',path:`${company}/${owner}/i.pdf`}}]}}])]));
  const usage=async()=>(await call('select row_to_json(q) result from public.fleet_sync_attachment_quota_usage($1) q',[owner],owner,'fireops_sync_writer'));
  assert.equal((await usage()).retained_count,1);
  await complete(req);const {data}=await vehicleData();assert.equal(data.notes,'Online edit');assert.deepEqual(data.documents.map(item=>item.id),['existing',value.attachmentId]);
  assert.equal((await usage()).retained_count,0);
});
test('requires verified bytes, the reserved vehicle and one immutable request per attachment',async()=>{
  const unverified=manifest();await call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(unverified)]);await assert.rejects(begin(request(unverified)),error=>error.code==='55000');
  const issueUpload=await verified({entityType:'issue',entityId:issue});await assert.rejects(begin(request(issueUpload,{entityId:issue})),error=>error.code==='22023');
  const value=await verified();const req=request(value);await begin(req);
  await assert.rejects(begin({...req,documentName:'Other'}),error=>error.code==='PT409');await assert.rejects(begin(request(value)),error=>error.code==='PT409');
  const second=await verified();await assert.rejects(begin(request(second,{requestId:req.requestId})),error=>error.code==='PT409');
  await assert.rejects(begin(request(value,{entityId:randomUUID()})),error=>error.code==='22023');
  for(const change of [{documentName:' '},{documentName:'a\nb'},{entityType:'issue'},{extra:1},{provenance:{...req.provenance,connectivity:'wifi'}}])await assert.rejects(begin({...req,...change}),error=>error.code==='22023');
});
test('copy proof must match the receipt and remain the stored object until completion',async()=>{
  const value=await verified();const req=request(value);const started=await begin(req);
  assert.deepEqual(await recordCopy(value),{kind:'missing'});await putFile('fleet-files',started.destinationPath);
  assert.deepEqual(await recordCopy(value,1024,'b'.repeat(64)),{kind:'mismatch'});assert.deepEqual(await recordCopy(value,1,sha),{kind:'mismatch'});
  await assert.rejects(complete(req),error=>error.code==='55000');
  assert.deepEqual(await recordCopy(value),{kind:'ready'});await db.query("delete from storage.objects where bucket_id='fleet-files'");await putFile('fleet-files',started.destinationPath);
  await assert.rejects(complete(req),/replaced/);assert.equal((await vehicleData()).data.documents,undefined);
});
test('never resurrects a deleted vehicle and keeps the verified bytes retained',async()=>{
  const value=await verified();const {req}=await copied(value);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:vehicle,expectedVersion:1}])]));
  const result=await complete(req);assert.equal(result.kind,'rejected');assert.equal(result.reason,'record_deleted');assert.equal(await vehicleData(),undefined);
  assert.equal((await row("select count(*)::int count from storage.objects where bucket_id='fleet-sync-files'")).count,1);assert.deepEqual(await complete(req),result);
});
test('rechecks current manager access; only the service verifier records copy proof',async()=>{
  const value=await verified();const req=request(value);
  for(const user of [crew,admin])await assert.rejects(begin(req,user),error=>error.code==='42501');
  const started=await begin(req);await putFile('fleet-files',started.destinationPath);
  await assert.rejects(call('select public.record_fleet_sync_document_copy($1,$2,$3,$4,$5) result',[company,owner,value.attachmentId,1024,sha]),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('select * from public.fleet_sync_attachment_links')),error=>error.code==='42501');
  await recordCopy(value);await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);
  await assert.rejects(complete(req),error=>error.code==='42501');assert.equal((await vehicleData()).data.documents,undefined);
  await db.query("update public.company_members set role='owner' where user_id=$1",[owner]);assert.equal((await complete(req)).kind,'applied');
  await assert.rejects(db.query("update public.fleet_sync_attachment_links set result='{\"kind\":\"rejected\"}'"),/append-only/);
  await assert.rejects(db.query('delete from public.fleet_sync_attachment_links'),/append-only/);
});
