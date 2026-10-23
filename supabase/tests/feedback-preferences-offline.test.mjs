import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFeedbackSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline feedback (one insert per device ID, attributed by the real trigger) and
// own notification preferences (per-key merge, created with defaults).
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,entityType,entityId,cmd,payload){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const feedback=(user,id,payload={category:'issue',message:' Map is slow ',source:'ios'})=>command(user,'feedback',id,'feedback.send',payload);
const prefs=(user,changes,id=user)=>command(user,'notification_preferences',id,'preferences.set',{changes});
before(async()=>{await loadFeedbackSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.test_notifications');
  await db.query("insert into public.companies(id,name,company_code,owner_user_id) values($1,'Crew Co','CC-1',$3),($2,'Other','OT-1',null)",[company,other,owner]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x.test'),($2,'Crew Person','c@x.test'),($3,'Outsider','x@x.test')",[owner,crew,outsider]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$3)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('feedback is sent once per device ID, attributed by the real trigger',async()=>{
  const id=randomUUID();const op=feedback(crew,id);const result=await send(op);
  assert.equal(result.notApplied,undefined);assert.equal(result.record.id,id);assert.deepEqual(await send(op),result);
  assert.deepEqual(await row('select message,submitter_name,submitter_email,source_company_code from public.app_feedback where id=$1',[id]),{message:'Map is slow',submitter_name:'Crew Person',submitter_email:'c@x.test',source_company_code:'CC-1'});
  await assert.rejects(send(feedback(crew,id)),error=>error.code==='23505');
  // Ordinary clients still cannot read their own feedback back.
  assert.equal((await actor(crew,()=>db.query('select id from public.app_feedback'))).rows.length,0);
});
test('invalid feedback and outsiders are refused',async()=>{
  for(const payload of [{category:'bug',message:'x',source:'ios'},{category:'idea',message:' ',source:'ios'},{category:'idea',message:'x',source:'web'},{category:'idea',message:'x',source:'ios',extra:1}])
    await assert.rejects(send(feedback(crew,randomUUID(),payload)),error=>error.code==='22023',JSON.stringify(payload));
  await assert.rejects(send({...feedback(outsider,randomUUID()),companyId:company}),error=>error.code==='42501');
});
test('preferences merge per key over defaults and stay the caller\'s own',async()=>{
  const first=await send(prefs(crew,{pushEnabled:false}));
  assert.deepEqual(first.record,{pushEnabled:false,communicationReplies:true,documentAdded:true,trainingCreated:true,issueUpdates:true});
  const second=await send(prefs(crew,{trainingCreated:false}));assert.equal(second.record.pushEnabled,false);assert.equal(second.record.trainingCreated,false);
  await assert.rejects(send(prefs(crew,{pushEnabled:true},owner)),error=>error.code==='42501');
  for(const changes of [{},{vehicleAssigned:false},{pushEnabled:'no'}])await assert.rejects(send(prefs(crew,changes)),error=>error.code==='22023');
  assert.equal((await row('select count(*)::int count from public.notification_preferences')).count,1);
});
