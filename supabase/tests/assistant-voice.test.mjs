import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Voice add-on permissions, shared STT/TTS quotas, and rolling expiry.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const claim=async(companyId,user)=>{await db.exec('set role service_role');try{return (await row('select public.claim_assistant_voice($1,$2,$3) result',[companyId,user,'stt'])).result}finally{await db.exec('reset role')}};
const enable=()=>db.query('update public.companies set assistant_enabled=true,assistant_voice_enabled=true where id=$1',[company]);
before(async()=>{
  await loadGuardedEditSchema(db);
  await db.exec("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$");
  await db.exec(migration('20270116000100_assistant_chat'));
  await db.exec(migration('20270118000100_assistant_voice'));
});
beforeEach(async()=>{
  await db.exec('truncate public.assistant_voice_usage;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other Co','OC-1')",[company,other]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew','c@x'),($3,'Outsider','x@x')",[owner,crew,outsider]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$5)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('the assistant is off until FireOps turns it on, then open to every member',async()=>{
  assert.equal(await claim(company,crew),'disabled');
  await enable();
  assert.equal(await claim(company,crew),'ok');
  assert.equal(await claim(company,owner),'ok');
  assert.equal(await claim(company,outsider),'disabled');
  assert.equal(await claim(other,outsider),'disabled');
  assert.deepEqual((await db.query('select user_id from public.assistant_voice_usage order by id')).rows,[{user_id:crew},{user_id:owner}]);
});

test('members can read the switch but not turn it on, and cannot read or claim usage themselves',async()=>{
  assert.equal((await actor(crew,()=>row('select assistant_voice_enabled value from public.companies where id=$1',[company]))).value,false);
  await assert.rejects(actor(owner,()=>db.query('update public.companies set assistant_enabled=true,assistant_voice_enabled=true where id=$1',[company])));
  await assert.rejects(actor(owner,()=>db.query('select * from public.assistant_voice_usage')));
  await assert.rejects(actor(owner,()=>db.query("select public.claim_assistant_voice($1,$2,'stt')",[company,owner])));
});

test('voice stops at 200 calls per person and recovers after 24 hours',async()=>{
  await enable();
  await db.query("insert into public.assistant_voice_usage(company_id,user_id,kind) select $1,$2,'tts' from generate_series(1,200)",[company,crew]);
  assert.equal(await claim(company,crew),'limit');
  assert.equal(await claim(company,owner),'ok');
  await db.query("update public.assistant_voice_usage set created_at=now()-interval '25 hours' where user_id=$1",[crew]);
  assert.equal(await claim(company,crew),'ok');
});

test('voice stops at 2,000 calls per company',async()=>{
  await enable();
  await db.query("insert into public.assistant_voice_usage(company_id,user_id,kind) select $1,$2,'tts' from generate_series(1,2000)",[company,owner]);
  assert.equal(await claim(company,crew),'limit');
  assert.equal((await row('select count(*)::int n from public.assistant_voice_usage where user_id=$1',[crew])).n,0);
});

test('voice requires chat as well as voice; both kinds share the quota',async()=>{
 await db.query('update public.companies set assistant_voice_enabled=true where id=$1',[company]);
 assert.equal(await claim(company,owner),'disabled');
 await enable();
 await db.query("insert into public.assistant_voice_usage(company_id,user_id,kind) select $1,$2,'tts' from generate_series(1,199)",[company,owner]);
 assert.equal(await claim(company,owner),'ok');
 assert.equal(await claim(company,owner),'limit');
 await assert.rejects(db.query("select public.claim_assistant_voice($1,$2,'invalid')",[company,owner]));
});

test('the person quota follows a member across companies',async()=>{
 await enable();
 await db.query('update public.companies set assistant_enabled=true,assistant_voice_enabled=true where id=$1',[other]);
 await db.query("insert into public.company_members values($1,$2,'owner')",[other,owner]);
 await db.query("insert into public.assistant_voice_usage(company_id,user_id,kind) select $1,$2,'stt' from generate_series(1,200)",[company,owner]);
 assert.equal(await claim(other,owner),'limit');
});
