import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema} from './fixtures/fleet-sync-harness.mjs';

const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001';
const admin='20000000-0000-4000-8000-000000000002';
const crew='20000000-0000-4000-8000-000000000003';
const outsider='20000000-0000-4000-8000-000000000004';
const recordId='30000000-0000-4000-8000-000000000001';
const base={id:recordId,unit:'Engine 1',status:'Ready',notes:'Original',vin:'VIN-1'};
const present=value=>({present:true,value});
async function row(sql,params=[]){return (await db.query(sql,params)).rows[0]}
async function asActor(actor,task){
  await db.exec('begin');
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actor??'']);
    await db.exec('set local role authenticated');
    const result=await task();await db.exec('commit');return result;
  }catch(error){await db.exec('rollback');throw error}
}
function operation(patch,{actor=owner,original=base,version='1'}={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:recordId,
    provenance:{userId:actor,deviceId:'offline-device',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],
    mutation:{kind:'update',baseRevision:version,base:original,patch}};
}
async function sync(op,actor=owner){return asActor(actor,async()=>(await row('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(op)])).result)}
async function online(data,version=1,actor=admin){
  return asActor(actor,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([
    {collection:'vehicles',recordId,event:'update',expectedVersion:version,data},
  ])]));
}
async function review(actor=owner,target=company){return asActor(actor,async()=>(await row('select public.get_fleet_sync_review($1,$2,$3) result',[target,'vehicle',recordId])).result)}
function approval(snapshot,choices){return {requestId:randomUUID(),companyId:company,entityType:'vehicle',entityId:recordId,reviewToken:snapshot.reviewToken,choices}}
async function approve(request,actor=owner){return asActor(actor,async()=>(await row('select public.approve_fleet_sync_review($1::jsonb) result',[JSON.stringify(request)])).result)}
async function outcome(operationId,actor=owner,target=company){return asActor(actor,async()=>(await row('select public.get_fleet_sync_outcome($1,$2) result',[target,operationId])).result)}
async function pending(patch={notes:present('Offline')},options={}){
  const op=operation(patch,options);const receipt=await sync(op,options.actor??owner);return {op,receipt};
}
async function stats(){return row(`select (select count(*)::int from public.fleet_sync_decisions) decisions,
  (select count(*)::int from public.fleet_sync_outcomes) outcomes,
  (select count(*)::int from public.fleet_sync_conflicts where state='pending') pending,
  (select count(*)::int from public.fleet_sync_revisions) revisions,
  (select count(*)::int from public.sync_test_effects) effects`)}
before(async()=>{await loadFleetSyncSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values ($1),($2)',[company,otherCompany]);
  await db.query('insert into public.profiles values ($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',admin,'Admin',crew,'Crew',outsider,'Other owner']);
  await db.query('insert into public.company_members values ($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',admin,'admin',crew,'fire_fighter',otherCompany,outsider]);
  await asActor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',recordId,event:'insert',data:base}])]));
});
after(async()=>{await db.close()});

test('fresh review shows every candidate and every changed field, not stale whole-row replacements',async()=>{
  await online({...base,notes:'Online',unit:'Online unit'});
  const first=await pending({notes:present('First'),vin:present('Independent VIN')});
  const second=await pending({notes:present('Second')},{actor:admin});
  const snapshot=await review();
  assert.equal(snapshot.currentRevision,'2');
  assert.equal(snapshot.currentRecord.unit,'Online unit');
  assert.equal(snapshot.candidates.length,2);
  assert.deepEqual(Object.keys(snapshot.fields).sort(),['notes','vin']);
  assert.equal(snapshot.fields.notes.options.length,2);
  assert.deepEqual(snapshot.fields.vin.options.map(option=>option.source),[first.receipt.conflictId]);
  assert.equal(snapshot.fields.notes.options.find(option=>option.source===second.receipt.conflictId).provenance.userId,admin);
  assert.deepEqual((await review()).reviewToken,snapshot.reviewToken);
  assert.equal((await stats()).decisions,0);
});

