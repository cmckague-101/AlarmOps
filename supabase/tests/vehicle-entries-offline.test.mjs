import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadVehicleEntrySchema} from './fixtures/fleet-sync-harness.mjs';
// Offline removal of one vehicle inspection or document: only if that entry is
// unchanged since the device saw it; entries added by others are kept.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',tech='20000000-0000-4000-8000-000000000003';
const vehicle='30000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const inspection=(id,result='Fail')=>({id,assignmentIncident:'Oak',inspectorId:tech,inspectorName:'Tech',createdAt:'2026-01-01T10:00:00Z',items:[{id:'i1',label:'Tires',kind:'pass_fail',result}]});
const doc=(id,name='Registration')=>({id,name,file:{name:'r.pdf',type:'application/pdf',dataUrl:'',path:`${company}/${owner}/r-${id}`}});
const data=async()=>(await row('select data from public.fleet_vehicles where record_id=$1',[vehicle])).data;
const update=async changes=>{const current=await row('select data,version from public.fleet_vehicles where record_id=$1',[vehicle]);await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:vehicle,expectedVersion:Number(current.version),data:{...current.data,...changes}}])]))};
before(async()=>{await loadVehicleEntrySchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Tech','t@x')",[owner,tech]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',tech,'shop_tech']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1',inspections:[],documents:[]}}])]));
});
after(async()=>{await db.close()});

test('removes an unchanged failed inspection, keeps others added meanwhile, with the online activity',async()=>{
  const failed=randomUUID(),other=randomUUID();await update({inspections:[inspection(failed)]});
  const op=command(owner,'vehicle_inspection',failed,'inspection.delete',{vehicleId:vehicle,base:inspection(failed)});
  await update({inspections:[inspection(other,'Pass'),inspection(failed)]});
  const result=await send(owner,op);assert.equal(result.notApplied,undefined);assert.equal(result.record,null);
  assert.deepEqual((await data()).inspections.map(item=>item.id),[other]);
  assert.equal((await row("select data->>'action' action from public.fleet_activities where data->>'targetId'=$1",[vehicle])).action,'E1 failed inspection deleted');
  assert.equal((await send(owner,command(owner,'vehicle_inspection',failed,'inspection.delete',{vehicleId:vehicle,base:inspection(failed)}))).notApplied,undefined);
});
test('a changed entry is kept and reported; passed inspections and crew are refused',async()=>{
  const failed=randomUUID();await update({inspections:[{...inspection(failed),assignmentIncident:'Edited'}]});
  assert.equal((await send(owner,command(owner,'vehicle_inspection',failed,'inspection.delete',{vehicleId:vehicle,base:inspection(failed)}))).notApplied,'changed_elsewhere');
  assert.equal((await data()).inspections.length,1);
  const passed=randomUUID();await update({inspections:[inspection(passed,'Pass')]});
  await assert.rejects(send(owner,command(owner,'vehicle_inspection',passed,'inspection.delete',{vehicleId:vehicle,base:inspection(passed,'Pass')})),error=>error.code==='22023');
  await assert.rejects(send(tech,command(tech,'vehicle_inspection',passed,'inspection.delete',{vehicleId:vehicle,base:inspection(passed,'Pass')})),error=>error.code==='42501');
});
test('removes an unchanged document only; a replaced file is kept and reported',async()=>{
  const id=randomUUID(),kept=randomUUID();await update({documents:[doc(id),doc(kept,'Insurance')]});
  const state=await send(owner,command(owner,'vehicle_document',id,'document.remove',{vehicleId:vehicle,base:doc(id)}));
  assert.equal(state.record,null);assert.deepEqual((await data()).documents.map(item=>item.id),[kept]);
  const changed={...doc(kept,'Insurance'),file:{...doc(kept).file,path:'new'}};await update({documents:[changed]});
  assert.equal((await send(owner,command(owner,'vehicle_document',kept,'document.remove',{vehicleId:vehicle,base:doc(kept,'Insurance')}))).notApplied,'changed_elsewhere');
  await assert.rejects(send(owner,command(owner,'vehicle_document',kept,'document.remove',{vehicleId:vehicle,base:{...doc(randomUUID())}})),error=>error.code==='22023');
});
