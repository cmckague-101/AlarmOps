import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadUserSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Verified user-domain snapshot: own data only, current task roles, consistent
// with the receipt watermark; denial is never an empty task list.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,entityType,entityId,cmd,payload,companyId=company){
  return {schemaVersion:1,operationId:randomUUID(),companyId,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const snapshot=(user,companyId=company)=>actor(user,async()=>(await row('select public.get_user_sync_snapshot($1) result',[companyId])).result);
before(async()=>{await loadUserSyncSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.user_sync_receipts cascade;truncate public.dashboard_preferences');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3),($8,$6,$7)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('returns own tasks, availability and layout with the latest own receipt as watermark',async()=>{
  const empty=await snapshot(tech);
  assert.deepEqual({...empty,serverRequestAt:undefined},{schemaVersion:1,companyId:company,userId:tech,serverRequestAt:undefined,receiptWatermark:'0',tasks:[],availability:null,dashboard:{}});
  const id=randomUUID();const created=await send(command(tech,'personal_task',id,'task.create',{subject:'Filters',description:'',dueDate:'2026-01-05'}));
  const set=await send(command(tech,'availability',tech,'availability.set',{available:true,base:null}));
  await send(command(tech,'dashboard',tech,'dashboard.set',{changes:{tasks:false}}));
  await db.query("insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,'Other company','2026-01-01')",[randomUUID(),other,tech]);
  await db.query("insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,'Owner task','2026-01-01')",[randomUUID(),company,owner]);
  const value=await snapshot(tech);
  assert.deepEqual(value.tasks,[{id,subject:'Filters',description:'',dueDate:'2026-01-05'}]);assert.equal(value.availability,true);assert.deepEqual(value.dashboard,{tasks:false});
  assert.ok(BigInt(value.receiptWatermark)>=BigInt(set.revision));assert.ok(BigInt(value.receiptWatermark)>BigInt(created.revision));
  assert.ok(Number.isFinite(Date.parse(value.serverRequestAt)));
});
test('roles without task access get no task list rather than an empty one',async()=>{
  const value=await snapshot(crew);assert.equal(value.tasks,null);assert.equal(value.availability,null);
  await db.query("insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,'Kept','2026-01-01')",[randomUUID(),company,tech]);
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1 and company_id=$2",[tech,company]);
  assert.equal((await snapshot(tech)).tasks,null);assert.equal((await row('select count(*)::int count from public.personal_tasks')).count,1);
});
test('requires current membership and refuses oversized task lists',async()=>{
  await assert.rejects(snapshot(outsider),error=>error.code==='42501');await assert.rejects(snapshot(null),error=>error.code==='42501');
  await db.query("insert into public.personal_tasks(id,company_id,user_id,subject,due_date) select gen_random_uuid(),$1,$2,'T'||n,'2026-01-01' from generate_series(1,1001) n",[company,tech]);
  await assert.rejects(snapshot(tech),error=>error.code==='54000');
});
test('commands take the per-user lock before entity locks; the snapshot takes it shared',()=>{
  const commands=migration('20261127000100_user_sync_commands');const snapshotSql=migration('20261206000100_user_sync_snapshot');
  const user=commands.indexOf("hashtextextended('user-sync-user:' || actor::text, 0)");const entity=commands.indexOf("hashtextextended('user-sync:' || actor::text");
  assert.ok(user>0&&user<entity);assert.match(snapshotSql,/pg_advisory_xact_lock_shared\(hashtextextended\('user-sync-user:' \|\| actor::text, 0\)\)/);
});