test('per-field approval preserves unrelated online data, records partial outcomes and keeps all audit candidates',async()=>{
  await online({...base,notes:'Online',unit:'Online unit'});
  const first=await pending({notes:present('First'),vin:present('Offline VIN')});
  const second=await pending({notes:present('Second')},{actor:admin});
  const snapshot=await review();
  const result=await approve(approval(snapshot,{notes:second.receipt.conflictId,vin:first.receipt.conflictId}));
  assert.equal(result.kind,'resolved');assert.equal(result.revision,'3');
  assert.deepEqual(result.record,{...base,notes:'Second',vin:'Offline VIN',unit:'Online unit'});
  assert.equal((await outcome(first.op.operationId)).outcome,'partially_kept');
  assert.deepEqual((await outcome(first.op.operationId)).keptFields,['vin']);
  assert.deepEqual((await outcome(first.op.operationId)).discardedFields,['notes']);
  assert.equal((await outcome(second.op.operationId,admin)).outcome,'kept');
  const audit=await row('select * from public.fleet_sync_decisions');
  assert.equal(audit.reviewer_user_id,owner);assert.equal(audit.reviewer_name,'Owner');
  assert.equal(audit.candidate_ids.length,2);assert.equal(audit.before_record.notes,'Online');assert.equal(audit.after_record.notes,'Second');
  assert.deepEqual(await stats(),{decisions:1,outcomes:2,pending:0,revisions:3,effects:3});
  assert.equal((await row('select count(*)::int count from public.fleet_sync_conflicts')).count,2);
});

test('keeping shared values rejects proposals without rewriting data or emitting another side effect',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();
  const result=await approve(approval(await review(),{notes:'current'}));
  assert.equal(result.revision,'2');assert.equal(result.record.notes,'Online');
  assert.equal((await outcome(candidate.op.operationId)).outcome,'not_selected');
  assert.deepEqual(await stats(),{decisions:1,outcomes:1,pending:0,revisions:2,effects:2});
});

test('original upload receipts are retained while fully kept submissions become applied and can unblock dependencies',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();
  const decision=await approve(approval(await review(),{notes:candidate.receipt.conflictId}));
  const stored=await row('select initial_result,result,applied_revision from public.fleet_sync_submissions');
  assert.deepEqual(stored.initial_result,candidate.receipt);assert.equal(stored.result.kind,'applied');assert.equal(stored.applied_revision,null);
  assert.equal((await sync(candidate.op)).kind,'applied');
  const child=operation({vin:present('After approval')},{original:decision.record,version:decision.revision});
  child.dependsOn=[candidate.op.operationId];assert.equal((await sync(child)).kind,'applied');
});

test('rejected and partially kept dependencies remain blocked until explicitly rebased',async()=>{
  await online({...base,notes:'Online'});
  const rejected=await pending();const partial=await pending({notes:present('Other'),vin:present('Kept VIN')});
  const decision=await approve(approval(await review(),{notes:'current',vin:partial.receipt.conflictId}));
  for(const parent of [rejected,partial]){
    const child=operation({unit:present('Blocked child')},{original:decision.record,version:decision.revision});child.dependsOn=[parent.op.operationId];
    await assert.rejects(sync(child),/dependency has not been applied/);
  }
});

test('approval retries are idempotent and changed work cannot reuse a request ID',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();
  const request=approval(await review(),{notes:candidate.receipt.conflictId});
  const result=await approve(request);assert.deepEqual(await approve(request),result);
  await assert.rejects(approve({...request,choices:{notes:'current'}}),/reused for different work/);
  assert.deepEqual(await stats(),{decisions:1,outcomes:1,pending:0,revisions:3,effects:3});
  await db.query("update public.company_members set role='fire_fighter' where company_id=$1 and user_id=$2",[company,owner]);
  await assert.rejects(approve(request),error=>error.code==='42501');
});

test('a live edit during review rejects stale approval and a refreshed review uses the latest record',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();const old=await review();
  await online({...base,notes:'Latest',unit:'Latest unit'},2);
  await assert.rejects(approve(approval(old,{notes:candidate.receipt.conflictId})),error=>error.code==='PT409');
  const fresh=await review();assert.notEqual(fresh.reviewToken,old.reviewToken);assert.equal(fresh.currentRecord.unit,'Latest unit');
  const result=await approve(approval(fresh,{notes:candidate.receipt.conflictId}));assert.equal(result.record.unit,'Latest unit');
});

test('new competing candidates invalidate an earlier review token',async()=>{
  await online({...base,notes:'Online'});const first=await pending();const old=await review();await pending({notes:present('Later')});
  await assert.rejects(approve(approval(old,{notes:first.receipt.conflictId})),error=>error.code==='PT409');
  assert.deepEqual(await stats(),{decisions:0,outcomes:0,pending:2,revisions:2,effects:2});
});

test('another reviewer cannot approve an already-decided candidate set',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();const snapshot=await review();
  await approve(approval(snapshot,{notes:'current'}));
  await assert.rejects(approve(approval(snapshot,{notes:candidate.receipt.conflictId}),admin),error=>error.code==='PT409');
  assert.equal((await stats()).decisions,1);
});

