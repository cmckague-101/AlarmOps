import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Editing submitted invoices (20270107000100): the creator and finance processors
// edit an unpaid submitted invoice; it stays submitted and keeps its author and
// submission time. Other members, paid invoices and offline saves stay locked.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004',crew2='20000000-0000-4000-8000-000000000005';
const customer='30000000-0000-4000-8000-000000000001',customer2='30000000-0000-4000-8000-000000000002',foreignCustomer='30000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'invoice_form',entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const invoice=id=>row("select status,invoice_number,invoice_amount::int amount,customer_id,due_date::text due,created_by,created_by_name,submitted_at,paid_at from public.invoice_forms where id=$1",[id]);
const edit=(user,id,set)=>actor(user,()=>db.query(`update public.invoice_forms set ${set} where id=$1 returning id`,[id]));
async function submitted(){
  const id=randomUUID();
  await actor(crew,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id) values($1,$2,$3,'Crew','INV-1','2026-10-01',100,$4)",[id,company,crew,customer]));
  await actor(crew,()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id]));
  return id;
}
before(async()=>{
  await loadGuardedEditSchema(db);
  const accountingSql=migration('20261225000100_accounting_role');
  await db.exec(accountingSql.slice(0,accountingSql.indexOf('-- Payroll and invoice files'))+'commit;');
  // Storage policies are not part of this fixture.
  const dueSql=migration('20270101000100_invoice_due_and_paid');
  await db.exec(dueSql.slice(0,dueSql.indexOf('-- Creators keep their files'))+'commit;');
  await db.exec(migration('20270107000100_invoice_edit_submitted'));
});
beforeEach(async()=>{
  await db.exec('truncate public.test_notifications;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other Co','OC-1')",[company,otherCompany]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Accounting','b@x'),($4,'Crew','c@x'),($5,'Crew Two','d@x')",[owner,admin,accounting,crew,crew2]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9),($1,$10,$9)',[company,owner,'owner',admin,'admin',accounting,'accounting',crew,'fire_fighter',crew2]);
  await db.query("insert into public.invoice_customers(id,company_id,name) values($1,$3,'County'),($2,$3,'City'),($4,$5,'Elsewhere')",[customer,customer2,company,foreignCustomer,otherCompany]);
});
after(async()=>{await db.close()});

test('the creator edits a submitted invoice and it stays submitted',async()=>{
  const id=await submitted();
  const before=await invoice(id);
  assert.equal((await edit(crew,id,"invoice_number='INV-1A',invoice_amount=250,customer_id='"+customer2+"',due_date='2026-12-01'")).rows.length,1);
  const after=await invoice(id);
  assert.deepEqual({...after,submitted_at:String(after.submitted_at)},{...before,submitted_at:String(before.submitted_at),invoice_number:'INV-1A',amount:250,customer_id:customer2,due:'2026-12-01'});
});

test('owners and accounting edit any submitted invoice without changing its author',async()=>{
  const id=await submitted();
  assert.equal((await edit(accounting,id,"invoice_amount=300,created_by='"+accounting+"',created_by_name='Someone'")).rows.length,1);
  assert.equal((await edit(owner,id,"invoice_number='INV-OWN'")).rows.length,1);
  const after=await invoice(id);
  assert.equal(after.amount,300);assert.equal(after.invoice_number,'INV-OWN');
  assert.equal(after.created_by,crew);assert.equal(after.created_by_name,'Crew');assert.equal(after.status,'submitted');
});

test('admins and other crew cannot edit someone else\'s submitted invoice',async()=>{
  const id=await submitted();
  assert.equal((await edit(admin,id,'invoice_amount=1')).rows.length,0);
  assert.equal((await edit(crew2,id,'invoice_amount=1')).rows.length,0);
  assert.equal((await invoice(id)).amount,100);
});

test('creators cannot mark paid or reopen a submitted invoice as a draft',async()=>{
  const id=await submitted();
  await assert.rejects(edit(crew,id,"status='paid'"));
  await assert.rejects(edit(crew,id,"status='draft'"));
  assert.equal((await invoice(id)).status,'submitted');
});

test('edits keep a submitted invoice complete and its customer in the company',async()=>{
  const id=await submitted();
  await assert.rejects(edit(crew,id,'invoice_amount=0'),/positive amount/);
  await assert.rejects(edit(crew,id,'customer_id=null'),/customer are required/);
  await assert.rejects(edit(accounting,id,"customer_id='"+foreignCustomer+"'"),/Customer must belong to company/);
});

test('marking paid still works and paid invoices stay read only',async()=>{
  const id=await submitted();
  const paid=await actor(accounting,()=>row("update public.invoice_forms set status='paid',invoice_amount=1 where id=$1 returning status,invoice_amount::int amount,paid_by",[id]));
  assert.deepEqual(paid,{status:'paid',amount:100,paid_by:accounting});
  assert.equal((await edit(crew,id,'invoice_amount=5')).rows.length,0);
  assert.equal((await edit(accounting,id,'invoice_amount=5')).rows.length,0);
  assert.equal((await invoice(id)).amount,100);
});

test('offline saves still only apply to drafts',async()=>{
  const id=await submitted();
  assert.equal((await send(crew,command(crew,id,'form.save',{invoiceNumber:'INV-9'}))).notApplied,'already_submitted');
  assert.equal((await invoice(id)).invoice_number,'INV-1');
});
