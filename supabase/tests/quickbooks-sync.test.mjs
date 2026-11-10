import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// QuickBooks Online sync (20270117000100): only the QuickBooks edge functions
// (service role) write invoice QuickBooks fields; member edits to a synced
// invoice mark it out of sync; QuickBooks can mark a submitted invoice paid
// (paid_by null, 'QuickBooks') but never un-pay it; FireOps payments on synced
// invoices queue a QuickBooks payment; settings, mappings and tokens stay
// owner/accounting-readable or server-only.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004';
const customer='30000000-0000-4000-8000-000000000001',customer2='30000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
async function service(task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true)");await db.exec('set local role service_role');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const invoice=id=>row("select status,invoice_number,invoice_amount::int amount,paid_by,paid_by_name,paid_at is not null paid,qbo_invoice_id,qbo_sync_token,qbo_sync_status,qbo_last_error,qbo_payment_id,qbo_payment_pending,qbo_sync_requested_at is not null requested from public.invoice_forms where id=$1",[id]);
async function draft(){
  const id=randomUUID();
  await actor(crew,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id) values($1,$2,$3,'Crew','INV-1','2026-10-01',100,$4)",[id,company,crew,customer]));
  return id;
}
async function submitted(){
  const id=await draft();
  await actor(crew,()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id]));
  return id;
}
let qboId=100;
const synced=async id=>{qboId+=1;await service(()=>db.query("update public.invoice_forms set qbo_invoice_id=$2,qbo_sync_token='0',qbo_sync_status='synced',qbo_synced_at=now() where id=$1",[id,String(qboId)]));return id};
before(async()=>{
  await loadGuardedEditSchema(db);
  const accountingSql=migration('20261225000100_accounting_role');
  await db.exec(accountingSql.slice(0,accountingSql.indexOf('-- Payroll and invoice files'))+'commit;');
  const dueSql=migration('20270101000100_invoice_due_and_paid');
  await db.exec(dueSql.slice(0,dueSql.indexOf('-- Creators keep their files'))+'commit;');
  const paidSql=migration('20270103000100_invoice_paid_notifications');
  await db.exec(paidSql.slice(paidSql.indexOf('create or replace function public.notify_paid_invoice')));
  await db.exec(migration('20270107000100_invoice_edit_submitted'));
  await db.exec(migration('20270117000100_quickbooks_sync'));
});
beforeEach(async()=>{
  await db.exec('truncate public.test_notifications;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other Co','OC-1')",[company,otherCompany]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Accounting','b@x'),($4,'Crew','c@x')",[owner,admin,accounting,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9)',[company,owner,'owner',admin,'admin',accounting,'accounting',crew,'fire_fighter']);
  await db.query("insert into public.invoice_customers(id,company_id,name) values($1,$3,'County'),($2,$3,'City')",[customer,customer2,company]);
});
after(async()=>{await db.close()});

test('members cannot write QuickBooks fields on insert or update',async()=>{
  const id=randomUUID();
  await actor(crew,()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number,invoice_date,invoice_amount,customer_id,qbo_invoice_id,qbo_sync_status,qbo_payment_pending) values($1,$2,$3,'Crew','INV-1','2026-10-01',100,$4,'99','synced',true)",[id,company,crew,customer]));
  assert.deepEqual(await invoice(id),{status:'draft',invoice_number:'INV-1',amount:100,paid_by:null,paid_by_name:null,paid:false,qbo_invoice_id:null,qbo_sync_token:null,qbo_sync_status:'not_synced',qbo_last_error:null,qbo_payment_id:null,qbo_payment_pending:false,requested:false});
  await actor(crew,()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id]));
  await actor(owner,()=>db.query("update public.invoice_forms set qbo_invoice_id='99',qbo_sync_status='synced',qbo_payment_id='5' where id=$1",[id]));
  const after=await invoice(id);
  assert.equal(after.qbo_invoice_id,null);assert.equal(after.qbo_sync_status,'not_synced');assert.equal(after.qbo_payment_id,null);
});

