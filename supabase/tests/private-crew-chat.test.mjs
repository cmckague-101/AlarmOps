import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadPrivateCrewChatSchema} from './fixtures/fleet-sync-harness.mjs';
// Private Crew Chat: only owners/admins read, reply to and download a private
// thread; crew see only public threads, online and offline.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',crew='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const thread=(user,id,payload)=>command(user,'communication_thread',id,'thread.create',{subject:'Staffing',description:'Pay rates',...payload});
const threadIds=user=>actor(user,async()=>(await db.query('select id from public.communication_threads order by subject')).rows.map(item=>item.id));
const reply=(user,threadId)=>actor(user,()=>db.query('insert into public.communication_replies(company_id,thread_id,body) values($1,$2,$3)',[company,threadId,'Noted']));
const snapshot=user=>actor(user,async()=>(await row('select public.get_company_sync_snapshot($1,$2) result',[company,'crew_chat'])).result);
before(async()=>{await loadPrivateCrewChatSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Crew','c@x')",[owner,admin,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',admin,'admin',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('private threads are visible, repliable and downloadable only by owners/admins',async()=>{
  const privateId=randomUUID(),publicId=randomUUID();
  assert.equal((await send(owner,thread(owner,privateId,{isPrivate:true}))).notApplied,undefined);
  await send(owner,thread(owner,publicId,{subject:'Weather'}));
  assert.deepEqual(await row('select is_private from public.communication_threads where id=$1',[privateId]),{is_private:true});
  assert.deepEqual(await threadIds(admin),[privateId,publicId]);
  assert.deepEqual(await threadIds(crew),[publicId]);
  await reply(admin,privateId);await reply(crew,publicId);
  await assert.rejects(reply(crew,privateId),error=>error.code==='42501');
  assert.equal((await actor(crew,()=>row('select count(*)::int count from public.communication_replies'))).count,1);
  assert.deepEqual((await snapshot(crew)).tables.communication_threads.map(item=>item.id),[publicId]);
  assert.equal((await snapshot(admin)).tables.communication_threads.length,2);
  assert.equal((await snapshot(crew)).tables.communication_replies.length,1);
  assert.equal((await send(crew,command(crew,'communication_reply',randomUUID(),'reply.create',{threadId:privateId,body:'Hi'}))).notApplied,'thread_deleted');
});
test('isPrivate must be a boolean',async()=>{
  await assert.rejects(send(owner,thread(owner,randomUUID(),{isPrivate:'yes'})),error=>error.code==='22023');
  await assert.rejects(send(owner,thread(owner,randomUUID(),{isPrivate:true,extra:1})),error=>error.code==='22023');
});
