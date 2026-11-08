import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Shop board + fleet repairs: who reads and writes shop rows, server-owned job
// numbers and notes, and the one-way fleet issue → shop job sync.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',tech='20000000-0000-4000-8000-000000000002',crew='20000000-0000-4000-8000-000000000003';
const accountant='20000000-0000-4000-8000-000000000004',outsider='20000000-0000-4000-8000-000000000005';
const vehicle='30000000-0000-4000-8000-000000000001',backfilledIssue='40000000-0000-4000-8000-000000000001',closedIssue='40000000-0000-4000-8000-000000000002';
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const row=async(sql,args=[])=>(await rows(sql,args))[0];
async function as(user,task,{role='authenticated',headers}={}){
  await db.exec('begin');
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.headers',$3,true)",[user??'',role,headers?JSON.stringify(headers):'']);
    await db.exec(`set local role ${role}`);
    const result=await task();await db.exec('commit');return result;
  }catch(error){await db.exec('rollback');throw error}
}
// Edge Functions write with the service role and forward the verified user.
const asEdge=(user,task)=>as(null,task,{role:'service_role',headers:{'x-fireops-actor-id':user}});
const issueData=(id,overrides={})=>({id,vehicleId:vehicle,title:'Pump pressure drop',description:'Loses pressure at idle',priority:'Critical',status:'Open',updates:[],createdBy:'Crew Person',createdById:crew,createdAt:'2026-01-01T00:00:00.000Z',...overrides});
const putIssue=(id,overrides={})=>db.query(`insert into public.fleet_issues(company_id,record_id,data,updated_by) values($1,$2,$3,$4)
  on conflict (company_id,record_id) do update set data=excluded.data,version=public.fleet_issues.version+1`,[company,id,JSON.stringify(issueData(id,overrides)),crew]);
const jobFor=issue=>row('select * from public.shop_jobs where company_id=$1 and source_fleet_issue_id=$2',[company,issue]);
const notesFor=job=>rows('select body,kind,status_set,author_id,author_name from public.shop_job_notes where job_id=$1 order by created_at',[job]);
const createJob=(values={})=>asEdge(owner,()=>row(`insert into public.shop_jobs(company_id,title,kind,shop_area,fleet_vehicle_id,opened_by,opened_by_name)
  values($1,$2,$3,$4,$5,$6,'Owner') returning *`,[company,values.title??'Sharpen chain',values.kind??'general',values.kind==='fleet'?null:'Saw shop',values.kind==='fleet'?vehicle:null,owner]));

async function seedCompanies(){
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies(id) values($1),($2)',[company,other]);
  await db.query("insert into public.profiles(user_id,full_name) values($1,'Owner'),($2,'Tech'),($3,'Crew Person'),($4,'Accountant'),($5,'Outsider')",[owner,tech,crew,accountant,outsider]);
  await db.query("insert into public.company_members values($1,$2,'owner'),($1,$3,'shop_tech'),($1,$4,'fire_fighter'),($1,$5,'accounting'),($6,$7,'owner')",[company,owner,tech,crew,accountant,other,outsider]);
  await db.query(`insert into public.fleet_vehicles(company_id,record_id,data,updated_by) values($1,$2,$3,$4)`,[company,vehicle,JSON.stringify({id:vehicle,unit:'Engine 701'}),owner]);
}

const backfill={};
before(async()=>{
  await loadFleetSyncSchema(db);
  await db.exec('create publication supabase_realtime');
  // The real audit trigger is covered by company-audit-log.test.mjs.
  await db.exec("create function public.capture_company_audit_log() returns trigger language plpgsql as $$ begin return null; end; $$");
  // Issues saved before the migration: open ones get a job, resolved ones do not.
  await seedCompanies();
  await putIssue(backfilledIssue,{priority:'High'});
  await putIssue(closedIssue,{status:'Resolved'});
  await db.exec(migration('20270110000100_shop_fleet_repairs'));
  backfill.open=await jobFor(backfilledIssue);
  backfill.closed=await jobFor(closedIssue);
  backfill.types=(await row('select count(*)::int n from public.repair_types where company_id=$1',[company])).n;
});
beforeEach(seedCompanies);
after(async()=>{await db.close()});

test('existing open fleet issues get one queued shop job; repair types are seeded',()=>{
  assert.equal(backfill.open.status,'queued');assert.equal(backfill.open.priority,'high');assert.equal(backfill.open.kind,'fleet');
  assert.equal(backfill.open.fleet_vehicle_id,vehicle);assert.equal(backfill.open.opened_by,crew);assert.equal(backfill.open.opened_by_name,'Crew Person');
  assert.equal(new Date(backfill.open.opened_at).toISOString(),'2026-01-01T00:00:00.000Z');
  assert.equal(backfill.closed,undefined);
  assert.equal(backfill.types,14);
});