test('the QuickBooks service writes only QuickBooks fields and never creates invoices',async()=>{
  const id=await submitted();
  await service(()=>db.query("update public.invoice_forms set qbo_invoice_id='145',qbo_sync_token='3',qbo_sync_status='synced',invoice_amount=1,invoice_number='HACK',created_by=$2 where id=$1",[id,owner]));
  const after=await invoice(id);
  assert.equal(after.qbo_invoice_id,'145');assert.equal(after.qbo_sync_token,'3');assert.equal(after.qbo_sync_status,'synced');
  assert.equal(after.amount,100);assert.equal(after.invoice_number,'INV-1');
  await assert.rejects(service(()=>db.query("insert into public.invoice_forms(id,company_id,created_by,created_by_name,invoice_number) values($1,$2,$3,'X','N')",[randomUUID(),company,crew])),error=>error.code==='42501');
  await assert.rejects(service(()=>db.query("update public.invoice_forms set status='draft' where id=$1",[id])),error=>error.code==='42501');
});

test('member edits to a synced field mark a synced invoice out of sync',async()=>{
  const id=await synced(await submitted());
  await actor(accounting,()=>db.query("update public.invoice_forms set invoice_amount=100 where id=$1",[id]));
  assert.equal((await invoice(id)).qbo_sync_status,'synced','saving the same values keeps it synced');
  await actor(crew,()=>db.query("update public.invoice_forms set invoice_amount=250 where id=$1",[id]));
  assert.equal((await invoice(id)).qbo_sync_status,'out_of_sync');
  const other=await synced(await submitted());
  await actor(owner,()=>db.query("update public.invoice_forms set customer_id=$2 where id=$1",[other,customer2]));
  assert.equal((await invoice(other)).qbo_sync_status,'out_of_sync');
  const attached=await synced(await submitted());
  await actor(crew,()=>db.query("update public.invoice_forms set attachment=jsonb_build_object('name','a.pdf','mimeType','application/pdf','byteSize',1,'storagePath',$2::text) where id=$1",[attached,`${company}/${crew}/forms/${attached}/a.pdf`]));
  assert.equal((await invoice(attached)).qbo_sync_status,'out_of_sync');
  const unsynced=await submitted();
  await actor(crew,()=>db.query("update public.invoice_forms set invoice_amount=5 where id=$1",[unsynced]));
  assert.equal((await invoice(unsynced)).qbo_sync_status,'not_synced');
});

test('QuickBooks marks a submitted invoice paid as QuickBooks, and paid stays read only',async()=>{
  const id=await synced(await submitted());
  await service(()=>db.query("update public.invoice_forms set status='paid',paid_by=$2,paid_by_name='Someone' where id=$1",[id,owner]));
  const paid=await invoice(id);
  assert.equal(paid.status,'paid');assert.equal(paid.paid,true);assert.equal(paid.paid_by,null);assert.equal(paid.paid_by_name,'QuickBooks');
  assert.equal(paid.qbo_payment_pending,false,'a QuickBooks payment is not sent back to QuickBooks');
  assert.equal((await row("select count(*)::int n from public.test_notifications where title='Invoice paid'")).n,1,'the creator is told it was paid');
  assert.equal((await actor(owner,()=>db.query("update public.invoice_forms set invoice_amount=5 where id=$1 returning id",[id]))).rows.length,0);
  // A payment deleted in QuickBooks flags the invoice; nothing un-pays it.
  await service(()=>db.query("update public.invoice_forms set qbo_sync_status='needs_attention',qbo_last_error='Payment deleted' where id=$1",[id]));
  assert.equal((await invoice(id)).qbo_sync_status,'needs_attention');
  await assert.rejects(service(()=>db.query("update public.invoice_forms set status='submitted' where id=$1",[id])),error=>error.code==='42501');
  assert.equal((await invoice(id)).status,'paid');
});

test('marking a synced invoice paid in FireOps queues one QuickBooks payment',async()=>{
  const id=await synced(await submitted());
  await actor(accounting,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  const paid=await invoice(id);
  assert.equal(paid.paid_by,accounting);assert.equal(paid.qbo_payment_pending,true);
  await service(()=>db.query("update public.invoice_forms set qbo_payment_pending=false,qbo_payment_id='77' where id=$1",[id]));
  assert.deepEqual([(await invoice(id)).qbo_payment_pending,(await invoice(id)).qbo_payment_id],[false,'77']);
  const unsynced=await submitted();
  await actor(owner,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[unsynced]));
  assert.equal((await invoice(unsynced)).qbo_payment_pending,false);
});

