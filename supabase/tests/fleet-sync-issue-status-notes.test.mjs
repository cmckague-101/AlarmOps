import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
// Crew resolve/reopen offline: a status change travels with exactly one own
// note, as the member issue trigger requires; never a conflict.
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

const resolve=(text,user=crew,base=crewIssue)=>({status:present('Resolved'),resolvedAt:present('2026-01-01T12:04:00.000Z'),updates:present([note(text,user),...base.updates])});
test('the reporter resolves and reopens their issue with a note each time',async()=>{
  const resolved=await sync(operation(resolve('Fixed hose'),{entity:'issue'}),crew);assert.equal(resolved.kind,'applied');
  assert.equal(resolved.record.status,'Resolved');assert.equal(resolved.record.resolvedAt,'2026-01-01T12:04:00.000Z');assert.equal(resolved.record.updates[0].text,'Fixed hose');
  const reopened=await sync(operation({status:present('Open'),resolvedAt:absent,updates:present([note('Leaking again'),...resolved.record.updates])},{entity:'issue',original:resolved.record,version:resolved.revision}));
  assert.equal(reopened.kind,'applied');assert.equal(reopened.record.status,'Open');assert.equal(reopened.record.resolvedAt,undefined);assert.deepEqual(reopened.record.updates.map(item=>item.text),['Leaking again','Fixed hose']);
});
test('if someone already resolved it, the current resolution is kept and only the note is added',async()=>{
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'issues',event:'update',recordId:issue,expectedVersion:1,data:{...crewIssue,status:'Resolved',resolvedAt:'2026-01-01T09:00:00.000Z',updates:[note('Owner fixed it',owner,'Owner')]}}])]));
  const result=await sync(operation(resolve('Fixed hose'),{entity:'issue'}),crew);assert.equal(result.kind,'applied');
  assert.equal(result.record.resolvedAt,'2026-01-01T09:00:00.000Z');assert.deepEqual(result.record.updates.map(item=>item.text),['Fixed hose','Owner fixed it']);
  assert.equal((await row('select count(*)::int count from public.fleet_sync_conflicts')).count,0);
});
test('status without a note, extra fields, two notes and other people\'s issues are refused',async()=>{
  await assert.rejects(sync(operation({status:present('Resolved'),resolvedAt:present('2026-01-01T12:00:00Z')},{entity:'issue'})),error=>error.code==='42501');
  await assert.rejects(sync(operation({...resolve('x'),title:present('New')},{entity:'issue'})),error=>error.code==='42501');
  await assert.rejects(sync(operation({...resolve('x'),updates:present([note('a'),note('b')])},{entity:'issue'})),error=>error.code==='22023');
  const foreign={...crewIssue,id:ownerIssue,createdById:owner};
  await assert.rejects(sync(operation(resolve('mine now'),{entity:'issue',id:ownerIssue,original:foreign})),error=>error.code==='42501');
  assert.equal((await data('fleet_issues',issue)).status,'Open');assert.equal((await data('fleet_issues',ownerIssue)).status,'Open');assert.equal((await row('select count(*)::int count from public.fleet_sync_submissions')).count,0);
});
test('a manager may send the same combined change',async()=>{
  const result=await sync(operation(resolve('Closed out',owner),{user:owner,entity:'issue'}),owner);assert.equal(result.kind,'applied');assert.equal(result.record.status,'Resolved');
});
