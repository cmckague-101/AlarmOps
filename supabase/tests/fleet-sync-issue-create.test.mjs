import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncAttachmentSchema} from './fixtures/fleet-sync-harness.mjs';
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003';
const vehicle='30000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function create(user=owner,changes={},recordChanges={}){
  const id=randomUUID();
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'issue',entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],
    mutation:{kind:'create',record:{id,vehicleId:vehicle,title:'Leak',description:'Coolant on ground',priority:'High',status:'Open',updates:[],createdBy:'Reporter',createdById:user,createdAt:'2026-01-01T11:59:00.000Z',...recordChanges}},...changes};
}
const submit=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_fleet_create($1::jsonb) result',[JSON.stringify(op)])).result);
const count=async()=>(await row('select count(*)::int count from public.fleet_issues')).count;
before(async()=>{await loadFleetSyncAttachmentSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6)',[owner,'Owner',crew,'Crew',tech,'Tech']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech']);
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:{id:vehicle,unit:'E1',status:'Ready'}}])]));
});
after(async()=>{await db.close()});

test('creates one issue idempotently with a verified receipt',async()=>{
  const op=create();const result=await submit(op);assert.equal(result.kind,'applied');assert.equal(result.revision,'1');assert.deepEqual(result.record,op.mutation.record);
  assert.deepEqual(await submit(op),result);assert.equal(await count(),1);
  await assert.rejects(submit({...op,mutation:{...op.mutation,record:{...op.mutation.record,title:'Changed'}}}),error=>error.code==='22023');
  const read=await actor(owner,async()=>(await row('select public.get_fleet_sync_record($1,$2,$3) result',[company,'issue',op.entityId])).result);assert.equal(read.revision,'1');
});
test('shop techs report as themselves; firefighters cannot',async()=>{
  assert.equal((await submit(create(tech))).kind,'applied');
  await assert.rejects(submit(create(crew)),error=>error.code==='42501');
  await assert.rejects(submit(create(tech,{},{createdById:owner}),tech),error=>error.code==='22023');
});
test('never reuses an identity, including a deleted one',async()=>{
  const first=create();await submit(first);
  await assert.rejects(submit({...create(),entityId:first.entityId,mutation:{kind:'create',record:{...first.mutation.record}}}),error=>error.code==='23505');
  await actor(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'issues',event:'delete',recordId:first.entityId,expectedVersion:1}])]));
  await assert.rejects(submit({...create(),entityId:first.entityId,mutation:{kind:'create',record:{...first.mutation.record}}}),error=>error.code==='23505');
  assert.equal(await count(),0);
});
test('validates the full new record and its vehicle',async()=>{
  for(const changes of [{status:'Resolved'},{updates:[{id:'x'}]},{title:' '},{description:''},{priority:'Urgent'},{vehicleId:randomUUID()},{extra:1},{createdAt:'today'}])
    await assert.rejects(submit(create(owner,{},changes)),error=>error.code==='22023',JSON.stringify(changes));
  await assert.rejects(submit(create(owner,{dependsOn:[randomUUID()]})),error=>error.code==='22023');
  await assert.rejects(submit(create(owner,{entityType:'vehicle'})),error=>error.code==='22023');
  assert.equal(await count(),0);
});
