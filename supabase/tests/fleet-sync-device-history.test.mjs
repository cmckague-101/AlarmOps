import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003',id='30000000-0000-4000-8000-000000000001';
const base={id,unit:'E1',notes:'Base',status:'Ready'};
const present=value=>({present:true,value});
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function operation(record,revision,notes,dependsOn=[]){return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:id,provenance:{userId:owner,deviceId:'device',savedAt:'2026-01-01T12:00:00Z',connectivity:'offline'},dependsOn,mutation:{kind:'update',baseRevision:revision,base:record,patch:{notes:present(notes)}}}}
const sync=op=>actor(owner,async()=>(await row('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)])).result);
const submit=(op,history,user=owner)=>actor(user,async()=>(await row('select public.sync_fleet_update_with_history($1::jsonb,$2::jsonb) result',[JSON.stringify(op),JSON.stringify(history)])).result);
async function fixture(){
  const parent=operation(base,'1','Parent');const applied=await sync(parent);
  const staged=operation({...base,notes:'Parent'},'1','Later',[parent.operationId]);
  const wire={...staged,mutation:{...staged.mutation,baseRevision:applied.revision,base:applied.record}};
  const history=[{before:staged,after:wire,reason:'automatic_independent',createdAt:'2026-01-01T12:05:00Z'}];return {parent,staged,wire,history};
}
before(async()=>{await loadFleetSyncSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1),($2)',[company,other]);await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$3)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:id,data:base}])]));
});
after(async()=>{await db.close()});
test('stores original local versions atomically with the verified child and replays without extra effects',async()=>{
  const f=await fixture();const result=await submit(f.wire,f.history);assert.equal(result.kind,'applied');assert.equal(result.record.notes,'Later');
  const stored=await row('select * from public.fleet_sync_device_history');assert.deepEqual(stored.device_history,f.history);assert.equal(stored.actor_user_id,owner);assert.equal(stored.actor_name,'Owner');
  const effects=await row('select count(*)::int count from public.sync_test_effects');assert.deepEqual(await submit(f.wire,f.history),result);assert.deepEqual(await row('select count(*)::int count from public.sync_test_effects'),effects);
});
test('stores history for review-pending submissions as well as applied ones',async()=>{
  const f=await fixture();await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:id,expectedVersion:2,data:{...base,notes:'Other editor'}}]) ]));
  const result=await submit(f.wire,f.history);assert.equal(result.kind,'awaiting_review');assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,1);
});
test('explicitly keeping current preserves discarded saved values without rewriting shared data',async()=>{
  const f=await fixture();f.wire={...f.wire,dependsOn:[],mutation:{...f.wire.mutation,patch:{}}};f.history=[{before:f.staged,after:f.wire,reason:'explicit:{"notes":"current"}',createdAt:'2026-01-01T12:06:00Z'}];
  const result=await submit(f.wire,f.history);assert.equal(result.revision,'2');assert.equal(result.record.notes,'Parent');assert.equal((await row('select device_history from public.fleet_sync_device_history')).device_history[0].before.mutation.patch.notes.value,'Later');
});
test('rejects changed history for a previously submitted operation',async()=>{
  const f=await fixture();await submit(f.wire,f.history);const changed=structuredClone(f.history);changed[0].createdAt='2026-01-02T12:00:00Z';
  await assert.rejects(submit(f.wire,changed),/history changed/i);assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,1);
});
test('rejects forged identity, scope, dependency, final body and choice claims before applying data',async()=>{
  for(const change of [h=>h[0].before.provenance.userId=outsider,h=>h[0].before.companyId=other,h=>h[0].before.dependsOn=[randomUUID()],h=>h[0].after.mutation.patch.notes.value='Not posted',h=>h[0].reason='explicit:{"notes":"current"}',h=>h[0].reason='server_approved']){
    const f=await fixture();const invalid=structuredClone(f.history);change(invalid);await assert.rejects(submit(f.wire,invalid));
    assert.equal((await row('select data from public.fleet_vehicles where record_id=$1',[id])).data.notes,'Parent');
  }
  assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,0);
});
test('history storage failure rolls back business data, receipt and side effects',async()=>{
  const f=await fixture();await db.exec("create function public.fail_history_test() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$; create trigger fail_history_test before insert on public.fleet_sync_device_history for each row execute function public.fail_history_test()");
  try{await assert.rejects(submit(f.wire,f.history),/audit unavailable/);assert.equal((await row('select data from public.fleet_vehicles where record_id=$1',[id])).data.notes,'Parent');assert.equal((await row('select count(*)::int count from public.fleet_sync_submissions where operation_id=$1',[f.wire.operationId])).count,0)}
  finally{await db.exec('drop trigger fail_history_test on public.fleet_sync_device_history;drop function public.fail_history_test()')}
});
test('history reads are manager/company scoped; ordinary callers cannot forge or alter audit rows',async()=>{
  const f=await fixture();await submit(f.wire,f.history);
  assert.equal((await actor(crew,()=>db.query('select * from public.fleet_sync_device_history'))).rows.length,0);assert.equal((await actor(outsider,()=>db.query('select * from public.fleet_sync_device_history'))).rows.length,0);
  await assert.rejects(actor(owner,()=>db.query("update public.fleet_sync_device_history set actor_name='Forged'")),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('delete from public.fleet_sync_device_history')),error=>error.code==='42501');
  await assert.rejects(submit(f.wire,f.history,crew),error=>error.code==='42501');await assert.rejects(submit(f.wire,f.history,outsider),error=>error.code==='42501');
});
const backfill=(op,history,user=owner)=>actor(user,async()=>(await row('select public.backfill_fleet_sync_device_history($1::jsonb,$2::jsonb) result',[JSON.stringify(op),JSON.stringify(history)])).result);
test('older-build recovery backs up known submissions without repeating business writes',async()=>{
  const f=await fixture();const receipt=await sync(f.wire);const effects=await row('select count(*)::int count from public.sync_test_effects');
  assert.deepEqual(await backfill(f.wire,f.history),receipt);assert.deepEqual(await backfill(f.wire,f.history),receipt);assert.deepEqual(await row('select count(*)::int count from public.sync_test_effects'),effects);assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,1);
});
test('history recovery never overwrites newer shared data with its historical receipt',async()=>{
  const f=await fixture();const receipt=await sync(f.wire);await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:id,expectedVersion:3,data:{...base,notes:'Newer shared note'}}])]));
  assert.deepEqual(await backfill(f.wire,f.history),receipt);assert.equal((await row('select data from public.fleet_vehicles where record_id=$1',[id])).data.notes,'Newer shared note');
});
test('history recovery preserves an existing pending review without duplicate conflicts',async()=>{
  const f=await fixture();await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:id,expectedVersion:2,data:{...base,notes:'Other editor'}}])]));const receipt=await sync(f.wire);assert.equal(receipt.kind,'awaiting_review');assert.deepEqual(await backfill(f.wire,f.history),receipt);assert.equal((await row('select count(*)::int count from public.fleet_sync_conflicts')).count,1);
});
test('unknown original submissions are never applied by history recovery',async()=>{
  const f=await fixture();const effects=await row('select count(*)::int count from public.sync_test_effects');await assert.rejects(backfill(f.wire,f.history),error=>error.code==='55000');assert.deepEqual(await row('select count(*)::int count from public.sync_test_effects'),effects);assert.equal((await row('select data from public.fleet_vehicles where record_id=$1',[id])).data.notes,'Parent');assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,0);
});
test('recovery rejects changed payloads and revoked/foreign actors',async()=>{
  const f=await fixture();await sync(f.wire);await assert.rejects(backfill({...f.wire,provenance:{...f.wire.provenance,deviceId:'different'}},f.history),error=>error.code==='22023');
  for(const user of [crew,outsider,null])await assert.rejects(backfill(f.wire,f.history,user),error=>error.code==='42501');
  await db.query("update public.company_members set role='admin' where user_id=$1",[crew]);await assert.rejects(backfill(f.wire,f.history,crew),error=>error.code==='22023');
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);await assert.rejects(backfill(f.wire,f.history),error=>error.code==='42501');
});
test('recovering history for an already-deleted record cannot resurrect it',async()=>{
  const f=await fixture();const receipt=await sync(f.wire);await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:id,expectedVersion:3}])]));
  assert.deepEqual(await backfill(f.wire,f.history),receipt);assert.equal((await row('select count(*)::int count from public.fleet_vehicles')).count,0);assert.equal((await row('select count(*)::int count from public.fleet_sync_device_history')).count,1);
});
const download=(token=null,cursor=null,user=owner)=>actor(user,async()=>(await row('select public.download_fleet_sync_page($1,$2,$3::jsonb) result',[company,token,cursor?JSON.stringify(cursor):null])).result);
test('verified inventory pages contain current raw records and ledger-proven tombstones only',async()=>{
  const first=await download();assert.equal(first.total,1);assert.equal(first.vehicles,1);assert.equal(first.issues,0);assert.match(first.snapshotToken,/^[0-9a-f]{64}$/);assert.deepEqual(first.records,[{entityType:'vehicle',entityId:id,revision:'1',record:base}]);assert.equal(first.nextCursor,null);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:id,expectedVersion:1}])]));
  const deleted=await download();assert.equal(deleted.total,1);assert.equal(deleted.vehicles,0);assert.equal(deleted.records[0].record,null);assert.equal(deleted.records[0].revision,'2');assert.notEqual(deleted.snapshotToken,first.snapshotToken);
});
test('inventory covers both allowed entity types and excludes foreign-company records',async()=>{
  const issue={id,vehicleId:id,title:'Issue',description:'Details',priority:'Medium',status:'Open',createdById:owner,updates:[]};
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'issues',event:'insert',recordId:id,data:issue}])]));
  await actor(outsider,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[other,JSON.stringify([{collection:'vehicles',event:'insert',recordId:id,data:{...base,notes:'Other company secret'}}])]));
  const result=await download();assert.equal(result.total,2);assert.equal(result.issues,1);assert.deepEqual(result.records.map(item=>item.entityType),['issue','vehicle']);assert.deepEqual(result.records[0].record,issue);assert.equal(JSON.stringify(result).includes('Other company secret'),false);
});
test('bulk inventory pages are fenced against inserts behind the cursor and ABA field changes',async()=>{
  const changes=Array.from({length:26},(_,i)=>{const recordId=`30000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`;return {collection:'vehicles',event:'insert',recordId,data:{...base,id:recordId}}});
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify(changes)]));const first=await download();assert.equal(first.records.length,25);assert.ok(first.nextCursor);const last=await download(first.snapshotToken,first.nextCursor);assert.equal(last.records.length,2);assert.equal(last.nextCursor,null);
  const earlier='30000000-0000-4000-8000-000000000000';await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:earlier,data:{...base,id:earlier}}])]));await assert.rejects(download(first.snapshotToken,first.nextCursor),error=>error.code==='PT409');
  const next=await download();await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:id,expectedVersion:1,data:{...base,notes:'Changed'}}])]));await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'update',recordId:id,expectedVersion:2,data:base}])]));await assert.rejects(download(next.snapshotToken,next.nextCursor),error=>error.code==='PT409');
});
test('bulk downloads enforce current manager scope and do not export other fleet workflows',async()=>{
  for(const user of [crew,outsider,null])await assert.rejects(download(null,null,user),error=>error.code==='42501');
  const first=await download();await actor(owner,()=>db.query('insert into public.fleet_crew(company_id,record_id,data,updated_by) values($1,$2,$3::jsonb,$4)',[company,id,JSON.stringify({id,name:'Private crew data'}),owner]));const next=await download();assert.equal(next.snapshotToken,first.snapshotToken);assert.equal(JSON.stringify(next).includes('Private crew data'),false);
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);await assert.rejects(download(),error=>error.code==='42501');
});
test('a row hidden by RLS cannot become a fabricated deletion or verified base',async()=>{
  await db.exec('create policy hide_download_test on public.fleet_vehicles as restrictive for select to authenticated using(false)');
  try{await assert.rejects(download(),error=>error.code==='42501')}finally{await db.exec('drop policy hide_download_test on public.fleet_vehicles')}
  assert.equal((await row('select count(*)::int count from public.fleet_vehicles')).count,1);
});
test('empty authorized inventories are valid but untracked live records are not',async()=>{
  const empty=await actor(outsider,async()=>(await row('select public.download_fleet_sync_page($1) result',[other])).result);assert.equal(empty.total,0);assert.deepEqual(empty.records,[]);assert.equal(empty.nextCursor,null);
  await db.exec('alter table public.fleet_vehicles disable trigger user');const untracked='30000000-0000-4000-8000-000000000099';
  try{await db.query('insert into public.fleet_vehicles(company_id,record_id,data,updated_by) values($1,$2,$3::jsonb,$4)',[company,untracked,JSON.stringify({...base,id:untracked}),owner])}finally{await db.exec('alter table public.fleet_vehicles enable trigger user')}
  await assert.rejects(download(),error=>error.code==='42501');
});
test('bulk download rejects cursors without a snapshot and detects inconsistent ledger fingerprints',async()=>{
  await assert.rejects(download(null,{entityType:'vehicle',entityId:id}),error=>error.code==='22023');
  await db.exec('alter table public.fleet_vehicles disable trigger user');await db.query('update public.fleet_vehicles set data=$1::jsonb',[JSON.stringify({...base,notes:'Untracked'})]);await db.exec('alter table public.fleet_vehicles enable trigger user');await assert.rejects(download(),error=>error.code==='42501');
});
const listHistory=(cursor=null,user=owner,target=id)=>actor(user,async()=>(await row('select public.list_fleet_sync_device_history($1,$2,$3,$4::jsonb) result',[company,'vehicle',target,cursor?JSON.stringify(cursor):null])).result);
const readHistory=(operationId,user=owner,target=id)=>actor(user,async()=>(await row('select public.get_fleet_sync_device_history_report($1,$2,$3,$4,$5) result',[company,'vehicle',target,owner,operationId])).result);
test('online history inspection returns scoped summaries and complete original snapshots',async()=>{
  const f=await fixture();await submit(f.wire,f.history);const page=await listHistory();assert.equal(page.items.length,1);assert.equal(page.nextCursor,null);assert.equal(page.items[0].deviceHistory,undefined);
  const report=await readHistory(f.wire.operationId);assert.deepEqual(report.deviceHistory,f.history);assert.equal(report.actorUserId,owner);
  await db.query("update public.company_members set role='admin' where user_id=$1",[crew]);assert.deepEqual(await readHistory(f.wire.operationId,crew),report);
  assert.deepEqual((await listHistory(null,owner,randomUUID())).items,[]);assert.equal(await readHistory(f.wire.operationId,owner,randomUUID()),null);
});
test('read RPCs reject crew, outsiders, anonymous callers and newly demoted managers',async()=>{
  const f=await fixture();await submit(f.wire,f.history);
  for(const user of [crew,outsider,null]){await assert.rejects(listHistory(null,user),error=>error.code==='42501');await assert.rejects(readHistory(f.wire.operationId,user),error=>error.code==='42501')}
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);await assert.rejects(listHistory(),error=>error.code==='42501');await assert.rejects(readHistory(f.wire.operationId),error=>error.code==='42501');
});
test('history remains inspectable after business-record deletion without recreating it',async()=>{
  const f=await fixture();await submit(f.wire,f.history);await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'delete',recordId:id,expectedVersion:3}])]));
  assert.equal((await listHistory()).items.length,1);assert.deepEqual((await readHistory(f.wire.operationId)).deviceHistory,f.history);assert.equal((await row('select count(*)::int count from public.fleet_vehicles')).count,0);
});
test('history keyset pagination handles timestamp ties and concurrent newer insertions',async()=>{
  const f=await fixture();const ids=[];
  async function add(){const staged={...f.staged,operationId:randomUUID()};const wire={...f.wire,operationId:staged.operationId,dependsOn:[],mutation:{...f.wire.mutation,patch:{}}};await submit(wire,[{before:staged,after:wire,reason:'explicit:{"notes":"current"}',createdAt:date}]);ids.push(wire.operationId)}
  const date='2026-01-01T12:06:00Z';for(let i=0;i<21;i++)await add();await db.query("update public.fleet_sync_device_history set received_at='2026-01-01T12:10:00.123456Z'");
  const first=await listHistory();assert.equal(first.items.length,20);assert.ok(first.nextCursor);await add();const second=await listHistory(first.nextCursor);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(item=>item.operationId)).size,21);
});
test('invalid history cursors fail without returning a partial page',async()=>{for(const cursor of [{},{receivedAt:'infinity',actorUserId:owner,operationId:randomUUID()}])await assert.rejects(listHistory(cursor))});
test('unauthenticated calls and replay after manager demotion remain denied',async()=>{
  const f=await fixture();await submit(f.wire,f.history);await assert.rejects(submit(f.wire,f.history,null),error=>error.code==='42501');
  await db.query("update public.company_members set role='fire_fighter' where user_id=$1",[owner]);await assert.rejects(submit(f.wire,f.history),error=>error.code==='42501');
});
