import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadTrainingSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline training sign-ups: capacity never exceeded; full or deleted classes
// change nothing and say why; cancel removes only the caller's own sign-up.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function signup(user,trainingId,cmd='signup.join',payload={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'training_signup',entityId:trainingId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const seats=async id=>(await row('select count(*)::int count from public.company_training_signups where training_id=$1',[id])).count;
async function training(capacity=1){const id=randomUUID();await actor(owner,()=>db.query("insert into public.company_trainings(id,company_id,course_code,course_title,starts_at,location,instructor,capacity,created_by) values($1,$2,'S-130','Firefighter Training',now()+interval '7 days','Station 1','Lee',$3,$4)",[id,company,capacity,owner]));return id}
before(async()=>{await loadTrainingSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew Person',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('signs up once with the attributed name and replays without another seat',async()=>{
  const id=await training(2);const op=signup(crew,id);const result=await send(op);
  assert.equal(result.notApplied,undefined);assert.deepEqual(result.record,{id,signedUp:true});assert.deepEqual(await send(op),result);
  assert.equal((await send(signup(crew,id))).notApplied,undefined);assert.equal(await seats(id),1);
  assert.equal((await row('select user_name from public.company_training_signups where user_id=$1',[crew])).user_name,'Crew Person');
});
test('a class that filled before sync rejects the sign-up and changes nothing',async()=>{
  const id=await training(1);await send(signup(tech,id));const late=await send(signup(crew,id));
  assert.equal(late.notApplied,'course_full');assert.deepEqual(late.record,{id,signedUp:false});assert.equal(await seats(id),1);
  await send(signup(tech,id,'signup.cancel'));assert.equal(await seats(id),0);assert.equal((await send(signup(crew,id))).notApplied,undefined);
});
test('deleted trainings report why; cancel touches only the caller; invalid or foreign requests fail',async()=>{
  const gone=await send(signup(crew,randomUUID()));assert.equal(gone.notApplied,'training_deleted');assert.equal(gone.record,null);
  const id=await training(3);await send(signup(crew,id));await send(signup(tech,id));
  assert.deepEqual((await send(signup(crew,id,'signup.cancel'))).record,{id,signedUp:false});assert.equal(await seats(id),1);
  await assert.rejects(send(signup(crew,id,'signup.join',{seat:1})),error=>error.code==='22023');
  await assert.rejects(send(signup(outsider,id)),error=>error.code==='42501');assert.equal(await seats(id),1);
});
