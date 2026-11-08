import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Resource Boss: crew-level, plus inventory management, the shop board and fleet
// dispatch (status and crew/fire assignment). Assigned by owners and admins only.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',boss='20000000-0000-4000-8000-000000000003';
const crew='20000000-0000-4000-8000-000000000004',tech='20000000-0000-4000-8000-000000000005';
const vehicle='30000000-0000-4000-8000-000000000001';
const baseVehicle={id:vehicle,unit:'E1',status:'Ready',notes:'Base'};
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const row=async(sql,args=[])=>(await rows(sql,args))[0];
async function as(user,task,{role='authenticated',headers}={}){
  await db.exec('begin');
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.headers',$3,true)",[user??'',role,headers?JSON.stringify(headers):'']);
    await db.exec(`set local role ${role}`);
    const result=await task();await db.exec('commit');return result;
  }catch(error){await db.exec('rollback');throw error}
}
const denied=error=>error.code==='42501';
const userCommand=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>as(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const onHand=async id=>(await row('select quantity from public.company_inventory_items where id=$1',[id])).quantity;
const held=async(id,user)=>(await row('select quantity from public.company_inventory_checkouts where item_id=$1 and user_id=$2',[id,user]))?.quantity??0;
const stamp=async id=>(await row("select to_json(updated_at)#>>'{}' value from public.company_inventory_items where id=$1",[id])).value;
const checkoutStamp=async id=>(await row("select to_json(updated_at)#>>'{}' value from public.company_inventory_checkouts where item_id=$1",[id])).value;
async function item(quantity,name='Gloves'){const id=randomUUID();await as(owner,()=>db.query('insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,$3,$4)',[id,company,name,quantity]));return id}
const vehicleData=async()=>(await row('select data from public.fleet_vehicles where record_id=$1',[vehicle])).data;
const vehicleVersion=async()=>Number((await row('select version from public.fleet_vehicles where record_id=$1',[vehicle])).version);
const online=async(user,data)=>{const expectedVersion=await vehicleVersion();return as(user,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',recordId:vehicle,event:'update',expectedVersion,data}])]))};
const present=value=>({present:true,value});
function fleetUpdate(user,patch,original,version='1'){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'vehicle',entityId:vehicle,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:05:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:version,base:original,patch}};
}
function issueCreate(user){
  const id=randomUUID();
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'issue',entityId:id,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],
    mutation:{kind:'create',record:{id,vehicleId:vehicle,title:'Leak',description:'Coolant on ground',priority:'High',status:'Open',updates:[],createdBy:'Reporter',createdById:user,createdAt:'2026-01-01T11:59:00.000Z'}}};
}
const shopJob=()=>as(null,()=>row(`insert into public.shop_jobs(company_id,title,kind,shop_area,opened_by,opened_by_name) values($1,'Sharpen chain','general','Saw shop',$2,'Owner') returning *`,[company,owner]),{role:'service_role',headers:{'x-fireops-actor-id':owner}});

before(async()=>{
  await loadGuardedEditSchema(db);
  for(const name of ['20261117000100_fleet_sync_attachment_uploads','20261118000100_fleet_sync_attachment_verification','20261119000100_fleet_sync_document_attach',
    '20261120000100_fleet_sync_attachment_release','20261121000100_fleet_sync_vehicle_file_slots','20261122000100_fleet_sync_status_assignments','20261123000100_fleet_sync_member_actions',
    '20261124000100_fleet_sync_inspections','20261125000100_fleet_sync_shop_tech_photos','20261126000100_fleet_sync_issue_create','20261202000100_fleet_sync_storage_cleanup_fences',
    '20261213000100_fleet_sync_issue_status_with_note','20261214000100_fleet_sync_vehicle_create','20261222000100_fleet_sync_submitter_conflicts'])
    await db.exec(migration(name));
  // Storage policies and notification delivery are not part of this fixture.
  const accounting=migration('20261225000100_accounting_role');
  await db.exec(accounting.slice(0,accounting.indexOf('-- Payroll and invoice files'))+'commit;');
  await db.exec(migration('20270109000100_inventory_on_hand_quantity'));
  // The real audit trigger is covered by company-audit-log.test.mjs.
  await db.exec('create function public.capture_company_audit_log() returns trigger language plpgsql as $$ begin return null; end; $$');
  await db.exec(migration('20270110000100_shop_fleet_repairs'));
  await db.exec(migration('20270111000100_resource_boss_role'));
});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade;truncate public.sync_test_effects');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Boss','b@x'),($4,'Crew Person','c@x'),($5,'Tech','t@x')",[owner,admin,boss,crew,tech]);
  await db.query("insert into public.company_members values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'resource_boss'),($1,$5,'fire_fighter'),($1,$6,'shop_tech')",[company,owner,admin,boss,crew,tech]);
  await as(owner,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:vehicle,data:baseVehicle}])]));
});
after(async()=>{await db.close()});

