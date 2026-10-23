import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadUserSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',admin='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000004';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(id,action,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[id??'',role]);await db.exec(`set local role ${role}`);const result=await action();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const request=(changes={})=>({schemaVersion:1,requestId:randomUUID(),companyId:company,actorId:owner,userId:crew,available:true,base:null,savedAt:'2026-01-01T12:00:00.000Z',connectivity:'online',...changes});
const send=(body,id=body.actorId)=>actor(id,async()=>(await row('select public.set_crew_availability_once($1::jsonb) result',[JSON.stringify(body)])).result);
const read=(id=owner,tenant=company)=>actor(id,async()=>(await row('select public.get_crew_availability($1) result',[tenant])).result);
before(async()=>{await loadUserSyncSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,otherCompany]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew',admin,'Admin',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',admin,'admin',otherCompany,outsider]);
});
after(async()=>{await db.close()});

test('online CAS covers missing/boolean bases, keeps changed values and never recreates removed status from a non-null base',async()=>{
  for(const current of [null,false,true])for(const base of [null,false,true])for(const available of [false,true]){
    await db.query('delete from public.crew_availability where company_id=$1 and user_id=$2',[company,crew]);
    if(current!==null)await db.query('insert into public.crew_availability(company_id,user_id,available) values($1,$2,$3)',[company,crew,current]);
    const body=request({available,base});const result=await send(body);const kept=current!==base&&current!==available;
    assert.equal(result.kind,kept?'kept_current':'applied');assert.equal(result.available,kept?current:available);assert.equal(result.userId,crew);assert.equal(result.actorId,owner);assert.equal(result.requestId,body.requestId);
    assert.equal((await row('select previous_available from public.crew_availability_receipts where request_id=$1',[body.requestId])).previous_available,current);
  }
});
test('exact retry returns historical outcome without reapplying over a later change; full request/provenance stays immutable',async()=>{
  const first=request();const receipt=await send(first);await send(request({available:false,base:true}));
  assert.deepEqual(await send(first),receipt);assert.equal((await read()).statuses[crew],false);
  assert.deepEqual((await row('select request from public.crew_availability_receipts where request_id=$1',[first.requestId])).request,first);
  await assert.rejects(send({...first,available:false}),error=>error.code==='22023');await assert.rejects(send({...first,savedAt:'2026-01-02T00:00:00Z'}),error=>error.code==='22023');
});
test('own crew writes and admin crew edits work, but other crew/foreign company/forged actors fail',async()=>{
  await send(request({actorId:crew}));await send(request({actorId:admin,available:false,base:true}));assert.equal((await read(crew)).statuses[crew],false);
  for(const [body,id] of [[request({actorId:crew,userId:owner}),crew],[request({actorId:outsider}),outsider],[request(),crew],[request({userId:outsider}),owner]])await assert.rejects(send(body,id),error=>error.code==='42501');
  await assert.rejects(read(owner,otherCompany),error=>error.code==='42501');await assert.rejects(read(null),error=>error.code==='42501');
});
test('cached replay rechecks current writer role and membership; permission loss is not a fabricated empty roster',async()=>{
  const body=request();await send(body);await db.query("update public.company_members set role='fire_fighter' where company_id=$1 and user_id=$2",[company,owner]);await assert.rejects(send(body),error=>error.code==='42501');
  await db.query("update public.company_members set role='owner' where company_id=$1 and user_id=$2",[company,owner]);await db.query('delete from public.company_members where company_id=$1 and user_id=$2',[company,crew]);await assert.rejects(send(body),error=>error.code==='42501');
  await db.query('delete from public.company_members where company_id=$1 and user_id=$2',[company,owner]);await assert.rejects(read(),error=>error.code==='42501');
});
test('native own commands and online owner edits share CAS semantics without direct table write privileges',async()=>{
  await send(request());
  const native={schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'availability',entityId:crew,provenance:{userId:crew,deviceId:'phone',savedAt:'2026-01-01T12:00:00Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'availability.set',payload:{available:false,base:true}}};
  await actor(crew,()=>db.query('select public.sync_user_command($1::jsonb)',[JSON.stringify(native)]));const stale=await send(request({base:true,available:true}));assert.equal(stale.kind,'kept_current');assert.equal(stale.available,false);
  for(const role of ['authenticated','service_role'])for(const sql of ['insert into public.crew_availability(company_id,user_id,available) values($1,$2,true)','update public.crew_availability set available=true where company_id=$1 and user_id=$2','delete from public.crew_availability where company_id=$1 and user_id=$2'])await assert.rejects(actor(owner,()=>db.query(sql,[company,crew]),role),error=>error.code==='42501');
});
test('audit insertion failure rolls back mutation and can retry exact original request',async()=>{
  const body=request();await db.exec("create function public.sync_test_fail_availability_receipt() returns trigger language plpgsql as $$ begin raise exception 'Receipt storage failed'; end; $$;create trigger sync_test_fail_availability_receipt before insert on public.crew_availability_receipts for each row execute function public.sync_test_fail_availability_receipt()");
  try{await assert.rejects(send(body),/Receipt storage failed/);assert.deepEqual((await read()).statuses,{});assert.equal(await row('select request_id from public.crew_availability_receipts where request_id=$1',[body.requestId]),undefined)}
  finally{await db.exec('drop trigger sync_test_fail_availability_receipt on public.crew_availability_receipts;drop function public.sync_test_fail_availability_receipt()')}
  await send(body);assert.equal((await read()).statuses[crew],true);
});
test('private receipts cannot be read or rewritten by clients and remain until company purge',async()=>{
  const body=request();await send(body);await assert.rejects(actor(owner,()=>db.query('select * from public.crew_availability_receipts')),error=>error.code==='42501');
  await assert.rejects(db.query('delete from public.crew_availability_receipts where request_id=$1',[body.requestId]),error=>error.code==='42501');
  await assert.rejects(db.query('update public.crew_availability_receipts set previous_available=false where request_id=$1',[body.requestId]),error=>error.code==='42501');
  await db.query('delete from public.companies where id=$1',[company]);assert.equal(await row('select request_id from public.crew_availability_receipts where request_id=$1',[body.requestId]),undefined);
});
test('malformed values/envelopes fail, migration locks parent before child, executor remains non-bypass',async()=>{
  for(const changes of [{available:null},{base:'false'},{extra:true},{schemaVersion:2},{savedAt:'yesterday'},{connectivity:'fabricated'}])await assert.rejects(send(request(changes)),error=>error.code==='22023');
  const sql=migration('20261201000100_online_crew_availability');assert.ok(sql.indexOf('lock table public.companies')<sql.indexOf('lock table public.company_members'));assert.ok(sql.indexOf('lock table public.company_members')<sql.indexOf('lock table public.crew_availability '));
  const roles=await row("select pg_get_userbyid(c.relowner) table_owner,r.rolbypassrls from pg_class c join pg_roles r on r.rolname='fireops_sync_writer' where c.oid='public.crew_availability'::regclass");assert.notEqual(roles.table_owner,'fireops_sync_writer');assert.equal(roles.rolbypassrls,false);
});
