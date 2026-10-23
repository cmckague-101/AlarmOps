import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadPayrollSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline payroll: the creator's draft is created/merged per field and submitted
// through the real protect trigger; submitted or deleted forms are never changed
// or recreated, and the device is told why.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,formId,cmd='form.save',payload={},dependsOn=[]){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'payroll_form',entityId:formId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn,mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const days=(hours=0)=>Array.from({length:21},(_,index)=>({date:index===0?'2026-07-01':'',hoursWorked:index===0?hours:0,crewIds:index===0?[tech]:[],notes:''}));
const form=id=>row('select status,engine_number,incidents,rows,created_by_name,submitted_at from public.payroll_forms where id=$1',[id]);
before(async()=>{await loadPayrollSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.test_notifications');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew Person',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('creates the draft, merges later saves per field and replays without change',async()=>{
  const id=randomUUID();const first=command(crew,id,'form.save',{engineNumber:'E-21',rows:days(8)});const created=await send(first);
  assert.equal(created.notApplied,undefined);assert.equal(created.record.status,'draft');assert.equal(created.record.engineNumber,'E-21');
  const saved=await form(id);assert.equal(saved.created_by_name,'Crew Person');assert.equal(saved.rows[0].hoursWorked,8);
  const second=await send(command(crew,id,'form.save',{incidents:'Oak Fire'},[first.operationId]));
  assert.equal(second.record.engineNumber,'E-21');assert.equal(second.record.incidents,'Oak Fire');assert.equal(second.record.rows[0].hoursWorked,8);
  assert.deepEqual(await send(first),created);assert.equal((await form(id)).incidents,'Oak Fire');
});
test('submits through the trigger, notifies managers, and later saves are kept on the device',async()=>{
  const id=randomUUID();const create=command(crew,id,'form.save',{rows:days(10)});await send(create);
  const submitted=await send(command(crew,id,'form.submit',{},[create.operationId]));
  assert.equal(submitted.notApplied,undefined);assert.equal(submitted.record.status,'pending');assert.ok(submitted.record.submittedAt);
  assert.deepEqual((await db.query('select user_id from public.test_notifications')).rows.map(item=>item.user_id),[owner]);
  const late=await send(command(crew,id,'form.save',{engineNumber:'changed'}));
  assert.equal(late.notApplied,'already_submitted');assert.equal((await form(id)).engine_number,'');
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,undefined);assert.equal((await form(id)).status,'pending');
});
test('a returned form can be revised and sent back; approved forms stay read only',async()=>{
  const id=randomUUID();await send(command(crew,id,'form.save',{rows:days(4)}));await send(command(crew,id,'form.submit'));
  await actor(owner,()=>db.query("update public.payroll_forms set status='rejected',rejection_notes='Fix hours' where id=$1",[id]));
  assert.equal((await send(command(crew,id,'form.save',{rows:days(6)}))).record.status,'rejected');
  assert.equal((await send(command(crew,id,'form.submit'))).record.status,'pending');assert.equal((await form(id)).rows[0].hoursWorked,6);
  await actor(owner,()=>db.query("update public.payroll_forms set status='approved' where id=$1",[id]));
  assert.equal((await send(command(crew,id,'form.save',{rows:days(1)}))).notApplied,'already_submitted');assert.equal((await form(id)).rows[0].hoursWorked,6);
});
test('deleted forms are never recreated; a second draft is refused',async()=>{
  const id=randomUUID();await send(command(crew,id,'form.save',{engineNumber:'E-1'}));
  await actor(crew,()=>db.query('delete from public.payroll_forms where id=$1',[id]));
  const gone=await send(command(crew,id,'form.save',{engineNumber:'E-2'}));assert.equal(gone.notApplied,'form_deleted');assert.equal(gone.record,null);
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,'form_deleted');assert.equal(await form(id),undefined);
  await send(command(crew,randomUUID(),'form.save',{engineNumber:'web draft'}));
  const second=randomUUID();const refused=await send(command(crew,second,'form.save',{engineNumber:'phone draft'}));
  assert.equal(refused.notApplied,'other_draft');assert.equal(await form(second),undefined);
  // A refused create was never on the server, so a retry after the other draft is gone may create it.
  await actor(crew,()=>db.query("delete from public.payroll_forms where created_by=$1",[crew]));
  assert.equal((await send(command(crew,second,'form.save',{engineNumber:'phone draft'}))).notApplied,undefined);
});
test('invalid payloads, foreign forms and reused identities are refused',async()=>{
  const id=randomUUID();
  for(const payload of [{},{status:'approved'},{rows:[]},{engineNumber:1},{rows:days().map((day,index)=>index?day:{...day,hoursWorked:-1})},{rows:days().map((day,index)=>index?day:{...day,crewIds:['x']})},{rows:days().map((day,index)=>index?day:{...day,date:'2026-02-30'})}])
    await assert.rejects(send(command(crew,id,'form.save',payload)),error=>['22023','22008'].includes(error.code),JSON.stringify(payload).slice(0,40));
  await assert.rejects(send(command(crew,id,'form.submit',{note:'x'})),error=>error.code==='22023');
  await send(command(tech,id,'form.save',{engineNumber:'tech'}));
  await assert.rejects(send(command(crew,id,'form.save',{engineNumber:'crew'})),error=>error.code==='23505');
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,'form_deleted');assert.equal((await form(id)).status,'draft');
  await assert.rejects(send(command(outsider,randomUUID(),'form.save',{engineNumber:'x'})),error=>error.code==='42501');
});