test('owners and admins assign Resource Boss; resource bosses cannot assign roles',async()=>{
  await db.exec('create table if not exists public.fleet_crew (company_id uuid, record_id uuid, data jsonb, version bigint default 1, updated_by uuid)');
  assert.equal((await as(admin,()=>row('select public.update_company_member_role($1,$2,$3) result',[company,crew,'resource_boss']))).result.role,'resource_boss');
  assert.equal((await row('select role from public.company_members where user_id=$1',[crew])).role,'resource_boss');
  assert.equal((await as(owner,()=>row('select public.update_company_member_role($1,$2,$3) result',[company,crew,'fire_fighter']))).result.role,'fire_fighter');
  await assert.rejects(as(boss,()=>row('select public.update_company_member_role($1,$2,$3) result',[company,crew,'resource_boss'])),denied);
  await assert.rejects(db.query("update public.company_members set role='resource_chief' where user_id=$1",[crew]),error=>error.code==='23514');
});

test('resource bosses add, edit and delete inventory items online and offline',async()=>{
  const id=randomUUID();
  await as(boss,()=>db.query("insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,'Radios',4)",[id,company]));
  await as(boss,()=>db.query('update public.company_inventory_items set quantity=6 where id=$1',[id]));
  assert.equal(await onHand(id),6);
  const renamed=await send(boss,userCommand(boss,'inventory_item',id,'item.update',{name:'Handheld radios',base:{updatedAt:await stamp(id)}}));
  assert.equal(renamed.notApplied,undefined);assert.equal(renamed.record.name,'Handheld radios');
  const created=randomUUID();
  assert.equal((await send(boss,userCommand(boss,'inventory_item',created,'item.create',{name:'Shelters',quantity:2}))).notApplied,undefined);
  assert.equal((await send(boss,userCommand(boss,'inventory_item',created,'item.delete',{base:{updatedAt:await stamp(created)}}))).record,null);
  assert.equal((await as(boss,()=>db.query('delete from public.company_inventory_items where id=$1 returning id',[id]))).rows.length,1);
});

test('resource bosses check gear back in for others (online and offline) and check out gear themselves',async()=>{
  const id=await item(10);
  await as(crew,()=>db.query('select public.checkout_inventory_item($1,4)',[id]));
  await as(tech,()=>db.query('select public.checkout_inventory_item($1,2)',[id]));
  // Everyone in the company reads who has what.
  assert.equal((await as(boss,()=>rows('select user_id from public.company_inventory_checkouts where item_id=$1',[id]))).length,2);
  assert.equal((await as(boss,()=>row('select public.checkin_inventory_item($1,$2,3) remaining',[id,crew]))).remaining,1);
  assert.equal(await onHand(id),7);
  const base=(await row("select to_json(updated_at)#>>'{}' value from public.company_inventory_checkouts where item_id=$1 and user_id=$2",[id,tech])).value;
  assert.equal((await send(boss,userCommand(boss,'inventory_return',id,'return.checkin',{userId:tech,quantity:2,base:{updatedAt:base}}))).notApplied,undefined);
  assert.equal(await held(id,tech),0);assert.equal(await onHand(id),9);
  await as(boss,()=>db.query('select public.checkout_inventory_item($1,5)',[id]));
  assert.equal(await held(id,boss),5);assert.equal(await onHand(id),4);
});

test('crew roles still cannot manage inventory or check in for others',async()=>{
  const id=await item(5);
  await as(boss,()=>db.query('select public.checkout_inventory_item($1,2)',[id]));
  await assert.rejects(as(crew,()=>db.query("insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,'Hose',1)",[randomUUID(),company])),denied);
  assert.equal((await as(tech,()=>db.query('update public.company_inventory_items set quantity=50 where id=$1 returning id',[id]))).rows.length,0);
  await assert.rejects(as(crew,()=>db.query('select public.checkin_inventory_item($1,$2,1)',[id,boss])),denied);
  await assert.rejects(send(tech,userCommand(tech,'inventory_return',id,'return.checkin',{userId:boss,quantity:1,base:{updatedAt:await checkoutStamp(id)}})),denied);
  await assert.rejects(send(crew,userCommand(crew,'inventory_item',id,'item.update',{quantity:9,base:{updatedAt:await stamp(id)}})),denied);
  assert.equal(await onHand(id),3);
});

test('resource bosses change status and assign any vehicle to crew, but cannot edit vehicle details',async()=>{
  await online(boss,{...baseVehicle,status:'Assigned',assignedTo:crew});
  assert.deepEqual(await vehicleData(),{...baseVehicle,status:'Assigned',assignedTo:crew});
  await online(boss,{...baseVehicle,status:'Assigned',assignedTo:crew,assignedFire:{id:'f1',name:'Ridge',state:'CA'}});
  await online(boss,{...baseVehicle,status:'Out of service'});
  assert.equal((await vehicleData()).status,'Out of service');
  await assert.rejects(online(boss,{...baseVehicle,status:'Out of service',unit:'E2'}),denied);
  await assert.rejects(online(boss,{...baseVehicle,status:'Out of service',notes:'Changed'}),denied);
  // Crew still only claim a ready vehicle for themselves.
  await assert.rejects(online(crew,{...baseVehicle,status:'Ready'}),denied);
  await assert.rejects(online(tech,{...baseVehicle,status:'Assigned',assignedTo:crew}),denied);
  // Adds and deletes stay owner/admin.
  await assert.rejects(as(boss,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'vehicles',event:'insert',recordId:randomUUID(),data:{unit:'E9',status:'Ready'}}])])));
  assert.equal((await as(boss,()=>db.query('delete from public.fleet_vehicles where record_id=$1 returning record_id',[vehicle]))).rows.length,0);
});

