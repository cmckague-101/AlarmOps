import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
// Submitters resolve their own fleet conflicts: withdraw records a verified
// not_selected outcome; nothing is overwritten automatically.
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

const withdraw=(op,user=crew)=>call('select public.withdraw_my_fleet_sync_conflict($1,$2) result',[company,op.operationId],user);
async function conflicted(){
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:1,data:{...baseVehicle,status:'Out of service'}}])]));
  const op=operation({status:present('Assigned'),assignedTo:present(crew)});assert.equal((await sync(op)).kind,'awaiting_review');return op;
}
test('the submitter withdraws their own conflict and reads a not_selected outcome; replays are stable',async()=>{
  const op=await conflicted();const result=await withdraw(op);
  assert.equal(result.outcome,'not_selected');assert.deepEqual(result.keptFields,[]);assert.deepEqual(result.discardedFields.sort(),['assignedTo','status']);
  assert.deepEqual(await call('select public.get_fleet_sync_outcome($1,$2) result',[company,op.operationId],crew),result);
  assert.deepEqual(await withdraw(op),result);
  assert.equal((await row("select state from public.fleet_sync_conflicts where operation_id=$1",[op.operationId])).state,'resolved');
  assert.equal((await data()).status,'Out of service');
  await assert.rejects(call('select public.get_fleet_sync_review($1,$2,$3) result',[company,'vehicle',vehicle],owner),/No pending conflicts/);
});
test('submitting again from the current version applies; others cannot withdraw someone else\'s conflict',async()=>{
  const op=await conflicted();
  await assert.rejects(withdraw(op,tech),error=>error.code==='P0002');await assert.rejects(withdraw(op,outsider),error=>error.code==='42501');
  await withdraw(op);
  const out=await read(owner);await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:Number(out.revision),data:{...out.record,status:'Ready'}}])]));
  const current=await read(crew);
  const again=await sync(operation({status:present('Assigned'),assignedTo:present(crew)},{original:current.record,version:current.revision}));
  assert.equal(again.kind,'applied');assert.equal(again.record.assignedTo,crew);
  await assert.rejects(call('select public.withdraw_my_fleet_sync_conflict($1,$2) result',[company,randomUUID()],crew),error=>error.code==='P0002');
});
