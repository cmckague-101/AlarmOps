import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadInvoiceSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline invoices: the creator's draft is created/merged per field and submitted
// through the real protect trigger; submitted, deleted, incomplete or
// customer-less work is never applied and the device is told why.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function command(user,formId,cmd='form.save',payload={}){
  return {schemaVersion:1,operationId:randomUUID(),companyId:company,entityType:'invoice_form',entityId:formId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const invoice=id=>row('select status,invoice_number,invoice_date::text,invoice_amount::text amount,customer_id,created_by_name from public.invoice_forms where id=$1',[id]);
let customer;
before(async()=>{await loadInvoiceSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade;truncate public.test_notifications');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew Person',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
  customer=randomUUID();await actor(owner,()=>db.query("insert into public.invoice_customers(id,company_id,name) values($1,$2,'County')",[customer,company]));
});
after(async()=>{await db.close()});

test('creates the draft, merges later saves per field, submits and notifies managers',async()=>{
  const id=randomUUID();const first=command(crew,id,'form.save',{invoiceNumber:'INV-7',invoiceAmount:1250.5});const created=await send(first);
  assert.equal(created.notApplied,undefined);assert.equal(created.record.status,'draft');assert.equal(created.record.invoiceDate,'');
  assert.equal((await send(command(crew,id,'form.save',{invoiceDate:'2026-07-04',customerId:customer}))).record.invoiceNumber,'INV-7');
  assert.deepEqual(await send(first),created);
  assert.deepEqual(await invoice(id),{status:'draft',invoice_number:'INV-7',invoice_date:'2026-07-04',amount:'1250.50',customer_id:customer,created_by_name:'Crew Person'});
  const submitted=await send(command(crew,id,'form.submit'));assert.equal(submitted.notApplied,undefined);assert.equal(submitted.record.status,'submitted');
  assert.deepEqual((await db.query('select user_id from public.test_notifications')).rows.map(item=>item.user_id),[owner]);
  assert.equal((await send(command(crew,id,'form.save',{invoiceNumber:'late'}))).notApplied,'already_submitted');assert.equal((await invoice(id)).invoice_number,'INV-7');
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,undefined);
});
test('incomplete submissions and removed customers change nothing',async()=>{
  const id=randomUUID();await send(command(crew,id,'form.save',{invoiceNumber:'INV-8'}));
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,'incomplete');assert.equal((await invoice(id)).status,'draft');
  const gone=randomUUID();assert.equal((await send(command(crew,id,'form.save',{customerId:gone,invoiceNumber:'INV-9'}))).notApplied,'customer_deleted');
  assert.equal((await invoice(id)).invoice_number,'INV-8');
  assert.equal((await send(command(crew,id,'form.save',{customerId:customer}))).record.customerId,customer);
  assert.equal((await send(command(crew,id,'form.save',{customerId:''}))).record.customerId,'');
});
test('deleted invoices are never recreated; a second draft is refused',async()=>{
  const id=randomUUID();await send(command(crew,id,'form.save',{invoiceNumber:'A'}));
  await actor(crew,()=>db.query('delete from public.invoice_forms where id=$1',[id]));
  assert.equal((await send(command(crew,id,'form.save',{invoiceNumber:'B'}))).notApplied,'form_deleted');assert.equal(await invoice(id),undefined);
  assert.equal((await send(command(crew,id,'form.submit'))).notApplied,'form_deleted');
  await send(command(crew,randomUUID(),'form.save',{invoiceNumber:'web'}));
  const second=randomUUID();assert.equal((await send(command(crew,second,'form.save',{invoiceNumber:'phone'}))).notApplied,'other_draft');assert.equal(await invoice(second),undefined);
});
test('invalid payloads, foreign invoices and outsiders are refused',async()=>{
  const id=randomUUID();
  for(const payload of [{},{status:'submitted'},{invoiceAmount:-1},{invoiceAmount:1.005},{invoiceAmount:'5'},{invoiceDate:'2026-02-30'},{customerId:'x'},{invoiceNumber:'x'.repeat(161)}])
    await assert.rejects(send(command(crew,id,'form.save',payload)),error=>['22023','22008'].includes(error.code),JSON.stringify(payload));
  await assert.rejects(send(command(crew,id,'form.submit',{now:true})),error=>error.code==='22023');
  await send(command(tech,id,'form.save',{invoiceNumber:'tech'}));
  await assert.rejects(send(command(crew,id,'form.save',{invoiceNumber:'crew'})),error=>error.code==='23505');
  assert.equal((await invoice(id)).invoice_number,'tech');
  await assert.rejects(send(command(outsider,randomUUID(),'form.save',{invoiceNumber:'x'})),error=>error.code==='42501');
});
