import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// The person who submitted an invoice is told, and pushed, when it is marked
// paid (20270103000100), whatever their role. Nobody is notified of their own action.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004';
const customer='30000000-0000-4000-8000-000000000001';
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const inbox=async user=>(await db.query("select n.event_type,n.path,n.title,j.id is not null pushed from public.user_notifications n left join public.push_notification_jobs j on j.notification_id=n.id where n.user_id=$1 and n.dedupe_key like 'invoice-paid:%'",[user])).rows;
async function submitted(user){
  const id=randomUUID();
  await actor(user,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id) values($1,$2,$3,'Someone','INV-7','2026-10-01',100,$4)",[id,company,user,customer]));
  await actor(user,()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id]));
  return id;
}
before(async()=>{
  await loadGuardedEditSchema(db);
  const accountingRole=migration('20261225000100_accounting_role');
  await db.exec(accountingRole.slice(0,accountingRole.indexOf('-- Payroll and invoice files'))+'commit;');
  const delivery=migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(delivery.slice(delivery.indexOf('create table public.push_notification_jobs'),delivery.indexOf('create index push_notification_jobs_ready_idx')));
  await db.exec('drop function public.create_user_notification(uuid,uuid,uuid,text,text,uuid,text,text,text,text,text)');
  await db.exec(migration('20261226000100_payroll_rejected_notifications'));
  const paid=migration('20270101000100_invoice_due_and_paid');
  await db.exec(paid.slice(0,paid.indexOf('-- Creators keep their files'))+'commit;');
  await db.exec(migration('20270103000100_invoice_paid_notifications'));
});
beforeEach(async()=>{
  await db.exec('truncate public.user_notifications cascade;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Accounting','b@x'),($3,'Crew','c@x')",[owner,accounting,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',accounting,'accounting',crew,'fire_fighter']);
  await db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[customer,company]);
});
after(async()=>{await db.close()});

test('crew are notified and pushed when their invoice is marked paid',async()=>{
  const id=await submitted(crew);
  await actor(accounting,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  assert.deepEqual(await inbox(crew),[{event_type:'invoice_paid',path:'/invoices',title:'Invoice paid',pushed:true}]);
  assert.deepEqual(await inbox(accounting),[]);
});

test('marking your own invoice paid sends no notification',async()=>{
  const id=await submitted(owner);
  await actor(owner,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  assert.deepEqual(await inbox(owner),[]);
});
