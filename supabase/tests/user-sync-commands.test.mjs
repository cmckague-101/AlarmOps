import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadUserSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,entityType,entityId,cmd,payload,dependsOn=[]){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn,mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const state=(user,entity,id)=>actor(user,async()=>(await row('select public.get_user_sync_state($1,$2,$3) result',[company,entity,id])).result);
const task=(changes={})=>({subject:'Order filters',description:'Two cases',dueDate:'2026-01-05',...changes});
const legacyLive=randomUUID(),legacyCompleted=randomUUID(),legacyAbsent=randomUUID();
before(async()=>{await loadUserSyncSchema(db,async()=>{
  await db.query('insert into public.companies values($1)',[company]);await db.query('insert into public.profiles values($1,$2)',[owner,'Owner']);await db.query('insert into public.company_members values($1,$2,$3)',[company,owner,'owner']);
  await db.query('insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,$4,$5)',[legacyLive,company,owner,'Legacy online task','2026-01-05']);
  const create=command(owner,'personal_task',legacyCompleted,'task.create',task());await send(create);await send(command(owner,'personal_task',legacyCompleted,'task.complete',{},[create.operationId]));
  await send(command(owner,'personal_task',legacyAbsent,'task.complete',{}));
})});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('tasks are created with client IDs, replay idempotently and complete only after their create',async()=>{
  const id=randomUUID();const create=command(tech,'personal_task',id,'task.create',task());
  const complete=command(tech,'personal_task',id,'task.complete',{},[create.operationId]);
  await assert.rejects(send(complete),error=>error.code==='55000');
  const created=await send(create);assert.deepEqual(created.record,{id,...task()});assert.deepEqual(await send(create),created);
  assert.equal((await state(tech,'personal_task',id)).revision,created.revision);
  const done=await send(complete);assert.equal(done.record,null);assert.equal((await row('select count(*)::int count from public.personal_tasks')).count,0);
  assert.equal(BigInt((await state(tech,'personal_task',id)).revision)>=BigInt(done.revision),true);
  await assert.rejects(send({...create,mutation:{...create.mutation,payload:task({subject:'Other'})}}),error=>error.code==='22023');
});
test('completed task IDs cannot be recreated by a fresh operation or another user',async()=>{
  const id=randomUUID();const create=command(tech,'personal_task',id,'task.create',task());const original=await send(create);
  await send(command(tech,'personal_task',id,'task.complete',{},[create.operationId]));
  assert.deepEqual(await send(create),original);assert.equal((await state(tech,'personal_task',id)).record,null);
  await assert.rejects(send(command(tech,'personal_task',id,'task.create',task())),error=>error.code==='23505');
  await assert.rejects(send(command(owner,'personal_task',id,'task.create',task())),error=>error.code==='23505');
  assert.equal((await row('select count(*)::int count from public.personal_tasks where id=$1',[id])).count,0);
});
test('online task inserts also reserve IDs permanently and completion of an absent ID retires it',async()=>{
  const id=randomUUID();const insert=()=>actor(owner,()=>db.query('insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,$4,$5)',[id,company,owner,'Online task','2026-01-05']));
  await insert();await actor(owner,()=>db.query('delete from public.personal_tasks where id=$1',[id]));await assert.rejects(insert(),error=>error.code==='23505');
  const absent=randomUUID();await send(command(tech,'personal_task',absent,'task.complete',{}));await assert.rejects(send(command(tech,'personal_task',absent,'task.create',task())),error=>error.code==='23505');
});
test('task identity migration backfills live rows and receipt targets without retaining private metadata',async()=>{
  for(const id of [legacyLive,legacyCompleted,legacyAbsent]){
    assert.equal((await row('select id from public.personal_task_identities where id=$1',[id])).id,id);
    await assert.rejects(send(command(owner,'personal_task',id,'task.create',task())),error=>error.code==='23505');
  }
  assert.deepEqual((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='personal_task_identities' order by ordinal_position")).rows.map(column=>column.column_name),['id']);
  await assert.rejects(actor(owner,()=>db.query('select * from public.personal_task_identities')),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('insert into public.personal_task_identities values($1)',[randomUUID()])),error=>error.code==='42501');
  await assert.rejects(db.query('delete from public.personal_task_identities where id=$1',[legacyLive]),error=>error.code==='42501');
  await assert.rejects(db.query('update public.personal_task_identities set id=$1 where id=$2',[randomUUID(),legacyLive]),error=>error.code==='42501');
});
test('failed RLS and receipt writes roll back task identity reservation together',async()=>{
  const denied=randomUUID();await assert.rejects(actor(crew,()=>db.query('insert into public.personal_tasks(id,company_id,user_id,subject,due_date) values($1,$2,$3,$4,$5)',[denied,company,crew,'Forbidden','2026-01-05'])),error=>error.code==='42501');
  assert.equal(await row('select id from public.personal_task_identities where id=$1',[denied]),undefined);await send(command(owner,'personal_task',denied,'task.create',task()));
  const id=randomUUID();const create=command(owner,'personal_task',id,'task.create',task());
  await db.exec("create function public.sync_test_fail_task_receipt() returns trigger language plpgsql as $$ begin raise exception 'Receipt write failed'; end; $$;create trigger sync_test_fail_task_receipt before insert on public.user_sync_receipts for each row execute function public.sync_test_fail_task_receipt()");
  try{
    await assert.rejects(send(create),/Receipt write failed/);
    assert.equal(await row('select id from public.personal_task_identities where id=$1',[id]),undefined);assert.equal(await row('select id from public.personal_tasks where id=$1',[id]),undefined);
    assert.equal((await row('select count(*)::int count from public.user_sync_receipts where operation_id=$1',[create.operationId])).count,0);
  }finally{await db.exec('drop trigger sync_test_fail_task_receipt on public.user_sync_receipts;drop function public.sync_test_fail_task_receipt()')}
  await send(create);assert.equal((await row('select id from public.personal_task_identities where id=$1',[id])).id,id);
});
test('task ownership cannot move and opaque retirement survives company deletion',async()=>{
  const id=randomUUID();await send(command(owner,'personal_task',id,'task.create',task()));
  for(const [column,value] of [['id',randomUUID()],['company_id',other],['user_id',tech]])await assert.rejects(actor(null,()=>db.query(`update public.personal_tasks set ${column}=$1 where id=$2`,[value,id]),'service_role'),error=>error.code==='42501');
  await db.query('delete from public.companies where id=$1',[company]);assert.equal((await row('select id from public.personal_task_identities where id=$1',[id])).id,id);
  await assert.rejects(send({...command(outsider,'personal_task',id,'task.create',task()),companyId:other}),error=>error.code==='23505');
});
test('task role revocation denies completion, canonical reads and cached receipt replay',async()=>{
  const id=randomUUID();const create=command(tech,'personal_task',id,'task.create',task());await send(create);
  const complete=command(tech,'personal_task',id,'task.complete',{});await send(complete);
  const live=randomUUID(),absent=randomUUID();await send(command(tech,'personal_task',live,'task.create',task()));
  await db.query("update public.company_members set role='fire_fighter' where company_id=$1 and user_id=$2",[company,tech]);
  for(const operation of [create,complete,command(tech,'personal_task',absent,'task.complete',{}),command(tech,'personal_task',live,'task.complete',{})])await assert.rejects(send(operation),error=>error.code==='42501');
  await assert.rejects(state(tech,'personal_task',id),error=>error.code==='42501');
  assert.equal(await row('select id from public.personal_task_identities where id=$1',[absent]),undefined);assert.equal((await row('select id from public.personal_tasks where id=$1',[live])).id,live);
});
test('tasks stay private and limited to eligible roles',async()=>{
  const id=randomUUID();await send(command(owner,'personal_task',id,'task.create',task()));
  await assert.rejects(send(command(crew,'personal_task',randomUUID(),'task.create',task())),error=>error.code==='42501');
  assert.equal((await state(tech,'personal_task',id)).record,null);
  await send(command(tech,'personal_task',id,'task.complete',{}));assert.equal((await row('select count(*)::int count from public.personal_tasks')).count,1);
  await assert.rejects(send(command(tech,'personal_task',id,'task.create',task())),error=>error.code==='23505');
  for(const payload of [task({subject:' '}),task({dueDate:'tomorrow'}),{...task(),extra:1}])await assert.rejects(send(command(owner,'personal_task',randomUUID(),'task.create',payload)),error=>error.code==='22023');
});
test('availability applies over an unchanged base and keeps a value someone else changed',async()=>{
  const first=await send(command(crew,'availability',crew,'availability.set',{available:true,base:null}));assert.deepEqual(first.record,{id:crew,available:true});
  await actor(owner,()=>db.query('select public.set_crew_availability_once($1::jsonb)',[JSON.stringify({schemaVersion:1,requestId:randomUUID(),companyId:company,actorId:owner,userId:crew,base:true,available:false,savedAt:'2026-01-01T12:00:00Z',connectivity:'online'})]));
  const kept=await send(command(crew,'availability',crew,'availability.set',{available:true,base:true}));assert.equal(kept.keptCurrent,true);assert.deepEqual(kept.record,{id:crew,available:false});
  const same=await send(command(crew,'availability',crew,'availability.set',{available:false,base:true}));assert.equal(same.keptCurrent,undefined);
  await assert.rejects(send(command(crew,'availability',owner,'availability.set',{available:true,base:null})),error=>error.code==='42501');
  await assert.rejects(send(command(outsider,'availability',outsider,'availability.set',{available:true,base:null})),error=>error.code==='42501');
});
test('availability never overwrites a write interleaved at the state-read boundary',async()=>{
  await db.query('insert into public.crew_availability (company_id,user_id,available) values ($1,$2,false)',[company,crew]);
  const original=(await row("select pg_get_functiondef('public.user_sync_state_availability(uuid,uuid,uuid)'::regprocedure) definition")).definition;
  // Deterministic read/write interleaving, not a multi-session lock test. The
  // old implementation calls this before its unconditional write; the fixed
  // implementation calls it only after its conditional mutation, for receipt
  // capture. A change after that read must survive, never be overwritten.
  await db.exec(`create or replace function public.user_sync_state_availability(company uuid, actor uuid, record_uuid uuid)
    returns jsonb language plpgsql volatile set search_path = '' as $$
    declare snapshot jsonb;
    begin
      select jsonb_build_object('id',a.user_id,'available',a.available) into snapshot
        from public.crew_availability a where a.company_id=company and a.user_id=record_uuid;
      if current_setting('fireops.test_availability_interleave',true) is distinct from 'done' then
        perform set_config('fireops.test_availability_interleave','done',true);
        update public.crew_availability set available=true where user_id=actor and company_id=company;
      end if;
      return snapshot;
    end; $$`);
  try{
    await send(command(crew,'availability',crew,'availability.set',{available:false,base:false}));
    assert.equal((await row('select available from public.crew_availability where company_id=$1 and user_id=$2',[company,crew])).available,true);
  }finally{await db.exec(original)}
});
test('availability CAS preserves executor ownership and private helper permissions',async()=>{
  const fn=await row("select pg_get_userbyid(proowner) owner,prosecdef from pg_proc where oid='public.user_sync_apply_availability(uuid,uuid,uuid,text,jsonb)'::regprocedure");
  assert.equal(fn.owner,'fireops_sync_writer');assert.equal(fn.prosecdef,false);
  await assert.rejects(actor(crew,()=>db.query('select public.user_sync_apply_availability($1,$2,$2,$3,$4::jsonb)',[company,crew,'availability.set',JSON.stringify({available:true,base:null})])),error=>error.code==='42501');
});
test('availability handles missing, unchanged, identical and stale bases without recreating removed rows',async()=>{
  for(const current of [null,false,true])for(const base of [null,false,true])for(const available of [false,true]){
    await db.query('delete from public.crew_availability where company_id=$1 and user_id=$2',[company,crew]);
    if(current!==null)await db.query('insert into public.crew_availability (company_id,user_id,available) values ($1,$2,$3)',[company,crew,current]);
    const kept=current!==base&&current!==available;const result=await send(command(crew,'availability',crew,'availability.set',{available,base}));
    assert.equal(result.keptCurrent,kept?true:undefined,JSON.stringify({current,base,available}));const expected=kept?current:available;
    assert.deepEqual(result.record,expected===null?null:{id:crew,available:expected});
  }
});
test('dashboard changes merge per key and later arrivals win',async()=>{
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{resources:true,tasks:true}}));
  const result=await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{tasks:false,greeting:null}}));
  assert.deepEqual(result.record,{id:owner,items:{resources:true,tasks:false}});
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{resources:null}}));assert.deepEqual((await state(owner,'dashboard',owner)).record.items,{tasks:false});
  await assert.rejects(send(command(owner,'dashboard',crew,'dashboard.set',{changes:{a:1}})),error=>error.code==='42501');
  await assert.rejects(send(command(owner,'dashboard',owner,'dashboard.set',{changes:{}})),error=>error.code==='22023');
});
test('command registry has RLS and remains executor-only, including forward repair',async()=>{
  await db.exec('alter table public.user_sync_commands disable row level security;drop policy "sync executors read command registry" on public.user_sync_commands');
  await db.exec(migration('20261128000100_user_sync_availability_cas'));
  assert.equal((await row("select relrowsecurity from pg_class where oid='public.user_sync_commands'::regclass")).relrowsecurity,true);
  await assert.rejects(actor(owner,()=>db.query('select * from public.user_sync_commands')),error=>error.code==='42501');
  assert.equal((await actor(owner,()=>row('select count(*)::int count from public.user_sync_commands'),'fireops_sync_writer')).count,4);
});
test('receipts are private, and unsupported commands or forged provenance are refused',async()=>{
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{greeting:false}}));
  await assert.rejects(actor(owner,()=>db.query('select * from public.user_sync_receipts')),error=>error.code==='42501');
  await assert.rejects(send(command(owner,'personal_task',randomUUID(),'task.update',task())),error=>error.code==='22023');
  const forged=command(owner,'dashboard',owner,'dashboard.set',{changes:{greeting:false}});await assert.rejects(send(forged,crew),error=>error.code==='22023');
});
