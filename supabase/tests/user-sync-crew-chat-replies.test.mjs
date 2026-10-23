import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCrewChatReplySchema} from './fixtures/fleet-sync-harness.mjs';
// Offline Crew Chat replies: one insert per client UUID under existing RLS and
// attribution; deleted threads create nothing and report why.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function reply(user,threadId,body='On my way',id=randomUUID(),companyId=company){
  return {schemaVersion:1,operationId:randomUUID(),companyId,entityType:'communication_reply',entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'reply.create',payload:{threadId,body}}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const state=(user,id)=>actor(user,async()=>(await row('select public.get_user_sync_state($1,$2,$3) result',[company,'communication_reply',id])).result);
const inserts=async()=>(await row('select count(*)::int count from public.reply_inserts')).count;
async function thread(){
  const id=randomUUID();
  await db.exec('alter table public.communication_threads disable trigger communication_threads_attribution');
  await db.query("insert into public.communication_threads(id,company_id,subject,description,created_by,created_by_name,created_by_role) values($1,$2,'Subject','Body',$3,'Owner','owner')",[id,company,owner]);
  await db.exec('alter table public.communication_threads enable trigger communication_threads_attribution');
  return id;
}
before(async()=>{
  await loadCrewChatReplySchema(db);
  // Stands in for the notification trigger: every insert would notify once.
  await db.exec(`create table public.reply_inserts(id uuid);
    create function public.count_reply_insert() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.reply_inserts values(new.id);return new;end$$;
    create trigger count_reply_insert after insert on public.communication_replies for each row execute function public.count_reply_insert()`);
});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.reply_inserts');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew Member',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$3)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('posts one attributed reply per client UUID and replays without another insert',async()=>{
  const threadId=await thread();const op=reply(crew,threadId,'  On my way  ');
  const result=await send(op);assert.equal(result.kind,'applied');assert.equal(result.notApplied,undefined);
  assert.deepEqual({...result.record,createdAt:undefined},{id:op.entityId,threadId,body:'On my way',createdAt:undefined});
  const stored=await row('select created_by,created_by_name,body from public.communication_replies where id=$1',[op.entityId]);
  assert.deepEqual(stored,{created_by:crew,created_by_name:'Crew Member',body:'On my way'});
  assert.deepEqual(await send(op),result);assert.equal(await inserts(),1);
  assert.equal((await state(crew,op.entityId)).record.body,'On my way');assert.equal((await state(owner,op.entityId)).record,null);
});
test('a thread deleted before sync creates nothing and reports why',async()=>{
  const op=reply(crew,randomUUID());const result=await send(op);
  assert.equal(result.notApplied,'thread_deleted');assert.equal(result.record,null);assert.equal(await inserts(),0);assert.deepEqual(await send(op),result);
});
test('reused reply identities with different content or authors fail without changing the reply',async()=>{
  const threadId=await thread();const op=reply(crew,threadId);await send(op);
  await assert.rejects(send(reply(crew,threadId,'Changed',op.entityId)),error=>error.code==='23505');
  await assert.rejects(send(reply(owner,threadId,'On my way',op.entityId)),error=>error.code==='23505');
  assert.equal((await send(reply(crew,threadId,'On my way',op.entityId))).record.body,'On my way');assert.equal(await inserts(),1);
});
test('validates payloads and current company membership',async()=>{
  const threadId=await thread();
  for(const payload of [{threadId},{threadId,body:'  '},{threadId,body:'x'.repeat(5001)},{threadId:'nope',body:'Hi'},{threadId,body:'Hi',extra:1},{threadId,body:7}]){
    const op=reply(crew,threadId);op.mutation.payload=payload;await assert.rejects(send(op),error=>error.code==='22023',JSON.stringify(payload));
  }
  await assert.rejects(send(reply(outsider,threadId)),error=>error.code==='42501');
  await db.query('delete from public.company_members where user_id=$1',[crew]);await assert.rejects(send(reply(crew,threadId)),error=>error.code==='42501');
  assert.equal(await inserts(),0);
});
