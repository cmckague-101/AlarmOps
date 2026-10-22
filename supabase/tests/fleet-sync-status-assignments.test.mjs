import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',admin='20000000-0000-4000-8000-000000000004',outsider='20000000-0000-4000-8000-000000000005';
const vehicle='30000000-0000-4000-8000-000000000001',issue='30000000-0000-4000-8000-000000000002';
const baseVehicle={id:vehicle,unit:'E1',status:'Ready',notes:'Base'};
const baseIssue={id:issue,vehicleId:vehicle,title:'Leak',status:'Open',updates:[]};
const present=value=>({present:true,value});const absent={present:false};
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const call=(sql,args,user=owner)=>actor(user,async()=>(await row(sql,args)).result);
function operation(patch,{user=owner,entity='vehicle',original=entity==='vehicle'?baseVehicle:baseIssue,version='1',savedAt='2026-01-01T12:05:00.000Z'}={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:entity,entityId:entity==='vehicle'?vehicle:issue,provenance:{userId:user,deviceId:'device-1',savedAt,connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:version,base:original,patch}};
}
const sync=(op,user=owner)=>call('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)],user);
const data=async(table='fleet_vehicles',id=vehicle)=>(await row(`select data,version from public.${table} where record_id=$1`,[id]));
const online=(collection,id,value,version,user=admin)=>actor(user,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection,event:'update',recordId:id,expectedVersion:version,data:value}])]));
const activities=async()=>(await db.query("select data from public.fleet_activities order by data->>'createdAt'")).rows.map(item=>item.data);
const note=(text,changes={})=>({id:randomUUID(),text,createdBy:'Owner',createdById:owner,createdAt:'2026-01-01T12:04:00.000Z',...changes});
before(async()=>{await loadFleetSyncAttachmentSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',admin,'Admin',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',admin,'admin']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:baseVehicle},{collection:'issues',event:'insert',recordId:issue,data:baseIssue}])]));
});
after(async()=>{await db.close()});

test('applies status and assignment changes with one audited activity per change',async()=>{
  const op=operation({status:present('Assigned'),assignedTo:present(crew),assignedFire:present({id:'fire-1',name:'Ridge Fire',state:'CA'})});
  const result=await sync(op);assert.equal(result.kind,'applied');assert.deepEqual((await data()).data,{...baseVehicle,status:'Assigned',assignedTo:crew,assignedFire:{id:'fire-1',name:'Ridge Fire',state:'CA'}});
  const [activity]=await activities();assert.equal(activity.action,'E1 status changed to Assigned');assert.equal(activity.createdById,owner);assert.equal(activity.targetId,vehicle);assert.match(activity.detail,/saved offline at 2026-01-01T12:05:00.000Z \(device-reported\)/);
  assert.deepEqual(await sync(op),result);assert.equal((await activities()).length,1);
  const release=operation({status:present('Out of service'),assignedTo:absent,assignedFire:absent},{original:result.record,version:result.revision});
  assert.equal((await sync(release)).record.status,'Out of service');assert.equal((await activities()).length,2);assert.equal((await activities())[1].tone,'urgent');
});
test('rejects inconsistent or non-member assignments before changing data',async()=>{
  for(const patch of [{status:present('Assigned')},{assignedTo:present(crew)},{assignedFire:present({id:'f',name:'n',state:'s'})},{status:present('Assigned'),assignedTo:present(outsider)},{status:present('Parked')},{status:absent},{assignedTo:present('not-a-uuid')},{assignedFire:present({id:'f',name:'n'})}])
    await assert.rejects(sync(operation(patch)),error=>error.code==='22023',JSON.stringify(patch));
  assert.deepEqual((await data()).data,baseVehicle);assert.equal((await activities()).length,0);
  await assert.rejects(sync(operation({status:present('Out of service')},{user:crew}),crew),error=>error.code==='42501');
});
test('status and assignment conflict as one group while unrelated fields still merge',async()=>{
  await online('vehicles',vehicle,{...baseVehicle,status:'Assigned',assignedTo:admin},1);
  const pending=await sync(operation({status:present('Out of service')}));assert.equal(pending.kind,'awaiting_review');
  assert.deepEqual((await data()).data,{...baseVehicle,status:'Assigned',assignedTo:admin});assert.equal((await activities()).length,0);
  assert.equal((await sync(operation({notes:present('Independent')}))).record.notes,'Independent');
});
test('review approval cannot assemble an inconsistent status/assignment',async()=>{
  const assigned={...baseVehicle,status:'Assigned',assignedTo:crew};await online('vehicles',vehicle,assigned,1,owner);
  await online('vehicles',vehicle,{...assigned,assignedTo:admin},2);
  const pending=await sync(operation({status:present('Out of service'),assignedTo:absent},{original:assigned,version:'2'}));assert.equal(pending.kind,'awaiting_review');
  const snapshot=await call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle]);
  assert.deepEqual(Object.keys(snapshot.fields).sort(),['assignedTo','status']);const candidate=snapshot.fields.status.options[0].source;
  const request=choices=>({requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,reviewToken:snapshot.reviewToken,choices});
  await assert.rejects(call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify(request({status:candidate,assignedTo:'current'}))]),/inconsistent/);
  await call('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify(request({status:candidate,assignedTo:candidate}))]);
  assert.deepEqual((await data()).data,{...baseVehicle,status:'Out of service'});
});
test('issue resolution keeps status and resolution time consistent',async()=>{
  const resolved=await sync(operation({status:present('Resolved'),resolvedAt:present('2026-01-01T12:05:00.000Z')},{entity:'issue'}));assert.equal(resolved.record.status,'Resolved');
  for(const patch of [{status:present('Open')},{resolvedAt:absent},{status:present('Closed'),resolvedAt:absent},{resolvedAt:present('yesterday')}])
    await assert.rejects(sync(operation(patch,{entity:'issue',original:resolved.record,version:resolved.revision})),error=>error.code==='22023',JSON.stringify(patch));
  assert.equal((await sync(operation({status:present('Open'),resolvedAt:absent},{entity:'issue',original:resolved.record,version:resolved.revision}))).record.status,'Open');
});
test('issue updates append without conflicts, keep concurrent notes and replay once',async()=>{
  const theirs=note('Online note',{createdBy:'Admin',createdById:admin});await online('issues',issue,{...baseIssue,updates:[theirs]},1);
  const mine=note('Offline note');const op=operation({updates:present([mine])},{entity:'issue'});
  const result=await sync(op);assert.equal(result.kind,'applied');assert.deepEqual((await data('fleet_issues',issue)).data.updates,[mine,theirs]);
  assert.deepEqual(await sync(op),result);const second=note('Later');
  const next=await sync(operation({updates:present([second,mine,theirs])},{entity:'issue',original:result.record,version:result.revision}));
  assert.deepEqual(next.record.updates,[second,mine,theirs]);
});
test('issue updates cannot edit, remove, impersonate or mix with other changes',async()=>{
  const existing=note('Existing');await online('issues',issue,{...baseIssue,updates:[existing]},1,owner);const original={...baseIssue,updates:[existing]};
  for(const patch of [{updates:present([])},{updates:present([{...existing,text:'Edited'}])},{updates:present([note('x',{createdById:admin}),existing])},{updates:present([note(' '),existing])},{updates:present([{...note('x'),extra:1},existing])},{updates:present([note('x'),existing]),status:present('Resolved')},{updates:absent}])
    await assert.rejects(sync(operation(patch,{entity:'issue',original,version:'2'})),error=>error.code==='22023',JSON.stringify(patch));
  assert.deepEqual((await data('fleet_issues',issue)).data.updates,[existing]);
});
