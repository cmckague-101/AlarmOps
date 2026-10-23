import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadReceiptSchema} from './fixtures/fleet-sync-harness.mjs';
// Uploaders may delete only orphaned files in their own folder; files behind
// saved receipt, invoice-document, payroll-document or submitted payroll-form
// records stay (20261211000100 fixes the unqualified name comparison).
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const put=(bucket,path)=>actor(crew,()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,'{\"size\":10}')",[bucket,path,crew]));
const remaining=async bucket=>(await db.query('select name from storage.objects where bucket_id=$1 order by name',[bucket])).rows.map(item=>item.name);
const removeAll=bucket=>actor(crew,()=>db.query('delete from storage.objects where bucket_id=$1',[bucket]));
const file=suffix=>`${company}/${crew}/${suffix}`;
before(async()=>{await loadReceiptSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1)',[company]);
  await db.query('insert into public.profiles values($1,$2),($3,$4)',[owner,'Owner',crew,'Crew']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

for(const [bucket,table] of [['receipt-files','company_receipts'],['invoices-files','company_invoices'],['payroll-files','company_payroll']]){
  test(`${bucket}: saved records keep their files; orphans can still be removed`,async()=>{
    await put(bucket,file('saved.pdf'));await put(bucket,file('orphan.pdf'));
    const extra=table==='company_receipts'?', amount_cents':'';
    await actor(crew,()=>db.query(`insert into public.${table}(company_id,name,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name${extra}) values($1,'Saved','saved.pdf','application/pdf',10,$2,$3,''${extra?',100':''})`,[company,file('saved.pdf'),crew]));
    await removeAll(bucket);assert.deepEqual(await remaining(bucket),[file('saved.pdf')]);
  });
}
test('payroll form attachments are kept once submitted',async()=>{
  const form=randomUUID();const attachment={name:'a.pdf',mimeType:'application/pdf',byteSize:10,storagePath:file(`forms/${form}/a.pdf`)};
  await put('payroll-files',attachment.storagePath);
  const rows=JSON.stringify(Array.from({length:21},()=>({date:'',hoursWorked:0,crewIds:[],notes:''})));
  await actor(crew,()=>db.query("insert into public.payroll_forms(id,company_id,created_by,created_by_name,rows,attachment) values($1,$2,$3,'Crew',$4,$5)",[form,company,crew,rows,JSON.stringify(attachment)]));
  await actor(crew,()=>db.query("update public.payroll_forms set status='pending' where id=$1",[form]));
  await removeAll('payroll-files');assert.deepEqual(await remaining('payroll-files'),[attachment.storagePath]);
});