test('resource bosses dispatch vehicles and add inspections offline; firefighters cannot assign others',async()=>{
  const assigned=await as(boss,async()=>(await row('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(fleetUpdate(boss,{status:present('Assigned'),assignedTo:present(tech)},baseVehicle))])).result);
  assert.equal(assigned.kind,'applied');assert.equal(assigned.record.assignedTo,tech);
  await assert.rejects(as(crew,async()=>(await row('select public.sync_fleet_update($1::jsonb) result',[JSON.stringify(fleetUpdate(crew,{assignedTo:present(boss)},assigned.record,assigned.revision))])).result),denied);
  assert.equal(await row('select public.fleet_sync_attachment_user_allowed($1,$2) allowed',[company,boss]).then(result=>result.allowed),true);
  assert.equal(await row('select public.fleet_sync_attachment_user_allowed($1,$2) allowed',[company,crew]).then(result=>result.allowed),false);
  await row('select public.validate_fleet_sync_submitter_patch($1,$2,$3,$4::jsonb)',[company,boss,'vehicle',JSON.stringify({inspections:[]})]);
  await assert.rejects(row('select public.validate_fleet_sync_submitter_patch($1,$2,$3,$4::jsonb)',[company,crew,'vehicle',JSON.stringify({inspections:[]})]),denied);
  const inspection={id:randomUUID(),inspectorId:boss,inspectorName:'Boss',items:[]};
  await online(boss,{...assigned.record,inspections:[inspection]});
  assert.deepEqual((await vehicleData()).inspections,[inspection]);
});

test('resource bosses report fleet issues online and offline, and use vehicle notes',async()=>{
  const id=randomUUID();
  await as(boss,()=>db.query('select public.apply_fleet_changes($1,$2::jsonb)',[company,JSON.stringify([{collection:'issues',event:'insert',recordId:id,data:{id,vehicleId:vehicle,title:'Flat',priority:'High',status:'Open',updates:[],createdById:boss,createdBy:'Boss'}}])]));
  assert.equal((await row('select count(*)::int n from public.fleet_issues')).n,1);
  assert.equal((await as(boss,async()=>(await row('select public.sync_fleet_create($1::jsonb) result',[JSON.stringify(issueCreate(boss))])).result)).kind,'applied');
  await assert.rejects(as(crew,async()=>(await row('select public.sync_fleet_create($1::jsonb) result',[JSON.stringify(issueCreate(crew))])).result),denied);
  await as(boss,()=>db.query("insert into public.vehicle_notes(company_id,vehicle_id,subject,body,created_by_name) values($1,$2,'Tires','Rotate soon','Boss')",[company,vehicle]));
  assert.equal((await as(boss,()=>rows('select id from public.vehicle_notes'))).length,1);
  assert.equal((await as(crew,()=>rows('select id from public.vehicle_notes'))).length,0);
});

test('resource bosses work the shop board; firefighters cannot',async()=>{
  const job=await shopJob();
  assert.equal((await row('select public.is_shop_writer($1,$2) value',[company,boss])).value,true);
  assert.equal((await row('select public.is_shop_writer($1,$2) value',[company,crew])).value,false);
  await as(boss,()=>db.query("update public.shop_jobs set priority='high', assigned_tech_id=$2 where id=$1",[job.id,tech]));
  const updated=await row('select priority,assigned_tech_id from public.shop_jobs where id=$1',[job.id]);
  assert.equal(updated.priority,'high');assert.equal(updated.assigned_tech_id,tech);
  assert.equal((await as(crew,()=>db.query("update public.shop_jobs set priority='low' where id=$1 returning id",[job.id]))).rows.length,0);
  assert.equal((await as(boss,()=>db.query('delete from public.shop_jobs where id=$1 returning id',[job.id]))).rows.length,1);
});

test('resource bosses stay crew-level for management, finance and Crew Chat moderation',async()=>{
  for(const fn of ['is_company_owner','is_company_manager','is_company_finance_processor'])
    assert.equal((await row(`select public.${fn}($1,$2) value`,[company,boss])).value,false,fn);
  assert.equal((await row('select public.can_manage_inventory($1,$2) value',[company,boss])).value,true);
  assert.equal((await row('select public.can_manage_inventory($1,$2) value',[company,tech])).value,false);
  await assert.rejects(as(boss,()=>db.query("insert into public.communication_threads(company_id,subject,description) values($1,'Briefing','Tomorrow 0600')",[company])),denied);
  await assert.rejects(as(boss,()=>db.query("insert into public.fleet_crew(company_id,record_id,data,updated_by) values($1,$2,'{}',$3)",[company,randomUUID(),boss])),denied);
  await assert.rejects(as(boss,()=>db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[randomUUID(),company])),denied);
});
