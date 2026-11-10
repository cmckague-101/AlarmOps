import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// FireOps Assistant chat (20270116000100): a paid per-company switch that only
// FireOps staff can turn on, open to every member of an enabled company, and
// capped at 100 messages per person and 1,000 per company in any rolling 24 hours.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const claim=async(companyId,user)=>{await db.exec('set role service_role');try{return (await row('select public.claim_assistant_chat($1,$2) result',[companyId,user])).result}finally{await db.exec('reset role')}};
const enable=()=>db.query('update public.companies set assistant_enabled=true where id=$1',[company]);
before(async()=>{
  await loadGuardedEditSchema(db);
  await db.exec("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$");
  await db.exec(migration('20270116000100_assistant_chat'));
});
beforeEach(async()=>{
  await db.exec('truncate public.assistant_chat_usage;truncate public.companies cascade;truncate public.profiles cascade');
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
  assert.equal(await claim(company,outsider),'not_member');
  assert.equal(await claim(other,outsider),'disabled');
  assert.deepEqual((await db.query('select user_id from public.assistant_chat_usage order by id')).rows,[{user_id:crew},{user_id:owner}]);
});

test('members can read the switch but not turn it on, and cannot read or claim usage themselves',async()=>{
  assert.equal((await actor(crew,()=>row('select assistant_enabled value from public.companies where id=$1',[company]))).value,false);
  await assert.rejects(actor(owner,()=>db.query('update public.companies set assistant_enabled=true where id=$1',[company])));
  await assert.rejects(actor(owner,()=>db.query('select * from public.assistant_chat_usage')));
  await assert.rejects(actor(owner,()=>db.query('select public.claim_assistant_chat($1,$2)',[company,owner])));
});

test('chat stops at 100 messages per person and recovers after 24 hours',async()=>{
  await enable();
  await db.query('insert into public.assistant_chat_usage(company_id,user_id) select $1,$2 from generate_series(1,100)',[company,crew]);
  assert.equal(await claim(company,crew),'limit');
  assert.equal(await claim(company,owner),'ok');
  await db.query("update public.assistant_chat_usage set created_at=now()-interval '25 hours' where user_id=$1",[crew]);
  assert.equal(await claim(company,crew),'ok');
});

test('chat stops at 1,000 messages per company',async()=>{
  await enable();
  await db.query('insert into public.assistant_chat_usage(company_id,user_id) select $1,$2 from generate_series(1,1000)',[company,owner]);
  assert.equal(await claim(company,crew),'limit');
  assert.equal((await row('select count(*)::int n from public.assistant_chat_usage where user_id=$1',[crew])).n,0);
});
