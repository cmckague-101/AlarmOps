import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Invoice due dates and paid status (20270101000100): creators set due dates on
// drafts; only owners and accounting mark a submitted invoice paid; paid
// invoices are read only, cannot be deleted, and offline devices see them as submitted.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004';
const customer='30000000-0000-4000-8000-000000000001';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'invoice_form',entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const status=async id=>(await row('select status,paid_at,paid_by,paid_by_name,due_date::text due from public.invoice_forms where id=$1',[id]));
async function submitted(dueDate=null){
  const id=randomUUID();
  await actor(crew,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id,due_date) values($1,$2,$3,'Crew','INV-1','2026-10-01',100,$4,$5)",[id,company,crew,customer,dueDate]));
  await actor(crew,()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id]));
  return id;
}
before(async()=>{
  await loadGuardedEditSchema(db);
  const accountingSql=migration('20261225000100_accounting_role');
  await db.exec(accountingSql.slice(0,accountingSql.indexOf('-- Payroll and invoice files'))+'commit;');
  // Storage policies are not part of this fixture.
  const sql=migration('20270101000100_invoice_due_and_paid');
  await db.exec(sql.slice(0,sql.indexOf('-- Creators keep their files'))+'commit;');
});
beforeEach(async()=>{
  await db.exec('truncate public.test_notifications;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Accounting','b@x'),($4,'Crew','c@x')",[owner,admin,accounting,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9)',[company,owner,'owner',admin,'admin',accounting,'accounting',crew,'fire_fighter']);
  await db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[customer,company]);
});
after(async()=>{await db.close()});

test('creators set a due date on drafts, never before the invoice date',async()=>{
  const id=await submitted('2026-11-15');
  assert.equal((await status(id)).due,'2026-11-15');
  await assert.rejects(actor(crew,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id,due_date) values($1,$2,$3,'Crew','INV-2','2026-10-01',100,$4,'2026-09-01')",[randomUUID(),company,crew,customer])),error=>error.code==='23514');
});

test('only owners and accounting mark a submitted invoice paid',async()=>{
  const id=await submitted();
  assert.equal((await actor(crew,()=>db.query("update public.invoice_forms set status='paid' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal((await actor(admin,()=>db.query("update public.invoice_forms set status='paid' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal((await status(id)).status,'submitted');
  const paid=await actor(accounting,()=>row("update public.invoice_forms set status='paid', invoice_amount=1 where id=$1 returning status,invoice_amount::int amount,paid_by,paid_by_name",[id]));
  assert.deepEqual(paid,{status:'paid',amount:100,paid_by:accounting,paid_by_name:'Accounting'});
  const other=await submitted();
  assert.equal((await actor(owner,()=>row("update public.invoice_forms set status='paid' where id=$1 returning status",[other]))).status,'paid');
});

test('a submitted invoice cannot be edited without marking it paid',async()=>{
  const id=await submitted();
  await assert.rejects(actor(accounting,()=>db.query("update public.invoice_forms set invoice_amount=5 where id=$1",[id])),error=>error.code==='42501');
});

test('paid invoices are read only and cannot be deleted',async()=>{
  const id=await submitted();
  await actor(owner,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  assert.equal((await actor(owner,()=>db.query("update public.invoice_forms set status='submitted' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal((await status(id)).status,'paid');
  assert.equal((await actor(owner,()=>db.query('delete from public.invoice_forms where id=$1 returning id',[id]))).rows.length,0);
  assert.equal((await actor(accounting,()=>db.query('delete from public.invoice_forms where id=$1 returning id',[id]))).rows.length,0);
  const open=await submitted();
  assert.equal((await actor(accounting,()=>db.query('delete from public.invoice_forms where id=$1 returning id',[open]))).rows.length,1);
});

test('offline devices treat a paid invoice as already submitted',async()=>{
  const id=await submitted();
  await actor(owner,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  const result=await send(crew,command(crew,id,'form.save',{invoiceNumber:'INV-9'}));
  assert.equal(result.notApplied,'already_submitted');
  assert.equal((await send(crew,command(crew,id,'form.submit',{}))).notApplied,undefined);
  assert.equal((await status(id)).status,'paid');
});
