import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Send to VIPR fields (20270114000100): owners set VIPR category, engine type,
// pump, tank, GVWR and daily rate; values are validated for every writer and
// other roles still cannot change vehicle details.

const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',tech='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,action){
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.exec('set local role authenticated');
    const result=await action();await db.exec('commit');return result;
  } catch(error){await db.exec('rollback');throw error;}
}
const data=async id=>(await row('select data from public.fleet_vehicles where record_id=$1',[id])).data;
const patch=(user,id,changes)=>actor(user,()=>db.query('update public.fleet_vehicles set data=data||$2::jsonb,updated_by=auth.uid() where record_id=$1',[id,JSON.stringify(changes)]));
async function vehicle(fields={}){
  const id=randomUUID();
  await db.query('insert into public.fleet_vehicles(company_id,record_id,data,updated_by) values($1,$2,$3,$4)',[company,id,JSON.stringify({id,unit:'Engine 7',status:'Ready',...fields}),owner]);
  return id;
}

before(async()=>{
  await loadFleetSyncSchema(db);
  await db.exec(migration('20261107000100_personal_tasks'));
  await db.exec(migration('20261228000100_personal_task_editing'));
  const inbox=migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(inbox.slice(inbox.indexOf('create table public.notification_preferences'),inbox.indexOf('create table public.push_notification_deliveries')));
  await db.exec(migration('20261226000100_payroll_rejected_notifications'));
  await db.exec(migration('20261229000100_task_due_reminders'));
  await db.exec(migration('20270108000100_vehicle_oil_change_due'));
  await db.exec(migration('20270114000100_vehicle_vipr_fields'));
});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query("insert into public.profiles values($1,'Owner'),($2,'Tech')",[owner,tech]);
  await db.query("insert into public.company_members values($1,$2,'owner'),($1,$3,'shop_tech')",[company,owner,tech]);
});
after(async()=>{await db.close()});

const valid={viprCategory:'Engine',engineType:'Type 3',pumpGpm:150,pumpPsi:250,tankGallons:500,gvwrLbs:26000,dailyRate:1850.5};

test('owners set and clear VIPR fields; other roles cannot',async()=>{
  const id=await vehicle();
  await patch(owner,id,valid);
  const saved=await data(id);
  for(const [key,value] of Object.entries(valid))assert.equal(saved[key],value);
  await actor(owner,()=>db.query("update public.fleet_vehicles set data=data-'pumpGpm',updated_by=auth.uid() where record_id=$1",[id]));
  assert.equal((await data(id)).pumpGpm,undefined);
  await assert.rejects(patch(tech,id,{viprCategory:'Water Tender'}),/This role cannot make the requested vehicle change/);
  // Unchanged VIPR fields do not get in the way of other allowed changes.
  await patch(tech,id,{nextOilChange:'45,000 mi'});
});

test('rejects invalid VIPR values from every writer, including owners',async()=>{
  const id=await vehicle();
  for(const [field,bad] of [['viprCategory',''],['viprCategory','x'.repeat(61)],['viprCategory',5],['engineType','Type 8'],['engineType','type 3'],
    ['pumpGpm',0],['pumpGpm',-5],['pumpGpm','150'],['pumpGpm',12.5],['pumpPsi',1001],['tankGallons',20001],['gvwrLbs',null],['dailyRate',1.234],['dailyRate',100001]])
    await assert.rejects(patch(owner,id,{[field]:bad}),/VIPR category|Engine type|must be a positive number/,`${field}=${JSON.stringify(bad)}`);
  await assert.rejects(vehicle({engineType:'Type 0'}),/Engine type/);
  await patch(owner,id,{viprCategory:'Pickup / Utility',engineType:'Type 7',pumpGpm:5000,pumpPsi:1000,tankGallons:20000,gvwrLbs:200000,dailyRate:100000});
});

test('existing bad values do not block unrelated edits',async()=>{
  const id=await vehicle();
  await db.query("alter table public.fleet_vehicles disable trigger fleet_vehicles_validate_vipr_fields");
  await db.query(`update public.fleet_vehicles set data=data||'{"pumpGpm":"lots"}' where record_id=$1`,[id]);
  await db.query("alter table public.fleet_vehicles enable trigger fleet_vehicles_validate_vipr_fields");
  await patch(owner,id,{plate:'NEW-1'});
  assert.equal((await data(id)).plate,'NEW-1');
});
