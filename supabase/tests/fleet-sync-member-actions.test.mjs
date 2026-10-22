import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const vehicle='30000000-0000-4000-8000-000000000001',issue='30000000-0000-4000-8000-000000000002',ownerIssue='30000000-0000-4000-8000-000000000003';
const baseVehicle={id:vehicle,unit:'E1',status:'Ready',notes:'Base'};
const crewIssue={id:issue,vehicleId:vehicle,title:'Leak',status:'Open',updates:[],createdById:crew,createdBy:'Crew'};
const present=value=>({present:true,value});const absent={present:false};
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user)=>actor(user,async()=>(await row(sql,args)).result);
function operation(patch,{user=crew,entity='vehicle',id=entity==='vehicle'?vehicle:issue,original=entity==='vehicle'?baseVehicle:crewIssue,version='1'}={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:entity,entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:version,base:original,patch}};
}
const sync=(op,user=crew)=>call('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)],user);
const read=(user,entity='vehicle',id=vehicle)=>call('select public.get_fleet_sync_record($1,$2,$3) result',[company,entity,id],user);
const data=async(table='fleet_vehicles',id=vehicle)=>(await row(`select data from public.${table} where record_id=$1`,[id])).data;
const note=(text,user=crew,name='Crew')=>({id:randomUUID(),text,createdBy:name,createdById:user,createdAt:'2026-01-01T12:04:00.000Z'});
before(async()=>{await loadFleetSyncAttachmentSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:baseVehicle},{collection:'issues',event:'insert',recordId:issue,data:crewIssue},{collection:'issues',event:'insert',recordId:ownerIssue,data:{...crewIssue,id:ownerIssue,createdById:owner}}])]));
});
after(async()=>{await db.close()});

test('crew can read verified records and inventory pages but not review or history',async()=>{
  assert.deepEqual((await read(crew)).record,baseVehicle);assert.equal((await read(crew,'issue',issue)).revision,'1');
  await assert.rejects(read(tech,'issue',issue),error=>error.code==='42501');await assert.rejects(read(crew,'issue',ownerIssue),error=>error.code==='42501');
  const page=await call('select public.download_fleet_sync_page($1,null,null) result',[company],crew);assert.equal(page.total,1);assert.equal(page.issues,0);assert.deepEqual(page.records.map(item=>item.entityType),['vehicle']);
  assert.equal((await call('select public.download_fleet_sync_page($1,null,null) result',[company],owner)).total,3);
  await assert.rejects(read(outsider),error=>error.code==='42501');
  await assert.rejects(call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle],crew),error=>error.code==='42501');
});
test('a firefighter claims a ready vehicle, clears its fire and releases it, with audited activities',async()=>{
  const claimed=await sync(operation({status:present('Assigned'),assignedTo:present(crew)}));assert.equal(claimed.kind,'applied');
  await actor(crew,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:2,data:{...claimed.record,assignedFire:{id:'f',name:'Ridge',state:'CA'}}}])]));
  const withFire=await read(crew);const cleared=await sync(operation({assignedFire:absent},{original:withFire.record,version:withFire.revision}));assert.equal(cleared.kind,'applied');assert.equal(cleared.record.assignedFire,undefined);
  const released=await sync(operation({status:present('Ready'),assignedTo:absent},{original:cleared.record,version:cleared.revision}));assert.deepEqual(released.record,baseVehicle);
  const activities=(await db.query('select data from public.fleet_activities')).rows.map(item=>item.data);assert.ok(activities.length>=2);assert.ok(activities.every(item=>item.createdById===crew));
});
test('role triggers still refuse transitions crew cannot make online, without partial writes',async()=>{
  for(const patch of [{status:present('Assigned'),assignedTo:present(tech)},{status:present('Out of service')}])
    await assert.rejects(sync(operation(patch)),error=>error.code==='42501',JSON.stringify(patch));
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:1,data:{...baseVehicle,status:'Assigned',assignedTo:tech}}])]));
  const current=await read(crew);await assert.rejects(sync(operation({status:present('Ready'),assignedTo:absent},{original:current.record,version:current.revision})),error=>error.code==='42501');
  assert.deepEqual(await data(),{...baseVehicle,status:'Assigned',assignedTo:tech});assert.equal((await row('select count(*)::int count from public.fleet_sync_submissions')).count,0);
});
test('crew field allowlist rejects detail, file and issue status changes',async()=>{
  for(const [patch,entity] of [[{notes:present('x')},'vehicle'],[{status:present('Resolved'),resolvedAt:present('2026-01-01T12:00:00Z')},'issue'],[{title:present('x')},'issue']])
    await assert.rejects(sync(operation(patch,{entity})),error=>error.code==='42501');
  await assert.rejects(sync(operation({status:present('Assigned'),assignedTo:present(outsider)},{user:outsider}),outsider),error=>error.code==='42501');
});
test('crew append one note to issues they reported; concurrent notes survive; others are refused',async()=>{
  const theirs=note('Owner note',owner,'Owner');await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'issues',event:'update',recordId:issue,expectedVersion:1,data:{...crewIssue,updates:[theirs]}}])]));
  const mine=note('Hose replaced');const result=await sync(operation({updates:present([mine])},{entity:'issue'}));assert.equal(result.kind,'applied');assert.deepEqual((await data('fleet_issues',issue)).updates,[mine,theirs]);
  await assert.rejects(sync(operation({updates:present([note('a'),note('b'),...result.record.updates])},{entity:'issue',original:result.record,version:result.revision})),error=>error.code==='42501');
  await assert.rejects(sync(operation({updates:present([note('x')])},{entity:'issue',id:ownerIssue,original:{...crewIssue,id:ownerIssue,createdById:owner}})),error=>error.code==='42501');
});
test('crew conflicts are retained for owner/admin review and the submitter can read the outcome',async()=>{
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:1,data:{...baseVehicle,status:'Out of service'}}])]));
  const op=operation({status:present('Assigned'),assignedTo:present(crew)});const pending=await sync(op);assert.equal(pending.kind,'awaiting_review');
  const snapshot=await call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle],owner);assert.equal(snapshot.candidates.length,1);
  await call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify({requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,reviewToken:snapshot.reviewToken,choices:{status:'current',assignedTo:'current'}})],owner);
  const outcome=await call('select public.get_fleet_sync_outcome($1,$2) result',[company,op.operationId],crew);assert.equal(outcome.outcome,'not_selected');
});
