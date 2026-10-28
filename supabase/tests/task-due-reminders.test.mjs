import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {migration} from './fixtures/fleet-sync-harness.mjs';

const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',tech='20000000-0000-4000-8000-000000000002',crew='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,action,role='authenticated'){
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.exec(`set local role ${role}`);
    const result=await action();await db.exec('commit');return result;
  } catch(error){await db.exec('rollback');throw error;}
}
const zone=(user=owner,name='America/Los_Angeles',target=company)=>actor(user,()=>db.query('select public.set_task_reminder_timezone($1,$2,$3)',[target,user,name]));
const enqueue=async(time)=>(await actor(owner,()=>row('select public.enqueue_due_task_reminders($1) count',[time]),'service_role')).count;
const claim=()=>actor(owner,()=>db.query('select * from public.claim_push_notification_jobs()'),'service_role');
async function task(user=owner,date='2027-01-05'){
  const id=randomUUID();
  await db.query("insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,'Order filters',$4)",[id,company,user,date]);return id;
}
before(async()=>{
  await db.exec(readFileSync(new URL('./fixtures/fleet-sync.sql',import.meta.url),'utf8'));
  await db.exec('grant select on public.company_members to authenticated');
  await db.exec(migration('20261107000100_personal_tasks'));
  await db.exec(migration('20261228000100_personal_task_editing'));
  const inbox=migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(inbox.slice(inbox.indexOf('create table public.notification_preferences'),inbox.indexOf('create table public.push_notification_deliveries')));
  await db.exec('alter table public.notification_preferences enable row level security;alter table public.user_notifications enable row level security');
  await db.exec(inbox.slice(inbox.indexOf('create policy "users read own notification preferences"'),inbox.indexOf('revoke all on public.notification_preferences')));
  await db.exec('grant select, insert, update on public.notification_preferences to authenticated;grant select on public.user_notifications to authenticated');
  await db.exec(migration('20261226000100_payroll_rejected_notifications'));
  await db.exec(migration('20261229000100_task_due_reminders'));
});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,otherCompany]);
  await db.query("insert into public.profiles values($1,'Owner'),($2,'Tech'),($3,'Crew')",[owner,tech,crew]);
  await db.query("insert into public.company_members values($1,$2,'owner'),($1,$3,'shop_tech'),($1,$4,'fire_fighter')",[company,owner,tech,crew]);
});
after(async()=>{await db.close()});

test('queues once at 9 AM local time, private inbox and push point to tasks',async()=>{
  await zone();const id=await task();
  assert.equal(await enqueue('2027-01-05T16:59:59Z'),0);
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),1);
  assert.equal(await enqueue('2027-01-05T17:01:00Z'),0);
  const notice=await row('select * from public.user_notifications');
  assert.equal(notice.user_id,owner);assert.equal(notice.company_id,company);assert.equal(notice.entity_id,id);
  assert.equal(notice.event_type,'task_due');assert.equal(notice.path,'/tasks');assert.equal(notice.title,'Task due today: Order filters');
  assert.equal((await claim()).rows.length,1);
  assert.equal((await actor(tech,()=>db.query('select * from public.user_notifications'))).rows.length,0);
});

test('uses daylight-saving rules and supports date boundaries east/west of UTC',async()=>{
  await zone();await task(owner,'2027-07-05');
  assert.equal(await enqueue('2027-07-05T15:59:59Z'),0);
  assert.equal(await enqueue('2027-07-05T16:00:00Z'),1);
  await zone(tech,'Pacific/Kiritimati');await task(tech,'2027-07-06');
  assert.equal(await enqueue('2027-07-05T18:59:59Z'),0);
  assert.equal(await enqueue('2027-07-05T19:00:00Z'),1);
  await zone(tech,'Pacific/Honolulu');await task(tech,'2027-07-05');
  assert.equal(await enqueue('2027-07-06T01:00:00Z'),1);
});

test('catches up same-day late creates, not old overdue tasks or users without a timezone',async()=>{
  await zone();await task(owner,'2027-01-04');await task(tech);await task();
  assert.equal(await enqueue('2027-01-05T20:00:00Z'),1);
  assert.equal(await enqueue('2027-01-06T20:00:00Z'),0);
});

