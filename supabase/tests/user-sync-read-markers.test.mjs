import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadReadMarkerSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline read markers: own rows only, forward-only, never marking unseen replies.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,entityType,entityId,cmd,payload,companyId=company){
  return {schemaVersion:1,operationId:randomUUID(),companyId,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const state=(user,entity,id)=>actor(user,async()=>(await row('select public.get_user_sync_state($1,$2,$3) result',[company,entity,id])).result);
async function notification(user=crew,companyId=company,readAt=null){
  return (await row(`insert into public.user_notifications(company_id,user_id,event_type,entity_type,title,body,path,group_key,dedupe_key,read_at)
    values($1,$2,'system','system','Title','Body','/x','g',$3,$4) returning id`,[companyId,user,randomUUID(),readAt])).id;
}
async function thread(createdAt='2026-01-01T10:00:00Z'){
  const id=randomUUID();
  await db.exec('alter table public.communication_threads disable trigger communication_threads_attribution');
  await db.query("insert into public.communication_threads(id,company_id,subject,description,created_by,created_by_name,created_by_role,created_at) values($1,$2,'Subject','Body',$3,'Owner','owner',$4)",[id,company,owner,createdAt]);
  await db.exec('alter table public.communication_threads enable trigger communication_threads_attribution');
  return id;
}
const readAt=async id=>(await row('select read_at from public.user_notifications where id=$1',[id])).read_at;
const seenAt=async(id,user=crew)=>(await row('select seen_at from public.communication_reads where thread_id=$1 and user_id=$2',[id,user]))?.seen_at;
before(async()=>{await loadReadMarkerSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$3)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('marks own notifications read once and replays the same receipt',async()=>{
  const id=await notification();const op=command(crew,'notification',id,'notification.read',{});
  const result=await send(op);assert.equal(result.kind,'applied');assert.equal(result.record.id,id);assert.ok(result.record.readAt);
  const first=await readAt(id);assert.deepEqual(await send(op),result);
  await send(command(crew,'notification',id,'notification.read',{}));assert.deepEqual(await readAt(id),first);
  assert.equal((await state(crew,'notification',id)).record.readAt,result.record.readAt);
});
test('never touches other users notifications or reveals them',async()=>{
  const theirs=await notification(owner);const result=await send(command(crew,'notification',theirs,'notification.read',{}));
  assert.equal(result.record,null);assert.equal(await readAt(theirs),null);assert.equal((await state(crew,'notification',theirs)).record,null);
  const missing=await send(command(crew,'notification',randomUUID(),'notification.read',{}));assert.equal(missing.record,null);
  await assert.rejects(send(command(crew,'notification',await notification(),'notification.read',{at:'now'})),error=>error.code==='22023');
  await assert.rejects(send(command(crew,'notification',await notification(crew,other),'notification.read',{},other)),error=>error.code==='42501');
});
test('raises thread seen markers to what the device displayed, never past later replies',async()=>{
  const id=await thread();const shown='2026-01-01T11:00:00.000Z';
  const result=await send(command(crew,'communication_read',id,'communication.seen',{seenThrough:shown}));
  assert.equal(new Date(result.record.seenAt).toISOString(),shown);assert.equal((await seenAt(id)).toISOString(),shown);
  // A later online read moved it forward; an older offline marker cannot pull it back.
  await db.query("update public.communication_reads set seen_at='2026-01-01T13:00:00Z' where thread_id=$1",[id]);
  await send(command(crew,'communication_read',id,'communication.seen',{seenThrough:'2026-01-01T12:00:00Z'}));
  assert.equal((await seenAt(id)).toISOString(),'2026-01-01T13:00:00.000Z');
  // Future device claims are clamped to server receipt time.
  const future=await thread();await send(command(crew,'communication_read',future,'communication.seen',{seenThrough:'2999-01-01T00:00:00Z'}));
  assert.ok((await seenAt(future)).getTime()<=Date.now());
});
test('deleted or foreign threads are no-ops and payloads are validated',async()=>{
  const gone=randomUUID();const result=await send(command(crew,'communication_read',gone,'communication.seen',{seenThrough:'2026-01-01T11:00:00Z'}));
  assert.equal(result.record,null);assert.equal((await row('select count(*)::int count from public.communication_reads')).count,0);
  const id=await thread();
  for(const payload of [{},{seenThrough:'yesterday'},{seenThrough:1},{seenThrough:'2026-01-01T11:00:00Z',extra:true}])
    await assert.rejects(send(command(crew,'communication_read',id,'communication.seen',payload)),error=>error.code==='22023',JSON.stringify(payload));
  await assert.rejects(send(command(outsider,'communication_read',id,'communication.seen',{seenThrough:'2026-01-01T11:00:00Z'})),error=>error.code==='42501');
  assert.equal(await seenAt(id,outsider),undefined);
});
test('sync executor functions are not callable by clients',async()=>{
  for(const sql of ["select public.user_sync_apply_notification($1,$2,$3,'notification.read','{}')","select public.user_sync_state_communication_read($1,$2,$3)"])
    await assert.rejects(actor(crew,()=>db.query(sql,[company,crew,randomUUID()])),error=>error.code==='42501');
});
