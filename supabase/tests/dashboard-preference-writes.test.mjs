import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadUserSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const user='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002',company='10000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(id,action,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[id??'',role]);await db.exec(`set local role ${role}`);const result=await action();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const request=changes=>({schemaVersion:1,requestId:randomUUID(),userId:user,changes,savedAt:'2026-01-01T12:00:00.000Z',connectivity:'online'});
const send=(body,id=user)=>actor(id,async()=>(await row('select public.set_dashboard_preferences_once($1::jsonb) result',[JSON.stringify(body)])).result);
const read=(id=user)=>actor(id,async()=>(await row('select public.get_dashboard_preferences() result')).result);
before(async()=>{await loadUserSyncSchema(db);await db.exec(migration('20270113000100_dashboard_incident_map'))});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1)',[company]);await db.query('insert into public.profiles values($1,$2),($3,$4)',[user,'User',other,'Other']);
  await db.query('insert into public.company_members values($1,$2,$3)',[company,user,'owner']);
});
after(async()=>{await db.close()});

test('migration fences legacy writers parent-first before ACL changes (structural, not multi-session)',()=>{
  const sql=migration('20261130000100_online_dashboard_preferences');
  const parent=sql.indexOf('lock table public.profiles in share row exclusive mode');const child=sql.indexOf('lock table public.dashboard_preferences in share row exclusive mode');const revoke=sql.indexOf('revoke insert, update, delete on public.dashboard_preferences');
  assert.ok(parent>=0&&parent<child&&child<revoke);
});
test('independent online patches and native commands preserve unrelated layout choices',async()=>{
  const first=request({greeting:false});const original=await send(first);
  const native={schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'dashboard',entityId:user,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'dashboard.set',payload:{changes:{tasks:false}}}};
  await actor(user,()=>db.query('select public.sync_user_command($1::jsonb)',[JSON.stringify(native)]));
  await send(request({resources:false}));assert.deepEqual((await read()).items,{greeting:false,tasks:false,resources:false});
  assert.deepEqual(await send(first),original);assert.deepEqual((await read()).items,{greeting:false,tasks:false,resources:false});
  const audit=await row('select request,previous_items,result,received_at from public.dashboard_preference_receipts where request_id=$1',[first.requestId]);
  assert.deepEqual(audit.request,first);assert.deepEqual(audit.previous_items,{});assert.deepEqual(audit.result,original);assert.ok(audit.received_at);
});
test('incident map and shop quick action can be hidden and restored',async()=>{
  await send(request({incidentMap:false,shop:false}));assert.deepEqual((await read()).items,{incidentMap:false,shop:false});
  await send(request({incidentMap:null}));assert.deepEqual((await read()).items,{shop:false});
  const every=Object.fromEntries(['greeting','incidents','personnel','resources','attention','currentIssues','currentPicture','incidentMap','availability','tasks','inspections','shop','inventory','payroll','receipts','invoices','nationalFireActivity','recentActivity'].map(key=>[key,true]));
  await send(request(every));assert.equal(Object.keys((await read()).items).length,18);
  await assert.rejects(send(request({...every,unknown:true})),error=>error.code==='22023');
});
test('later choices win per key, removals are explicit, and old receipts cannot replay their write',async()=>{
  await send(request({greeting:false,tasks:false}));const old=request({greeting:true});const receipt=await send(old);
  await send(request({greeting:false,resources:false}));assert.deepEqual(await send(old),receipt);assert.equal((await read()).items.greeting,false);
  const removal=request({tasks:null});await send(removal);assert.deepEqual((await read()).items,{greeting:false,resources:false});
  assert.deepEqual((await row('select previous_items from public.dashboard_preference_receipts where request_id=$1',[removal.requestId])).previous_items,{greeting:false,tasks:false,resources:false});
});
test('patches preserve legacy stored keys without accepting untyped new changes',async()=>{
  await db.query('insert into public.dashboard_preferences(user_id,items) values($1,$2::jsonb)',[user,JSON.stringify({legacy:{value:'kept'},tasks:true})]);
  await send(request({tasks:false}));assert.deepEqual((await read()).items,{legacy:{value:'kept'},tasks:false});
  for(const changes of [{},{unknown:false},{tasks:{visible:false}},{tasks:'false'},[],null])await assert.rejects(send(request(changes)),error=>error.code==='22023');
});
test('identity, original body, reported metadata and private receipts remain scoped',async()=>{
  const body=request({tasks:false});await send(body);
  await assert.rejects(send({...body,changes:{tasks:true}}),error=>error.code==='22023');
  await assert.rejects(send({...body,savedAt:'2026-01-02T00:00:00Z'}),error=>error.code==='22023');
  await assert.rejects(send(body,other),error=>error.code==='42501');
  assert.deepEqual(await read(other),{userId:other,items:{}});
  await assert.rejects(actor(user,()=>db.query('select * from public.dashboard_preference_receipts')),error=>error.code==='42501');
  await assert.rejects(db.query("update public.dashboard_preference_receipts set previous_items='{}' where request_id=$1",[body.requestId]),error=>error.code==='42501');
  await assert.rejects(db.query('delete from public.dashboard_preference_receipts where request_id=$1',[body.requestId]),error=>error.code==='42501');
  for(const changed of [{schemaVersion:2},{extra:true},{connectivity:'fabricated'},{savedAt:'yesterday'}])await assert.rejects(send({...request({tasks:true}),...changed}),error=>error.code==='22023');
});
test('direct whole-layout mutations are denied while executor is non-bypass and does not own the table',async()=>{
  await send(request({tasks:false}));
  for(const role of ['authenticated','service_role'])for(const sql of ["insert into public.dashboard_preferences(user_id,items) values($1,'{}')","update public.dashboard_preferences set items='{}' where user_id=$1",'delete from public.dashboard_preferences where user_id=$1'])await assert.rejects(actor(user,()=>db.query(sql,[user]),role),error=>error.code==='42501');
  const ownership=await row("select pg_get_userbyid(c.relowner) table_owner,r.rolbypassrls from pg_class c join pg_roles r on r.rolname='fireops_sync_writer' where c.oid='public.dashboard_preferences'::regclass");
  assert.notEqual(ownership.table_owner,'fireops_sync_writer');assert.equal(ownership.rolbypassrls,false);
});
test('receipt failure rolls back preferences and retry uses exactly the same request',async()=>{
  await send(request({tasks:false}));const body=request({greeting:false});
  await db.exec("create function public.sync_test_fail_dashboard_receipt() returns trigger language plpgsql as $$ begin raise exception 'Receipt storage failed'; end; $$;create trigger sync_test_fail_dashboard_receipt before insert on public.dashboard_preference_receipts for each row execute function public.sync_test_fail_dashboard_receipt()");
  try{await assert.rejects(send(body),/Receipt storage failed/);assert.deepEqual((await read()).items,{tasks:false});assert.equal(await row('select request_id from public.dashboard_preference_receipts where request_id=$1',[body.requestId]),undefined)}
  finally{await db.exec('drop trigger sync_test_fail_dashboard_receipt on public.dashboard_preference_receipts;drop function public.sync_test_fail_dashboard_receipt()')}
  await send(body);assert.deepEqual((await read()).items,{tasks:false,greeting:false});
});
test('global preferences require authenticated current profile, not company membership, and account purge removes private history',async()=>{
  const body={...request({greeting:false}),userId:other};await send(body,other);assert.equal((await read(other)).items.greeting,false);
  await db.query('delete from public.profiles where user_id=$1',[other]);assert.equal(await row('select request_id from public.dashboard_preference_receipts where user_id=$1',[other]),undefined);
  await assert.rejects(send(body,other),error=>error.code==='42501');await assert.rejects(read(null),error=>error.code==='42501');
});
