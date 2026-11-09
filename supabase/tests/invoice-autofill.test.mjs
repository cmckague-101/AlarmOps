import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Invoice auto-fill (20270115000100): claimed by any member of a company with
// the receipt auto-fill switch on, logged as kind 'invoice', and sharing the
// receipt daily caps in both directions. Every member may add invoice customers;
// renaming and deleting them stays with owners and accounting.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',outsider='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const claim=async(fn,companyId,user)=>{await db.exec('set role service_role');try{return (await row(`select public.${fn}($1,$2) result`,[companyId,user])).result}finally{await db.exec('reset role')}};
const invoice=(companyId,user)=>claim('claim_invoice_autofill',companyId,user);
const receipt=(companyId,user)=>claim('claim_receipt_autofill',companyId,user);
const enable=()=>db.query('update public.companies set receipt_autofill_enabled=true where id=$1',[company]);
before(async()=>{
  await loadGuardedEditSchema(db);
  // Storage policies and notification delivery are not part of this fixture.
  const accounting=migration('20261225000100_accounting_role');
  await db.exec(accounting.slice(0,accounting.indexOf('-- Payroll and invoice files'))+'commit;');
  await db.exec(migration('20270102000100_receipt_purchase_date'));
  await db.exec(migration('20270112000100_receipt_projects_autofill'));
  await db.exec("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$");
  // A usage row logged before this migration stays a receipt.
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x')",[owner]);
  await db.query('insert into public.company_members values($1,$2,$3)',[company,owner,'owner']);
  await db.query('insert into public.receipt_autofill_usage(company_id,user_id) values($1,$2)',[company,owner]);
  await db.exec(migration('20270115000100_invoice_autofill'));
  assert.equal((await row('select kind from public.receipt_autofill_usage')).kind,'receipt');
});
beforeEach(async()=>{
  await db.exec('truncate public.receipt_autofill_usage;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other Co','OC-1')",[company,other]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew','c@x'),($3,'Outsider','x@x')",[owner,crew,outsider]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($6,$7,$5)',[company,owner,'owner',crew,'fire_fighter',other,outsider]);
});
after(async()=>{await db.close()});

test('invoice auto-fill follows the receipt auto-fill switch and is open to every member',async()=>{
  assert.equal(await invoice(company,crew),'disabled');
  await enable();
  assert.equal(await invoice(company,crew),'ok');
  assert.equal(await invoice(company,owner),'ok');
  assert.equal(await invoice(company,outsider),'not_member');
  assert.equal(await invoice(other,outsider),'disabled');
  assert.deepEqual((await db.query('select user_id,kind from public.receipt_autofill_usage order by id')).rows,[{user_id:crew,kind:'invoice'},{user_id:owner,kind:'invoice'}]);
});

test('receipt claims are still logged as receipts',async()=>{
  await enable();
  assert.equal(await receipt(company,crew),'ok');
  assert.equal((await row('select kind from public.receipt_autofill_usage')).kind,'receipt');
});

test('invoices and receipts share the per-person daily limit',async()=>{
  await enable();
  await db.query("insert into public.receipt_autofill_usage(company_id,user_id,kind) select $1,$2,'receipt' from generate_series(1,199)",[company,crew]);
  assert.equal(await invoice(company,crew),'ok');
  assert.equal(await invoice(company,crew),'limit');
  assert.equal(await receipt(company,crew),'limit');
  assert.equal(await invoice(company,owner),'ok');
  await db.query("update public.receipt_autofill_usage set created_at=now()-interval '25 hours' where user_id=$1",[crew]);
  assert.equal(await invoice(company,crew),'ok');
});

test('invoices and receipts share the company daily limit',async()=>{
  await enable();
  await db.query("insert into public.receipt_autofill_usage(company_id,user_id,kind) select $1,$2,'invoice' from generate_series(1,2000)",[company,owner]);
  assert.equal(await receipt(company,crew),'limit');
  assert.equal(await invoice(company,crew),'limit');
});

test('only the known kinds can be logged',async()=>{
  await assert.rejects(db.query("insert into public.receipt_autofill_usage(company_id,user_id,kind) values($1,$2,'payroll')",[company,crew]));
});

test('clients cannot claim invoice auto-fill or read usage directly',async()=>{
  await enable();
  await assert.rejects(actor(crew,()=>db.query('select public.claim_invoice_autofill($1,$2)',[company,crew])));
  await assert.rejects(actor(crew,()=>db.query('select * from public.receipt_autofill_usage')));
});

test('every member can add an invoice customer; only owners and accounting rename or delete',async()=>{
  const add=(user,companyId,name)=>actor(user,()=>db.query('insert into public.invoice_customers(id,company_id,name) values($1,$2,$3) returning id',[randomUUID(),companyId,name]));
  const id=(await add(crew,company,'Pine Valley Fire District')).rows[0].id;
  await add(owner,company,'County');
  await assert.rejects(add(outsider,company,'Elsewhere'),error=>error.code==='42501');
  await assert.rejects(add(crew,other,'Elsewhere'),error=>error.code==='42501');
  await assert.rejects(add(crew,company,'pine valley fire district'),error=>error.code==='23505');
  assert.equal((await actor(crew,()=>db.query("update public.invoice_customers set name='Renamed' where id=$1 returning id",[id]))).rows.length,0);
  assert.equal((await actor(crew,()=>db.query('delete from public.invoice_customers where id=$1 returning id',[id]))).rows.length,0);
  assert.equal((await actor(owner,()=>db.query("update public.invoice_customers set name='Pine Valley FD' where id=$1 returning id",[id]))).rows.length,1);
});