test('every touched field must have a valid offered source; arbitrary values and unrelated fields are forbidden',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending({notes:present('Offline'),vin:present('VIN-2')});const snapshot=await review();
  for(const choices of [{},{notes:candidate.receipt.conflictId},{notes:'current',vin:'current',status:'current'},
    {notes:randomUUID(),vin:'current'},{notes:{present:true,value:'injected'},vin:'current'}, {notes:'current',vin:'unknown'}]){
    await assert.rejects(approve(approval(snapshot,choices)),error=>error.code==='22023');
  }
  assert.equal((await stats()).decisions,0);
});

test('optional-field absence can be approved without confusing it with null',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending({notes:{present:false}});
  const result=await approve(approval(await review(),{notes:candidate.receipt.conflictId}));
  assert.equal(Object.hasOwn(result.record,'notes'),false);assert.equal((await outcome(candidate.op.operationId)).outcome,'kept');
});

test('deleted records can be kept deleted, but cannot be restored by approving a detail update',async()=>{
  await asActor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',recordId,event:'delete',expectedVersion:1}])]));
  const candidate=await pending();const snapshot=await review();assert.equal(snapshot.currentRecord,null);
  await assert.rejects(approve(approval(snapshot,{notes:candidate.receipt.conflictId})),/Restoring deleted records/);
  const result=await approve(approval(snapshot,{notes:'current'}));assert.equal(result.record,null);
  assert.equal((await outcome(candidate.op.operationId)).outcome,'not_selected');
  assert.equal((await row('select count(*)::int count from public.fleet_vehicles')).count,0);
});

test('delete/re-create after opening review invalidates the token even if values match',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();const snapshot=await review();
  await asActor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([
    {collection:'vehicles',recordId,event:'delete',expectedVersion:2},
    {collection:'vehicles',recordId,event:'insert',data:{...base,notes:'Online'}},
  ])]));
  await assert.rejects(approve(approval(snapshot,{notes:candidate.receipt.conflictId})),error=>error.code==='PT409');
  assert.equal((await review()).candidates[0].lifecycleChanged,true);
});

test('decision storage failure rolls back approved values, receipts, states, outcomes and revision side effects',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();const request=approval(await review(),{notes:candidate.receipt.conflictId});
  await db.exec(`create function public.fail_review_test() returns trigger language plpgsql as $$ begin raise exception 'decision storage failed'; end; $$;
    create trigger fail_review before insert on public.fleet_sync_decisions for each row execute function public.fail_review_test()`);
  try{
    await assert.rejects(approve(request),/decision storage failed/);
    assert.equal((await row('select data from public.fleet_vehicles')).data.notes,'Online');
    assert.equal((await row('select result from public.fleet_sync_submissions')).result.kind,'awaiting_review');
    assert.deepEqual(await stats(),{decisions:0,outcomes:0,pending:1,revisions:2,effects:2});
  }finally{await db.exec('drop trigger fail_review on public.fleet_sync_decisions;drop function public.fail_review_test()')}
  assert.equal((await approve(request)).kind,'resolved');
});

test('a failure at the final conflict-state update rolls back decisions, outcomes and promoted receipts',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();const request=approval(await review(),{notes:candidate.receipt.conflictId});
  await db.exec(`create function public.fail_close_test() returns trigger language plpgsql as $$ begin raise exception 'close failed'; end; $$;
    create trigger fail_close before update on public.fleet_sync_conflicts for each row execute function public.fail_close_test()`);
  try{
    await assert.rejects(approve(request),/close failed/);
    assert.deepEqual(await stats(),{decisions:0,outcomes:0,pending:1,revisions:2,effects:2});
    assert.equal((await row('select result from public.fleet_sync_submissions')).result.kind,'awaiting_review');
    assert.equal((await row('select data from public.fleet_vehicles')).data.notes,'Online');
  }finally{await db.exec('drop trigger fail_close on public.fleet_sync_conflicts;drop function public.fail_close_test()')}
});

test('selected historical candidate values are revalidated under current adapter rules',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();
  // Model a malformed/legacy candidate using privileged maintenance, not client ACLs.
  await db.query("update public.fleet_sync_conflicts set proposed_record=jsonb_set(proposed_record,'{notes}','12') where id=$1",[candidate.receipt.conflictId]);
  const snapshot=await review();
  await assert.rejects(approve(approval(snapshot,{notes:candidate.receipt.conflictId})),/Invalid detail field value/);
  assert.equal((await stats()).decisions,0);
  assert.equal((await approve(approval(snapshot,{notes:'current'}))).kind,'resolved');
});