test('companies syncing on submit queue the invoice when it is submitted',async()=>{
  await db.query("insert into public.company_qbo_settings(company_id,realm_id,connected,sync_mode) values($1,'9130',true,'on_submit')",[company]);
  assert.equal((await invoice(await submitted())).requested,false,'add-on off');
  await db.query('update public.companies set quickbooks_enabled=true where id=$1',[company]);
  const id=await submitted();
  assert.equal((await invoice(id)).requested,true);
  await db.query("update public.company_qbo_settings set sync_mode='manual' where company_id=$1",[company]);
  assert.equal((await invoice(await submitted())).requested,false);
});

test('one QuickBooks write at a time per invoice',async()=>{
  const id=await submitted();
  const claim=()=>service(async()=>(await row('select public.claim_qbo_invoice_sync($1) ok',[id])).ok);
  assert.equal(await claim(),true);
  assert.equal(await claim(),false);
  await service(()=>db.query('select public.release_qbo_invoice_sync($1)',[id]));
  assert.equal(await claim(),true);
  await db.query("update public.qbo_sync_locks set locked_until=now()-interval '1 second'");
  assert.equal(await claim(),true,'an expired lock can be taken');
  await assert.rejects(actor(owner,()=>db.query('select public.claim_qbo_invoice_sync($1)',[id])),error=>error.code==='42501');
});

test('owners and accounting read settings and mappings; tokens stay server only',async()=>{
  await db.query("insert into public.company_qbo_settings(company_id,realm_id,connected,item_id,item_name) values($1,'9130',true,'1','Services')",[company]);
  await db.query("insert into public.company_qbo_customer_mappings(company_id,customer_id,qbo_customer_id,qbo_customer_name) values($1,$2,'58','County of X')",[company,customer]);
  await db.query("insert into public.company_qbo_connections(company_id,realm_id,encrypted_access_token,access_token_iv,encrypted_refresh_token,refresh_token_iv,token_expires_at) values($1,'9130','a','b','c','d',now())",[company]);
  for(const user of [owner,accounting]){
    assert.equal((await actor(user,()=>db.query('select item_id from public.company_qbo_settings'))).rows.length,1);
    assert.equal((await actor(user,()=>db.query('select qbo_customer_id from public.company_qbo_customer_mappings'))).rows.length,1);
  }
  for(const user of [admin,crew]){
    assert.equal((await actor(user,()=>db.query('select item_id from public.company_qbo_settings'))).rows.length,0);
    assert.equal((await actor(user,()=>db.query('select qbo_customer_id from public.company_qbo_customer_mappings'))).rows.length,0);
  }
  await assert.rejects(actor(owner,()=>db.query("update public.company_qbo_settings set sync_mode='on_submit'")),error=>error.code==='42501');
  await assert.rejects(actor(accounting,()=>db.query("insert into public.company_qbo_customer_mappings(company_id,customer_id,qbo_customer_id,qbo_customer_name) values($1,$2,'1','X')",[company,customer2])),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('select * from public.company_qbo_connections')),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('select * from public.company_qbo_oauth_states')),error=>error.code==='42501');
  await assert.rejects(actor(owner,()=>db.query('update public.companies set quickbooks_enabled=true where id=$1',[company])));
});

test('reconnecting to another QuickBooks company clears old links',async()=>{
  await db.query("insert into public.company_qbo_settings(company_id,realm_id,connected,item_id,item_name) values($1,'9130',true,'1','Services')",[company]);
  await db.query("insert into public.company_qbo_customer_mappings(company_id,customer_id,qbo_customer_id,qbo_customer_name) values($1,$2,'58','County of X')",[company,customer]);
  const id=await synced(await submitted());
  await actor(owner,()=>db.query("update public.invoice_forms set status='paid' where id=$1",[id]));
  await service(()=>db.query('select public.reset_company_qbo_links($1)',[company]));
  const after=await invoice(id);
  assert.equal(after.status,'paid');assert.equal(after.qbo_invoice_id,null);assert.equal(after.qbo_sync_status,'not_synced');assert.equal(after.qbo_payment_pending,false);
  assert.equal((await row('select count(*)::int n from public.company_qbo_customer_mappings')).n,0);
  assert.equal((await row('select item_id from public.company_qbo_settings')).item_id,null);
});