test('new companies get the default repair types',async()=>{
  const id=randomUUID();await db.query('insert into public.companies(id) values($1)',[id]);
  const names=(await rows('select name from public.repair_types where company_id=$1 order by name',[id])).map(item=>item.name);
  assert.equal(names.length,14);assert.ok(names.includes('Oil change'));
});

test('job numbers are allocated per company and cannot be chosen or changed',async()=>{
  const first=await createJob(),second=await createJob({title:'Fix vise'}),elsewhere=await asEdge(outsider,()=>row(`insert into public.shop_jobs(company_id,job_number,title,kind,opened_by,opened_by_name) values($1,'SJ-9999','Other','general',$2,'Outsider') returning job_number`,[other,outsider]));
  assert.match(first.job_number,/^SJ-\d{4}$/);
  assert.equal(Number(second.job_number.slice(3)),Number(first.job_number.slice(3))+1);
  assert.equal(elsewhere.job_number,'SJ-0001');
  await assert.rejects(asEdge(owner,()=>db.query("update public.shop_jobs set job_number='SJ-0042' where id=$1",[first.id])),error=>error.code==='22023');
});

test('every member reads the board; other companies and outsiders do not',async()=>{
  const job=await createJob();
  for(const user of [owner,tech,crew,accountant]){
    const visible=await as(user,()=>rows('select id from public.shop_jobs where id=$1',[job.id]));
    assert.equal(visible.length,1,user);
    assert.equal((await as(user,()=>row('select count(*)::int n from public.repair_types where company_id=$1',[company]))).n,14);
  }
  assert.equal((await as(outsider,()=>rows('select id from public.shop_jobs where id=$1',[job.id]))).length,0);
  assert.equal((await as(outsider,()=>rows('select id from public.repair_types where company_id=$1',[company]))).length,0);
});

test('only owners, admins and shop techs change priority and status or delete jobs',async()=>{
  const job=await createJob();
  for(const user of [crew,accountant,outsider]){
    const updated=await as(user,()=>rows("update public.shop_jobs set priority='critical' where id=$1 returning id",[job.id]));
    assert.equal(updated.length,0,user);
    assert.equal((await as(user,()=>rows('delete from public.shop_jobs where id=$1 returning id',[job.id]))).length,0,user);
  }
  assert.equal((await as(tech,()=>rows("update public.shop_jobs set priority='critical',status='progress' where id=$1 returning id",[job.id]))).length,1);
  assert.equal((await row('select priority,status from public.shop_jobs where id=$1',[job.id])).priority,'critical');
  assert.equal((await as(owner,()=>rows('delete from public.shop_jobs where id=$1 returning id',[job.id]))).length,1);
});

test('clients cannot create jobs, write notes, file repairs or touch server-owned columns',async()=>{
  const job=await createJob();
  const denied=error=>error.code==='42501';
  await assert.rejects(as(owner,()=>db.query("insert into public.shop_jobs(company_id,title,kind,shop_area,opened_by,opened_by_name) values($1,'X','general','Bay',$2,'Owner')",[company,owner])),denied);
  await assert.rejects(as(tech,()=>db.query("insert into public.shop_job_notes(company_id,job_id,body,author_id,author_name) values($1,$2,'hi',$3,'Owner')",[company,job.id,owner])),denied);
  await assert.rejects(as(tech,()=>db.query("update public.shop_jobs set opened_by=$2 where id=$1",[job.id,tech])),denied);
  await assert.rejects(as(owner,()=>db.query("insert into public.repair_types(company_id,name,name_normalized) values($1,'Paint','paint')",[company])),denied);
  await assert.rejects(as(owner,()=>db.query(`insert into public.fleet_repairs(company_id,fleet_vehicle_id,repair_type_text,reading_value,reading_unit,reading_source,tech_id,tech_name)
    values($1,$2,'Brakes',1,'miles','motive',$3,'Owner')`,[company,vehicle,owner])),denied);
  await assert.rejects(as(owner,()=>db.query('delete from public.shop_job_notes where job_id=$1',[job.id])),denied);
});

test('status changes leave a note naming who made them, from the client or an Edge Function',async()=>{
  const job=await createJob();
  await as(tech,()=>db.query("update public.shop_jobs set status='parts',blocker_reason='Waiting on hose' where id=$1",[job.id]));
  await asEdge(owner,()=>db.query("update public.shop_jobs set status='progress' where id=$1",[job.id]));
  await as(tech,()=>db.query("update public.shop_jobs set priority='low' where id=$1",[job.id]));
  const notes=await notesFor(job.id);
  assert.deepEqual(notes.map(note=>[note.body,note.author_id,note.author_name,note.status_set]),[
    ['Status changed Not started → Waiting on parts',tech,'Tech','parts'],
    ['Status changed Waiting on parts → In progress',owner,'Owner','progress'],
  ]);
  const current=await row('select status,blocker_reason from public.shop_jobs where id=$1',[job.id]);
  assert.equal(current.blocker_reason,null);
});

