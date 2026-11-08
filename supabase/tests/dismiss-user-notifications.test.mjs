import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCompanySnapshotSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Clearing notifications (20270104000200) hides them account-wide: on every
// device, in the offline download, and from unread/badge counts. Users can only
// clear their own notifications.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const dismiss=(user,ids=null,types=null,target=company)=>actor(user,async()=>(await row('select public.dismiss_user_notifications($1,$2::uuid[],$3::text[]) cleared',[target,ids,types])).cleared);
const notify=async(user,title,eventType='system',read=false,target=company)=>(await row(
  "insert into public.user_notifications(company_id,user_id,event_type,entity_type,title,body,path,group_key,dedupe_key,read_at) values($1,$2,$3,'system',$4,'B','/x','g',gen_random_uuid()::text,case when $5 then now() end) returning id",
  [target,user,eventType,title,read])).id;
const state=async()=>(await db.query('select title,read_at is not null read,dismissed_at is not null dismissed from public.user_notifications order by title')).rows;
before(async()=>{
  await loadCompanySnapshotSchema(db);
  await db.exec(migration('20270104000200_dismiss_user_notifications'));
});
beforeEach(async()=>{
  await db.exec('truncate public.user_notifications cascade;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other','OT-1')",[company,other]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$4,$5)',[company,owner,'owner',crew,'fire_fighter',other]);
});
after(async()=>{await db.close()});

test('clearing one notification hides it and marks it read',async()=>{
  const a=await notify(crew,'A');await notify(crew,'B');
  assert.equal(await dismiss(crew,[a]),1);
  assert.deepEqual(await state(),[{title:'A',read:true,dismissed:true},{title:'B',read:false,dismissed:false}]);
  assert.equal(await dismiss(crew,[a]),0,'clearing twice changes nothing');
});
test('clear all respects the event types a screen shows and leaves other companies alone',async()=>{
  await notify(crew,'A','communication_reply');await notify(crew,'B','system');await notify(crew,'C','system',false,other);
  assert.equal(await dismiss(crew,null,['communication_reply']),1);
  assert.equal(await dismiss(crew),1);
  assert.deepEqual(await state(),[{title:'A',read:true,dismissed:true},{title:'B',read:true,dismissed:true},{title:'C',read:false,dismissed:false}]);
});
test('users cannot clear someone else\'s notifications',async()=>{
  const a=await notify(owner,'A');
  assert.equal(await dismiss(crew,[a]),0);
  assert.equal(await dismiss(crew),0);
  assert.deepEqual(await state(),[{title:'A',read:false,dismissed:false}]);
  await assert.rejects(actor(crew,()=>db.query('update public.user_notifications set title=$1',['X'])),error=>error.code==='42501');
});
test('the offline inbox download leaves out cleared notifications',async()=>{
  const a=await notify(crew,'A');await notify(crew,'B');
  await dismiss(crew,[a]);
  const inbox=await actor(crew,async()=>(await row("select public.get_company_sync_snapshot($1,'notifications') result",[company])).result);
  assert.deepEqual(inbox.tables.user_notifications.map(item=>item.title),['B']);
});
test('signed-out callers are refused',async()=>{
  await assert.rejects(actor('',()=>db.query('select public.dismiss_user_notifications($1)',[company])),error=>error.code==='42501'||error.code==='22P02');
});
