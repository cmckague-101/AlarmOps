import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Fleet Service oil change (20270108000100): shop techs may change only the
// next oil change fields, values are validated, and every shop tech gets one
// pushed 'oil_change_due' notification from 9 AM local on the due date.

const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',tech='20000000-0000-4000-8000-000000000002',crew='20000000-0000-4000-8000-000000000003',tech2='20000000-0000-4000-8000-000000000004';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,action,role='authenticated'){
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.exec(`set local role ${role}`);
    const result=await action();await db.exec('commit');return result;
  } catch(error){await db.exec('rollback');throw error;}
}
const enqueue=async time=>(await actor(owner,()=>row('select public.enqueue_due_oil_change_reminders($1) count',[time]),'service_role')).count;
const claim=()=>actor(owner,()=>db.query('select * from public.claim_push_notification_jobs()'),'service_role');
const data=async id=>(await row('select data from public.fleet_vehicles where record_id=$1',[id])).data;
const patch=(user,id,changes)=>actor(user,()=>db.query('update public.fleet_vehicles set data=data||$2::jsonb,updated_by=auth.uid() where record_id=$1',[id,JSON.stringify(changes)]));
const unset=(user,id,...keys)=>actor(user,()=>db.query('update public.fleet_vehicles set data=data-$2::text[],updated_by=auth.uid() where record_id=$1',[id,keys]));
async function vehicle(fields={},target=company){
  const id=randomUUID();
  await db.query('insert into public.fleet_vehicles(company_id,record_id,data,updated_by) values($1,$2,$3,$4)',[target,id,JSON.stringify({id,unit:'Engine 7',status:'Ready',...fields}),owner]);
  return id;
}

before(async()=>{
  await loadFleetSyncSchema(db);
  await db.exec(migration('20261107000100_personal_tasks'));
  await db.exec(migration('20261228000100_personal_task_editing'));
  const inbox=migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(inbox.slice(inbox.indexOf('create table public.notification_preferences'),inbox.indexOf('create table public.push_notification_deliveries')));
  await db.exec('alter table public.notification_preferences enable row level security;alter table public.user_notifications enable row level security');
  await db.exec(inbox.slice(inbox.indexOf('create policy "users read own notification preferences"'),inbox.indexOf('revoke all on public.notification_preferences')));
  await db.exec('grant select, insert, update on public.notification_preferences to authenticated;grant select on public.user_notifications to authenticated');
  await db.exec(migration('20261226000100_payroll_rejected_notifications'));
  await db.exec(migration('20261229000100_task_due_reminders'));
  await db.exec(migration('20270108000100_vehicle_oil_change_due'));
});
beforeEach(async()=>{
  await db.exec('truncate public.user_notifications cascade;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,otherCompany]);
  await db.query("insert into public.profiles values($1,'Owner'),($2,'Tech'),($3,'Crew'),($4,'Tech Two')",[owner,tech,crew,tech2]);
  await db.query("insert into public.company_members values($1,$2,'owner'),($1,$3,'shop_tech'),($1,$4,'fire_fighter'),($5,$6,'shop_tech')",[company,owner,tech,crew,otherCompany,tech2]);
});
after(async()=>{await db.close()});

test('shop techs may set and clear only the oil change fields; crew may not',async()=>{
  const id=await vehicle();
  await patch(tech,id,{nextOilChange:'45,000 mi',nextOilChangeDue:'2027-01-05'});
  assert.equal((await data(id)).nextOilChangeDue,'2027-01-05');
  await unset(tech,id,'nextOilChange','nextOilChangeDue');
  assert.equal((await data(id)).nextOilChange,undefined);
  await assert.rejects(patch(tech,id,{nextOilChange:'250 hrs',plate:'NEW-1'}),/This role cannot make the requested vehicle change/);
  await assert.rejects(patch(crew,id,{nextOilChangeDue:'2027-01-05'}),/This role cannot make the requested vehicle change/);
  await patch(owner,id,{nextOilChange:'250 hrs',plate:'NEW-1'});
  assert.equal((await data(id)).plate,'NEW-1');
});

test('rejects invalid oil change values from every role, including owners',async()=>{
  const id=await vehicle();
  for(const bad of ['2027-02-30','01/05/2027','2027-1-5',null,20270105])
    await assert.rejects(patch(owner,id,{nextOilChangeDue:bad}),/Oil change due date must be a YYYY-MM-DD date/);
  await assert.rejects(patch(tech,id,{nextOilChange:'x'.repeat(121)}),/120 characters or fewer/);
  await assert.rejects(patch(owner,id,{nextOilChange:null}),/120 characters or fewer/);
  await assert.rejects(vehicle({nextOilChangeDue:'soon'}),/YYYY-MM-DD/);
  await patch(owner,id,{nextOilChange:'x'.repeat(120),nextOilChangeDue:'2028-02-29'});
});

test('queues once per shop tech at 9 AM local on the due date, with a path to Service',async()=>{
  const id=await vehicle({nextOilChange:'45,000 mi',nextOilChangeDue:'2027-01-05'});
  await vehicle({nextOilChangeDue:'2027-01-05'},otherCompany);
  assert.equal(await enqueue('2027-01-05T16:59:59Z'),0);
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),2);
  assert.equal(await enqueue('2027-01-05T18:00:00Z'),0);
  const notice=await row('select * from public.user_notifications where user_id=$1',[tech]);
  assert.equal(notice.company_id,company);assert.equal(notice.entity_id,id);assert.equal(notice.entity_type,'vehicle');
  assert.equal(notice.event_type,'oil_change_due');assert.equal(notice.path,`/vehicle-notes/${id}`);
  assert.equal(notice.title,'Engine 7 needs an oil change');
  assert.equal(notice.body,'Oil change due Jan 5, 2027 · 45,000 mi. Open Service to update it.');
  assert.equal((await row('select count(*)::int count from public.user_notifications where user_id = any($1)',[[owner,crew]])).count,0);
  const jobs=(await claim()).rows;assert.equal(jobs.length,2);assert.equal(Number(jobs[0].badge_count),1);
  assert.equal((await actor(tech,()=>db.query('select id from public.user_notifications'))).rows.length,1);
});

