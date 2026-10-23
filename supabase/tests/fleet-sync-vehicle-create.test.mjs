import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
// Offline vehicle creation: owners/admins only, created once by device ID with
// the online activity entry; never overwrites or resurrects an identity.
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

const newVehicle=(id=randomUUID(),changes={})=>({id,unit:'E7',type:'Engine',year:2020,make:'Pierce',model:'Enforcer',vin:'',plate:'',notes:'',status:'Ready',createdAt:'2026-01-01T12:00:00.000Z',...changes});
function create(record,user=owner){return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:record.id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'create',record}}}
const send=(op,user=op.provenance.userId)=>call('select public.sync_fleet_create($1::jsonb) result',[JSON.stringify(op)],user);
test('an owner adds a vehicle once, with the online activity and a replayable receipt',async()=>{
  const record=newVehicle();const op=create(record);const result=await send(op);
  assert.equal(result.kind,'applied');assert.deepEqual(result.record,record);assert.deepEqual(await data('fleet_vehicles',record.id),record);
  assert.deepEqual(await send(op),result);
  const activity=(await db.query("select data from public.fleet_activities where data->>'targetId'=$1",[record.id])).rows.map(item=>item.data);
  assert.equal(activity.length,1);assert.equal(activity[0].action,'E7 added to fleet');assert.equal(activity[0].createdById,owner);assert.match(activity[0].detail,/device-reported/);
  assert.deepEqual((await read(owner,'vehicle',record.id)).record,record);
});
test('identities are never reused, and deleted vehicles are not recreated',async()=>{
  const record=newVehicle();await send(create(record));
  await assert.rejects(send(create({...record,unit:'Other'})),error=>error.code==='23505');
  await assert.rejects(send(create(newVehicle(vehicle))),error=>error.code==='23505');
  await assert.rejects(send(create(newVehicle(issue))),error=>error.code==='23505');
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:record.id,expectedVersion:1}])]));
  await assert.rejects(send(create(record)),error=>error.code==='23505');
});
test('crew cannot add vehicles; invalid or assigned vehicles are refused',async()=>{
  await assert.rejects(send(create(newVehicle(),crew)),error=>error.code==='42501');
  await assert.rejects(send(create(newVehicle(),tech)),error=>error.code==='42501');
  await assert.rejects(send(create(newVehicle(),outsider)),error=>error.code==='42501');
  for(const changes of [{status:'Assigned'},{unit:' '},{year:20},{year:'2020'},{assignedTo:crew},{photo:{name:'a'}},{documents:[]}])
    await assert.rejects(send(create(newVehicle(randomUUID(),changes))),error=>error.code==='22023',JSON.stringify(changes));
  assert.equal((await row("select count(*)::int count from public.fleet_vehicles")).count,1);
});
test('issue reports still work through the same endpoint',async()=>{
  const id=randomUUID();const record={id,vehicleId:vehicle,title:'Flat',description:'Rear tire',priority:'High',status:'Open',updates:[],createdBy:'Tech',createdById:tech,createdAt:'2026-01-01T12:00:00.000Z'};
  const op={...create(record,tech),entityType:'issue'};assert.equal((await send(op)).kind,'applied');
});
