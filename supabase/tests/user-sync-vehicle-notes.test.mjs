import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadVehicleNoteSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline vehicle note creation: one attributed insert per client UUID under the
// real notes RLS; deleted vehicles create nothing and report why.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const vehicle='30000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function note(user,payload={},id=randomUUID()){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle_note',entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'note.create',payload:{vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%',...payload}}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const inserts=async()=>(await row('select count(*)::int count from public.note_inserts')).count;
before(async()=>{
  await loadVehicleNoteSchema(db);
  // Stands in for the note notification trigger: every insert would notify once.
  await db.exec(`create table public.note_inserts(id uuid);
    create function public.count_note_insert() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.note_inserts values(new.id);return new;end$$;
    create trigger count_note_insert after insert on public.vehicle_notes for each row execute function public.count_note_insert()`);
});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.note_inserts');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',tech,'Tech Person',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1'}}])]));
});
after(async()=>{await db.close()});

test('creates one attributed note per client UUID and replays without another insert',async()=>{
  const op=note(tech,{subject:' Brakes ',body:' Pads at 30% '});const result=await send(op);
  assert.equal(result.kind,'applied');assert.equal(result.notApplied,undefined);
  assert.deepEqual({...result.record,createdAt:undefined},{id:op.entityId,vehicleId:vehicle,subject:'Brakes',body:'Pads at 30%',createdAt:undefined});
  assert.deepEqual(await row('select created_by,created_by_name from public.vehicle_notes where id=$1',[op.entityId]),{created_by:tech,created_by_name:'Tech Person'});
  assert.deepEqual(await send(op),result);assert.equal(await inserts(),1);
});
test('a vehicle deleted before sync creates nothing and reports why',async()=>{
  const op=note(owner,{vehicleId:randomUUID()});const result=await send(op);
  assert.equal(result.notApplied,'vehicle_deleted');assert.equal(result.record,null);assert.equal(await inserts(),0);
});
test('firefighters, outsiders and demoted users cannot create notes',async()=>{
  await assert.rejects(send(note(crew)),error=>error.code==='42501');await assert.rejects(send(note(outsider)),error=>error.code==='42501');
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[tech]);await assert.rejects(send(note(tech)),error=>error.code==='42501');
  assert.equal(await inserts(),0);
});
test('rejects reused identities and invalid payloads',async()=>{
  const op=note(owner);await send(op);
  await assert.rejects(send(note(owner,{body:'Changed'},op.entityId)),error=>error.code==='23505');
  await assert.rejects(send(note(tech,{},op.entityId)),error=>error.code==='23505');
  for(const payload of [{subject:' '},{body:''},{subject:'x'.repeat(161)},{body:'x'.repeat(5001)},{vehicleId:'nope'},{extra:true}])
    await assert.rejects(send(note(owner,payload)),error=>error.code==='22023',JSON.stringify(payload));
  assert.equal(await inserts(),1);
});