test('blocked statuses need a reason; jobs are assigned only to company members',async()=>{
  const job=await createJob();
  await assert.rejects(as(tech,()=>db.query("update public.shop_jobs set status='parts' where id=$1",[job.id])),error=>error.code==='23514');
  await assert.rejects(as(tech,()=>db.query('update public.shop_jobs set assigned_tech_id=$2 where id=$1',[job.id,outsider])),error=>error.code==='22023');
  await as(tech,()=>db.query('update public.shop_jobs set assigned_tech_id=$2 where id=$1',[job.id,tech]));
  const assigned=await row('select assigned_tech_id,assigned_tech_name,assigned_at from public.shop_jobs where id=$1',[job.id]);
  assert.equal(assigned.assigned_tech_id,tech);assert.equal(assigned.assigned_tech_name,'Tech');assert.ok(assigned.assigned_at);
  // The name is server-owned: clients cannot rename the assignee.
  await assert.rejects(as(tech,()=>db.query("update public.shop_jobs set assigned_tech_name='Someone' where id=$1",[job.id])),error=>error.code==='42501');
  await as(owner,()=>db.query('update public.shop_jobs set assigned_tech_id=null where id=$1',[job.id]));
  const cleared=await row('select assigned_tech_name,assigned_at from public.shop_jobs where id=$1',[job.id]);
  assert.equal(cleared.assigned_tech_name,null);assert.equal(cleared.assigned_at,null);
});

test('fleet issues open, update, resolve, reopen and remove their shop job',async()=>{
  const issue=randomUUID();
  await putIssue(issue);
  let job=await jobFor(issue);
  assert.equal(job.priority,'critical');assert.equal(job.title,'Pump pressure drop');assert.equal(job.status,'queued');
  // Board edits survive issue edits that do not touch those fields.
  await as(tech,()=>db.query("update public.shop_jobs set priority='low',status='progress' where id=$1",[job.id]));
  await putIssue(issue,{description:'Now at all RPMs'});
  job=await jobFor(issue);
  assert.equal(job.priority,'low');assert.equal(job.status,'progress');assert.equal(job.description,'Now at all RPMs');
  await putIssue(issue,{description:'Now at all RPMs',priority:'High'});
  assert.equal((await jobFor(issue)).priority,'high');
  await putIssue(issue,{description:'Now at all RPMs',priority:'High',status:'Resolved'});
  assert.equal((await jobFor(issue)).status,'done');
  await putIssue(issue,{description:'Now at all RPMs',priority:'High',status:'Open'});
  assert.equal((await jobFor(issue)).status,'queued');
  await db.query('delete from public.fleet_issues where company_id=$1 and record_id=$2',[company,issue]);
  assert.equal((await jobFor(issue)).status,'done');
  assert.deepEqual((await notesFor(job.id)).map(note=>note.body),[
    'Created from fleet issue reported by Crew Person',
    'Status changed Not started → In progress',
    'Fleet issue resolved — shop task closed',
    'Fleet issue reopened — shop task reopened',
    'Fleet issue removed — shop task closed',
  ]);
  assert.equal((await rows('select id from public.shop_jobs where source_fleet_issue_id=$1',[issue])).length,1);
});

test('issues for unknown vehicles are skipped instead of failing the fleet write',async()=>{
  const issue=randomUUID();
  await putIssue(issue,{vehicleId:randomUUID()});
  assert.equal(await jobFor(issue),undefined);
  assert.equal((await row('select count(*)::int n from public.fleet_issues where record_id=$1',[issue])).n,1);
});

test('repairs keep a manual reason only for manual readings and survive a deleted job',async()=>{
  const job=await createJob({kind:'fleet'});
  const file=(source,reason)=>asEdge(owner,()=>row(`insert into public.fleet_repairs(company_id,fleet_vehicle_id,repair_type_text,reading_value,reading_unit,reading_source,manual_reason,tech_id,tech_name,shop_job_id)
    values($1,$2,'Brakes',48210,'miles',$3,$4,$5,'Owner',$6) returning id`,[company,vehicle,source,reason,owner,job.id]));
  await assert.rejects(file('manual',null),error=>error.code==='23514');
  await assert.rejects(file('motive','Typed it'),error=>error.code==='23514');
  const repair=await file('manual','Motive offline');
  await as(owner,()=>db.query('delete from public.shop_jobs where id=$1',[job.id]));
  const kept=await row('select company_id,shop_job_id from public.fleet_repairs where id=$1',[repair.id]);
  assert.equal(kept.company_id,company);assert.equal(kept.shop_job_id,null);
  assert.equal((await as(crew,()=>rows('select id from public.fleet_repairs where id=$1',[repair.id]))).length,1);
});
