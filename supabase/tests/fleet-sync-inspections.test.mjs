import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',admin='20000000-0000-4000-8000-000000000004';
const vehicle='30000000-0000-4000-8000-000000000001';const sha='a'.repeat(64);
const prior={id:randomUUID(),assignmentIncident:'',inspectorId:admin,inspectorName:'Admin',createdAt:'2025-12-01T00:00:00Z',items:[{id:'i1',label:'Tires',kind:'pass_fail',result:'Pass'}]};
const base={id:vehicle,unit:'E1',status:'Ready',inspections:[prior]};
const present=value=>({present:true,value});
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user=owner,role='authenticated')=>actor(user,async()=>(await row(sql,args)).result,role);
const inspection=(user=owner,name='Owner',items=[{id:'i1',label:'Tires',kind:'pass_fail',result:'Fail',defectNotes:'Low tread'}],changes={})=>({id:randomUUID(),assignmentIncident:'Ridge Fire',inspectorId:user,inspectorName:name,createdAt:'2026-01-01T12:00:00.000Z',items,...changes});
function operation(entry,{user=owner,original=base,version='1',list=original.inspections}={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,provenance:{userId:user,deviceId:'device',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:version,base:original,patch:{inspections:present([entry,...list])}}};
}
const sync=(op,user=owner)=>call('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)],user);
const data=async()=>(await row('select data from public.fleet_vehicles where record_id=$1',[vehicle])).data;
async function copiedPhoto(){
  const value={attachmentId:randomUUID(),userId:owner,companyId:company,entityType:'vehicle',entityId:vehicle,name:'Cab.jpg',mimeType:'image/jpeg',byteSize:1024,sha256:sha,deviceId:'device',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'};
  const reservation=await call('select public.reserve_fleet_sync_attachment($1::jsonb) result',[JSON.stringify(value)]);
  await actor(owner,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('fleet-sync-files',$1,$2,'{\"size\":1024}')",[reservation.path,owner]));
  const lease=await call('select public.begin_fleet_sync_attachment_verification($1,$2) result',[company,value.attachmentId]);
  await call('select public.complete_fleet_sync_attachment_verification($1,$2,$3,$4) result',[lease.leaseToken,lease.objectId,1024,sha],null,'service_role');
  const plan=await call('select public.begin_fleet_sync_attachment_copy($1,$2) result',[company,value.attachmentId]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('fleet-files',$1,$2)",[plan.destinationPath,owner]);
  await call('select public.record_fleet_sync_attachment_copy($1,$2,$3,$4,$5) result',[company,owner,value.attachmentId,1024,sha],null,'service_role');
  return (await call('select public.begin_fleet_sync_attachment_copy($1,$2) result',[company,value.attachmentId])).value;
}
before(async()=>{
  await loadFleetSyncAttachmentSchema(db);
  await db.exec(`insert into storage.buckets(id,name) values('fleet-files','fleet-files');
    create policy "company members read fleet files" on storage.objects for select to authenticated
    using (bucket_id='fleet-files' and public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid()))`);
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',tech,'Tech',admin,'Admin']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',admin,'admin']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:base}])]));
});
after(async()=>{await db.close()});

test('appends one inspection over concurrent ones with a matching activity, replaying once',async()=>{
  const other=inspection(admin,'Admin');await actor(admin,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:1,data:{...base,inspections:[other,prior]}}])]));
  const entry=inspection();const op=operation(entry);const result=await sync(op);assert.equal(result.kind,'applied');
  assert.deepEqual((await data()).inspections.map(item=>item.id),[entry.id,other.id,prior.id]);
  const [activity]=(await db.query("select data from public.fleet_activities where data->>'action' like '%inspection%'")).rows.map(item=>item.data);
  assert.equal(activity.action,'E1 inspection completed');assert.match(activity.detail,/^1 failed checks · Ridge Fire · Synced from a device/);assert.equal(activity.tone,'urgent');
  assert.deepEqual(await sync(op),result);assert.equal((await db.query('select 1 from public.fleet_activities')).rows.length,1);
});
test('photo items require server-proven copies for this vehicle',async()=>{
  const photo=await copiedPhoto();const photoItem={id:'p1',label:'Interior',kind:'photo',photo};
  assert.equal((await sync(operation(inspection(owner,'Owner',[photoItem])))).kind,'applied');
  const fresh=await data();
  for(const items of [[{id:'p1',label:'Interior',kind:'photo'}],[{...photoItem,photo:{...photo,path:`${company}/${owner}/legacy.jpg`}}],[{...photoItem,photo:{...photo,name:'Other.jpg'}}]])
    await assert.rejects(sync(operation(inspection(owner,'Owner',items),{original:fresh,version:'2'})),error=>['22023','55000'].includes(error.code),JSON.stringify(items));
});
test('rejects edits, removals, multiple entries, foreign inspectors and mixed changes',async()=>{
  const entry=inspection();
  const bad=[operation(entry,{list:[]}),operation(entry,{list:[{...prior,items:[]}]}),{...operation(entry),mutation:{...operation(entry).mutation,patch:{inspections:present([entry,inspection(),prior])}}},
    operation(inspection(admin,'Admin')),operation({...entry,items:[]}),operation({...entry,items:[{id:'x',label:'Tires',kind:'pass_fail'}]}),operation({...entry,extra:1}),
    {...operation(entry),mutation:{...operation(entry).mutation,patch:{inspections:present([entry,prior]),notes:present('x')}}}];
  for(const op of bad)await assert.rejects(sync(op),error=>error.code==='22023',JSON.stringify(op.mutation.patch).slice(0,120));
  assert.deepEqual((await data()).inspections,[prior]);
});
test('shop techs may add their own inspection offline; firefighters may not',async()=>{
  assert.equal((await sync(operation(inspection(tech,'Tech'),{user:tech}),tech)).kind,'applied');
  const current=await data();await assert.rejects(sync(operation(inspection(crew,'Crew'),{user:crew,original:current,version:'2'}),crew),error=>error.code==='42501');
});
test('review cannot pick inspections; a deleted vehicle keeps the inspection as a retained candidate',async()=>{
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:vehicle,expectedVersion:1}])]));
  const pending=await sync(operation(inspection()));assert.equal(pending.kind,'awaiting_review');
  const snapshot=await call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle]);
  await assert.rejects(call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify({requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,reviewToken:snapshot.reviewToken,choices:{inspections:snapshot.fields.inspections.options[0].source}})]),error=>error.code==='22023');
});