test('issue review uses the same freshness guards and applies only offered scalar details',async()=>{
  const issue={id:recordId,title:'Original',description:'Description',priority:'Medium',status:'Open',createdById:owner,updates:[]};
  await asActor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([
    {collection:'issues',recordId,event:'insert',data:issue},
    {collection:'issues',recordId,event:'update',expectedVersion:1,data:{...issue,title:'Online'}},
  ])]));
  const op={...operation({title:present('Offline')},{original:issue}),entityType:'issue'};
  const candidate=await sync(op);
  const snapshot=await asActor(owner,async()=>(await row('select public.get_fleet_sync_review($1,$2,$3) result',[company,'issue',recordId])).result);
  const request={...approval(snapshot,{title:candidate.conflictId}),entityType:'issue'};
  const result=await approve(request);assert.equal(result.record.title,'Offline');assert.equal(result.record.status,'Open');
  assert.equal((await outcome(op.operationId)).outcome,'kept');
});

test('selected offline authorship is preserved separately from the approver on future conflicts',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();
  await approve(approval(await review(admin),{notes:candidate.receipt.conflictId}),admin);
  await pending({notes:present('Next proposal')});
  const snapshot=await review();
  assert.equal(snapshot.currentProvenance.notes.userId,owner);assert.equal(snapshot.currentProvenance.notes.connectivity,'offline');
  assert.equal(snapshot.currentProvenance.notes.approvedBy,admin);assert.equal(snapshot.currentProvenance.notes.approvedByName,'Admin');
  assert.equal(snapshot.candidates[0].currentRecord.notes,'Offline');
  const captured=await row("select current_provenance from public.fleet_sync_conflicts where state='pending'");
  assert.equal(captured.current_provenance.notes.userId,owner);assert.equal(captured.current_provenance.notes.approvedBy,admin);
});

test('only current managers may review or approve and public clients cannot call private implementations or forge audits',async()=>{
  await online({...base,notes:'Online'});await pending();const request=approval(await review(),{notes:'current'});
  for(const actor of [crew,outsider,null]){
    await assert.rejects(review(actor),error=>error.code==='42501');
    await assert.rejects(approve(request,actor),error=>error.code==='42501');
  }
  await assert.rejects(review(owner,otherCompany),error=>error.code==='42501');
  for(const sql of ["select public.sync_fleet_update_internal('{}')",`select public.fleet_sync_review_state('${company}','vehicle','${recordId}')`,
    'insert into public.fleet_sync_decisions default values','update public.fleet_sync_decisions set reviewer_name=\'forged\'',
    'delete from public.fleet_sync_decisions','insert into public.fleet_sync_outcomes default values',
    "update public.fleet_sync_conflicts set state='resolved'","update public.fleet_sync_submissions set initial_result='{}'", "update public.fleet_sync_submissions set result='{}'"]){
    await assert.rejects(asActor(owner,()=>db.exec(sql)),error=>error.code==='42501');
  }
});

test('outcomes are metadata-only, scoped to the submitter, and remain available after demotion but not removal',async()=>{
  await online({...base,notes:'Online'});const candidate=await pending();await approve(approval(await review(),{notes:'current'}));
  const received=await outcome(candidate.op.operationId);assert.equal(received.outcome,'not_selected');assert.equal(received.kind,'reviewed');
  assert.equal(Object.hasOwn(received,'record'),false);assert.equal(Object.hasOwn(received,'choices'),false);
  assert.equal(await outcome(candidate.op.operationId,admin),null);assert.equal(await outcome(randomUUID()),null);
  await db.query("update public.company_members set role='fire_fighter' where company_id=$1 and user_id=$2",[company,owner]);
  assert.deepEqual(await outcome(candidate.op.operationId),received);
  assert.deepEqual((await asActor(crew,()=>db.query('select * from public.fleet_sync_outcomes'))).rows,[]);
  assert.deepEqual((await asActor(owner,()=>db.query('select * from public.fleet_sync_decisions'))).rows,[]);
  await db.query('delete from public.company_members where company_id=$1 and user_id=$2',[company,owner]);
  await assert.rejects(outcome(candidate.op.operationId),error=>error.code==='42501');
});

test('company deletion cascades review audits and outcomes without resurrecting any data',async()=>{
  await online({...base,notes:'Online'});await pending();await approve(approval(await review(),{notes:'current'}));
  await db.query('delete from public.companies where id=$1',[company]);
  assert.deepEqual(await stats(),{decisions:0,outcomes:0,pending:0,revisions:0,effects:3});
});
