import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCrewChatReplySchema,migration} from './fixtures/fleet-sync-harness.mjs';

// Join replies stay in the thread but must not create inbox/push notifications.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
async function thread(){
  const id=randomUUID();
  await db.exec('alter table public.communication_threads disable trigger communication_threads_attribution');
  await db.query("insert into public.communication_threads(id,company_id,subject,description,created_by,created_by_name,created_by_role,is_private) values($1,$2,'Ops update','Please reply',$3,'Owner','owner',false)",[id,company,owner]);
  await db.exec('alter table public.communication_threads enable trigger communication_threads_attribution');
  return id;
}
const inbox=async user=>(await db.query('select event_type,body from public.user_notifications where user_id=$1 order by created_at',[user])).rows;

before(async()=>{
  await loadCrewChatReplySchema(db);
  await db.exec(`alter table public.communication_threads add column if not exists is_private boolean not null default false`);
  await db.exec(`
    create or replace function public.notification_actor_name(actor uuid) returns text language sql stable set search_path='' as $$
      select full_name from public.profiles where user_id = actor
    $$;
    create or replace function public.create_user_notification(
      company uuid, recipient uuid, actor uuid, event_type text, entity_type text, entity_id uuid,
      title text, body text, path text, group_key text, dedupe_key text
    ) returns void language plpgsql security definer set search_path='' as $$
    begin
      insert into public.user_notifications(company_id,user_id,actor_user_id,event_type,entity_type,entity_id,title,body,path,group_key,dedupe_key)
      values(company,recipient,actor,event_type,entity_type,entity_id,title,body,path,group_key,dedupe_key);
    end$$;
    create or replace function public.notify_communication_reply() returns trigger language plpgsql security definer set search_path='' as $$begin return new; end$$;
    drop trigger if exists communication_reply_notification on public.communication_replies;
    create trigger communication_reply_notification after insert on public.communication_replies
    for each row execute function public.notify_communication_reply();
  `);
  await db.exec(migration('20270105000100_skip_crew_chat_join_notifications'));
});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.user_notifications');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query("insert into public.profiles(user_id,full_name) values($1,'Owner'),($2,'Crew Member')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('normal replies still notify participants; join replies do not',async()=>{
  const threadId=await thread();
  await db.exec('alter table public.communication_replies disable trigger communication_replies_attribution');
  await db.query('insert into public.communication_replies(company_id,thread_id,body,created_by,created_by_name) values($1,$2,$3,$4,$5)',[company,threadId,'On scene',crew,'Crew Member']);
  await db.query('insert into public.communication_replies(company_id,thread_id,body,created_by,created_by_name) values($1,$2,$3,$4,$5)',[company,threadId,'Joined the conversation.',crew,'Crew Member']);
  await db.exec('alter table public.communication_replies enable trigger communication_replies_attribution');
  assert.deepEqual(await inbox(owner),[{event_type:'communication_reply',body:'Crew Member replied: On scene'}]);
  assert.deepEqual(await inbox(crew),[]);
  assert.equal((await row('select count(*)::int count from public.communication_replies where thread_id=$1',[threadId])).count,2);
});

test('clears existing join notifications left in the inbox',async()=>{
  const threadId=await thread();
  await db.query("insert into public.user_notifications(company_id,user_id,event_type,entity_type,entity_id,title,body,path,group_key,dedupe_key) values($1,$2,'communication_reply','communication',$3::uuid,'Reply: Ops','Crew Member replied: Joined the conversation.','/communication/'||$3::text,'communication:'||$3::text,'communication-reply:'||gen_random_uuid())",[company,owner,threadId]);
  await db.query("insert into public.user_notifications(company_id,user_id,event_type,entity_type,entity_id,title,body,path,group_key,dedupe_key) values($1,$2,'communication_reply','communication',$3::uuid,'Reply: Ops','Crew Member replied: On scene','/communication/'||$3::text,'communication:'||$3::text,'communication-reply:'||gen_random_uuid())",[company,owner,threadId]);
  await db.exec(migration('20270105000100_skip_crew_chat_join_notifications'));
  assert.deepEqual(await inbox(owner),[{event_type:'communication_reply',body:'Crew Member replied: On scene'}]);
});