test('completion before 9 AM prevents reminder; completion or rescheduling before claim cancels push',async()=>{
  await zone();const completed=await task();
  await db.query('delete from public.personal_tasks where id=$1',[completed]);
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),0);
  const removed=await task(),rescheduled=await task();
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),2);
  await db.query('delete from public.personal_tasks where id=$1',[removed]);
  await db.query("update public.personal_tasks set due_date='2027-01-06' where id=$1",[rescheduled]);
  assert.equal((await claim()).rows.length,0);
  assert.equal((await row("select count(*)::int count from public.push_notification_jobs where status='skipped'")).count,2);
  assert.equal(await enqueue('2027-01-06T17:00:00Z'),1);
});

test('push preference disables push but keeps inbox; preference changes before claim are honored',async()=>{
  await zone();await task();
  await db.query('update public.notification_preferences set push_enabled=false');
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),1);
  assert.equal((await row('select count(*)::int count from public.push_notification_jobs')).count,0);
  await db.query('update public.notification_preferences set push_enabled=true');await task();
  assert.equal(await enqueue('2027-01-05T18:00:00Z'),1);
  await db.query('update public.notification_preferences set push_enabled=false');
  assert.equal((await claim()).rows.length,0);
  assert.equal((await row('select count(*)::int count from public.user_notifications')).count,2);
});

test('tech reminders count in badges; role loss prevents enqueue and cancels queued push',async()=>{
  await zone(tech);await task(tech);
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),1);
  const jobs=(await claim()).rows;assert.equal(jobs.length,1);assert.equal(Number(jobs[0].badge_count),1);
  await task(tech);assert.equal(await enqueue('2027-01-05T18:00:00Z'),1);
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[tech]);
  assert.equal((await claim()).rows.length,0);
  await task(tech);assert.equal(await enqueue('2027-01-05T19:00:00Z'),0);
});

test('timezone writes require own eligible account/company, validate zones and preserve push preferences',async()=>{
  await zone();await db.query('update public.notification_preferences set push_enabled=false');
  await zone(owner,'America/New_York');
  assert.deepEqual(await row('select task_reminder_timezone,push_enabled from public.notification_preferences'),{task_reminder_timezone:'America/New_York',push_enabled:false});
  await assert.rejects(zone(owner,'Not/A_Zone'),/Invalid reminder timezone/);
  await assert.rejects(zone(crew),/Task reminder access denied/);
  await assert.rejects(zone(owner,'UTC',otherCompany),/Task reminder access denied/);
  await assert.rejects(actor(owner,()=>db.query('select public.set_task_reminder_timezone($1,$2,$3)',[company,tech,'UTC'])),/Task reminder access denied/);
  await assert.rejects(actor(owner,()=>db.query("update public.notification_preferences set task_reminder_timezone='invalid'")),/Invalid reminder timezone/);
  await assert.rejects(actor(owner,()=>db.query('select public.enqueue_due_task_reminders()')),/permission denied/);
  await assert.rejects(actor(owner,()=>db.query('select public.claim_push_notification_jobs()')),/permission denied/);
});

test('existing mandatory payroll/system notifications retain push behavior',async()=>{
  await zone();await zone(tech);await db.query('update public.notification_preferences set push_enabled=false');
  for(const [recipient,event] of [[owner,'system'],[tech,'payroll_rejected']]){
    await db.query("select public.create_user_notification($1,$2,null,$3,'system',null,'Payroll','Review payroll','/payroll','payroll:test',$4)",[company,recipient,event,`payroll-test:${recipient}`]);
  }
  const jobs=(await claim()).rows;
  assert.equal(jobs.length,2);
  assert.deepEqual(jobs.map(job=>job.event_type).sort(),['payroll_rejected','system']);
});

test('task content can be edited by owner only; ownership and company cannot be reassigned',async()=>{
  const id=await task();
  assert.equal((await actor(owner,()=>db.query("update public.personal_tasks set subject='Changed' where id=$1 returning subject",[id]))).rows[0].subject,'Changed');
  assert.equal((await actor(tech,()=>db.query("update public.personal_tasks set subject='Stolen' where id=$1 returning subject",[id]))).rows.length,0);
  await assert.rejects(actor(owner,()=>db.query('update public.personal_tasks set user_id=$1 where id=$2',[tech,id])),/permission denied/);
  await assert.rejects(actor(owner,()=>db.query('update public.personal_tasks set company_id=$1 where id=$2',[otherCompany,id])),/permission denied/);
});
