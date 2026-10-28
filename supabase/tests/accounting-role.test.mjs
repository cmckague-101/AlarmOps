import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Accounting processes payroll and invoices with the owner; admins only see and
// manage their own payroll and invoices, like crew.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const stamp=async id=>(await row("select to_json(updated_at)#>>'{}' value from public.payroll_forms where id=$1",[id])).value;
const visible=(user,table)=>actor(user,async()=>(await db.query(`select id from public.${table}`)).rows.length);
before(async()=>{
  await loadGuardedEditSchema(db);
  // Storage policies and notification delivery are not part of this fixture.
  const sql=migration('20261225000100_accounting_role');
  await db.exec(sql.slice(0,sql.indexOf('-- Payroll and invoice files'))+'commit;');
});
beforeEach(async()=>{
  await db.exec('truncate public.test_notifications;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Accounting','b@x'),($4,'Crew','c@x')",[owner,admin,accounting,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9)',[company,owner,'owner',admin,'admin',accounting,'accounting',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('accounting reviews payroll and is notified; admins cannot',async()=>{
  const days=Array.from({length:21},()=>({date:'',hoursWorked:0,crewIds:[],notes:''}));const form=randomUUID();
  await send(crew,command(crew,'payroll_form',form,'form.save',{rows:days}));await send(crew,command(crew,'payroll_form',form,'form.submit',{}));
  assert.deepEqual((await db.query('select user_id from public.test_notifications order by user_id')).rows.map(item=>item.user_id),[owner,accounting]);
  assert.equal(await visible(admin,'payroll_forms'),0);
  assert.equal(await visible(accounting,'payroll_forms'),1);
  const base={updatedAt:await stamp(form)};
  await assert.rejects(send(admin,command(admin,'payroll_review',form,'review.approve',{base})),error=>error.code==='42501');
  assert.equal((await actor(admin,()=>db.query("update public.payroll_forms set status='approved' where id=$1 returning id",[form]))).rows.length,0);
  const approve=command(accounting,'payroll_review',form,'review.approve',{base});
  assert.equal((await send(accounting,approve)).record.status,'approved');
  assert.equal((await actor(accounting,()=>row("update public.payroll_forms set status='paid' where id=$1 returning status",[form]))).status,'paid');
});

test('accounting manages invoice customers and reads every invoice; admins see only their own',async()=>{
  const customer=randomUUID();
  await assert.rejects(actor(admin,()=>db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[randomUUID(),company])),error=>error.code==='42501');
  await actor(accounting,()=>db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[customer,company]));
  const invoice=randomUUID();
  await send(crew,command(crew,'invoice_form',invoice,'form.save',{invoiceNumber:'INV-1',invoiceDate:'2026-07-04',invoiceAmount:10,customerId:customer}));
  await send(crew,command(crew,'invoice_form',invoice,'form.submit',{}));
  assert.equal(await visible(admin,'invoice_forms'),0);
  assert.equal(await visible(accounting,'invoice_forms'),1);
  assert.equal(await visible(owner,'invoice_forms'),1);
  assert.ok((await db.query('select 1 from public.test_notifications where user_id=$1',[accounting])).rows.length>0);
  assert.equal((await db.query('select 1 from public.test_notifications where user_id=$1',[admin])).rows.length,0);
});

test('only owners and admins assign roles, including accounting',async()=>{
  assert.equal(await actor(accounting,async()=>(await row('select public.is_company_owner($1,$2) value',[company,accounting])).value),false);
  await db.exec("create table if not exists public.fleet_crew (company_id uuid, record_id uuid, data jsonb, version bigint default 1, updated_by uuid)");
  assert.equal((await actor(admin,()=>row('select public.update_company_member_role($1,$2,$3) result',[company,crew,'accounting']))).result.role,'accounting');
  await assert.rejects(actor(accounting,()=>row('select public.update_company_member_role($1,$2,$3) result',[company,crew,'admin'])),error=>error.code==='42501');
});
