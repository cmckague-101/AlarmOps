import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadUserSyncSchema} from './fixtures/fleet-sync-harness.mjs';
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
before(async()=>{await loadUserSyncSchema(db)});
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
  await actor(owner,()=>db.query('update public.crew_availability set available=false where user_id=$1',[crew]));
  const kept=await send(command(crew,'availability',crew,'availability.set',{available:true,base:true}));assert.equal(kept.keptCurrent,true);assert.deepEqual(kept.record,{id:crew,available:false});
  const same=await send(command(crew,'availability',crew,'availability.set',{available:false,base:true}));assert.equal(same.keptCurrent,undefined);
  await assert.rejects(send(command(crew,'availability',owner,'availability.set',{available:true,base:null})),error=>error.code==='42501');
  await assert.rejects(send(command(outsider,'availability',outsider,'availability.set',{available:true,base:null})),error=>error.code==='42501');
});
test('dashboard changes merge per key and later arrivals win',async()=>{
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{fleet:{visible:true},tasks:{visible:true}}}));
  const result=await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{tasks:{visible:false},weather:null}}));
  assert.deepEqual(result.record,{id:owner,items:{fleet:{visible:true},tasks:{visible:false}}});
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{fleet:null}}));assert.deepEqual((await state(owner,'dashboard',owner)).record.items,{tasks:{visible:false}});
  await assert.rejects(send(command(owner,'dashboard',crew,'dashboard.set',{changes:{a:1}})),error=>error.code==='42501');
  await assert.rejects(send(command(owner,'dashboard',owner,'dashboard.set',{changes:{}})),error=>error.code==='22023');
});
test('receipts are private, and unsupported commands or forged provenance are refused',async()=>{
  await send(command(owner,'dashboard',owner,'dashboard.set',{changes:{a:1}}));
  await assert.rejects(actor(owner,()=>db.query('select * from public.user_sync_receipts')),error=>error.code==='42501');
  await assert.rejects(send(command(owner,'personal_task',randomUUID(),'task.update',task())),error=>error.code==='22023');
  const forged=command(owner,'dashboard',owner,'dashboard.set',{changes:{a:1}});await assert.rejects(send(forged,crew),error=>error.code==='22023');
});