test('uses the saved reminder timezone, catches up past dates and reminds again for a new date',async()=>{
  await actor(tech,()=>db.query('select public.set_task_reminder_timezone($1,$2,$3)',[company,tech,'America/New_York']));
  const id=await vehicle({nextOilChangeDue:'2027-01-05'});
  assert.equal(await enqueue('2027-01-05T13:59:59Z'),0);
  assert.equal(await enqueue('2027-01-05T14:00:00Z'),1);
  await patch(tech,id,{nextOilChangeDue:'2026-12-01'});
  assert.equal(await enqueue('2027-01-05T15:00:00Z'),1);
  assert.equal(await enqueue('2027-01-05T16:00:00Z'),0);
  await patch(tech,id,{nextOilChangeDue:'2027-03-01'});
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),0);
});

test('push preference keeps inbox only; changed dates, deleted vehicles and role loss cancel queued pushes',async()=>{
  await db.query('insert into public.notification_preferences(company_id,user_id,push_enabled) values($1,$2,false)',[company,tech]);
  await vehicle({nextOilChangeDue:'2027-01-05'});
  assert.equal(await enqueue('2027-01-05T17:00:00Z'),1);
  assert.equal((await row('select count(*)::int count from public.push_notification_jobs')).count,0);
  await db.query('update public.notification_preferences set push_enabled=true');
  const moved=await vehicle({nextOilChangeDue:'2027-01-05'}),removed=await vehicle({nextOilChangeDue:'2027-01-05'}),kept=await vehicle({nextOilChangeDue:'2027-01-05'});
  assert.equal(await enqueue('2027-01-05T18:00:00Z'),3);
  await patch(tech,moved,{nextOilChangeDue:'2027-02-01'});
  await db.query('delete from public.fleet_vehicles where record_id=$1',[removed]);
  const jobs=(await claim()).rows;
  assert.deepEqual(jobs.map(job=>job.entity_id),[kept]);
  assert.equal((await row("select count(*)::int count from public.push_notification_jobs where status='skipped'")).count,2);
  await vehicle({nextOilChangeDue:'2027-01-05'});
  assert.equal(await enqueue('2027-01-05T19:00:00Z'),1);
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[tech]);
  assert.equal((await claim()).rows.length,0);
  await vehicle({nextOilChangeDue:'2027-01-05'});
  assert.equal(await enqueue('2027-01-05T20:00:00Z'),0);
});

test('only the dispatcher may queue reminders',async()=>{
  await assert.rejects(actor(owner,()=>db.query('select public.enqueue_due_oil_change_reminders()')),/permission denied/);
});
