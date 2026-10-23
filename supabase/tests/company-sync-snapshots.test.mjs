import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCompanySnapshotSchema} from './fixtures/fleet-sync-harness.mjs';
// Verified company-list downloads: existing row-level security decides what each
// role sees; the watermark covers the caller's own applied commands.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const snapshot=(user,section,target=company)=>actor(user,async()=>(await row('select public.get_company_sync_snapshot($1,$2) result',[target,section])).result);
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const days=()=>Array.from({length:21},()=>({date:'',hoursWorked:0,crewIds:[],notes:''}));
before(async()=>{await loadCompanySnapshotSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate storage.objects;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1'),($2,'Other','OT-1')",[company,other]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x'),($3,'Tech','t@x'),($4,'Outsider','x@x')",[owner,crew,tech,outsider]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('inventory and training sections carry the stores\' columns and the caller\'s own reads',async()=>{
  const item=randomUUID();await actor(owner,()=>db.query("insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,'Gloves',5)",[item,company]));
  const course=randomUUID();await actor(owner,()=>db.query("insert into public.company_trainings(id,company_id,course_code,course_title,starts_at,location,instructor,capacity,created_by) values($1,$2,'S-130','Training',now()+interval '7 days','Station','Lee',3,$3)",[course,company,owner]));
  await send(crew,command(crew,'inventory_checkout',item,'checkout.add',{quantity:2}));await send(crew,command(crew,'training_signup',course,'signup.join',{}));
  const inventory=await snapshot(crew,'inventory');
  assert.deepEqual(Object.keys(inventory).sort(),['companyId','receiptWatermark','schemaVersion','section','serverRequestAt','tables','userId']);
  assert.equal(inventory.receiptWatermark,'2');assert.equal(inventory.userId,crew);
  assert.deepEqual(Object.keys(inventory.tables.company_inventory_items[0]).sort(),['created_at','id','name','quantity','updated_at']);
  assert.deepEqual(inventory.tables.company_inventory_checkouts.map(item=>[item.user_id,item.quantity]),[[crew,2]]);
  const training=await snapshot(crew,'training');assert.equal(training.tables.company_trainings[0].id,course);assert.equal(training.tables.company_training_signups[0].user_id,crew);
  assert.deepEqual(training.tables.company_training_reads,[]);
});
test('financial sections follow existing row-level security per role',async()=>{
  await send(crew,command(crew,'payroll_form',randomUUID(),'form.save',{engineNumber:'E-1',rows:days()}));
  await send(tech,command(tech,'payroll_form',randomUUID(),'form.save',{engineNumber:'T-1',rows:days()}));
  await send(crew,command(crew,'invoice_form',randomUUID(),'form.save',{invoiceNumber:'INV-1'}));
  assert.deepEqual((await snapshot(crew,'payroll')).tables.payroll_forms.map(form=>form.engine_number),['E-1']);
  assert.deepEqual((await snapshot(owner,'payroll')).tables.payroll_forms.map(form=>form.engine_number).sort(),['E-1','T-1']);
  assert.deepEqual((await snapshot(tech,'invoices')).tables.invoice_forms,[]);assert.equal((await snapshot(owner,'invoices')).tables.invoice_forms.length,1);
  const receipts=await snapshot(crew,'receipts');assert.deepEqual(receipts.tables.company_receipts,[]);
});
test('Crew Chat and the notification inbox carry the caller\'s own reads, preferences and latest 500 notifications',async()=>{
  const thread=randomUUID();
  await db.exec('alter table public.communication_threads disable trigger communication_threads_attribution');
  await db.query("insert into public.communication_threads(id,company_id,subject,description,created_by,created_by_name,created_by_role,created_at) values($1,$2,'Subject','Body',$3,'Owner','owner',now())",[thread,company,owner]);
  await db.exec('alter table public.communication_threads enable trigger communication_threads_attribution');
  await send(crew,command(crew,'communication_reply',randomUUID(),'reply.create',{threadId:thread,body:'On it'}));
  await send(crew,command(crew,'communication_read',thread,'communication.seen',{seenThrough:new Date().toISOString()}));
  const chat=await snapshot(crew,'crew_chat');
  assert.deepEqual(chat.tables.communication_threads.map(item=>item.id),[thread]);assert.equal(chat.tables.communication_replies[0].body,'On it');
  assert.equal(chat.tables.communication_reads.length,1);assert.equal((await snapshot(owner,'crew_chat')).tables.communication_reads.length,0);
  await db.query("insert into public.user_notifications(company_id,user_id,event_type,entity_type,title,body,path,group_key,dedupe_key,created_at) select $1,$2,'system','system','T'||g,'B','/x','g','d'||g,now()-g*interval '1 minute' from generate_series(1,501) g",[company,crew]);
  await send(crew,command(crew,'notification_preferences',crew,'preferences.set',{changes:{pushEnabled:false}}));
  const inbox=await snapshot(crew,'notifications');
  assert.equal(inbox.tables.user_notifications.length,500);assert.equal(inbox.tables.user_notifications[0].title,'T1');
  assert.deepEqual(inbox.tables.notification_preferences,[{push_enabled:false,communication_replies:true,document_added:true,training_created:true,issue_updates:true}]);
  assert.deepEqual((await snapshot(owner,'notifications')).tables,{user_notifications:[],notification_preferences:[]});
});
test('outsiders, other companies and unknown sections are refused; large sections are not truncated',async()=>{
  await assert.rejects(snapshot(outsider,'inventory'),error=>error.code==='42501');
  await assert.rejects(snapshot(crew,'inventory',other),error=>error.code==='42501');
  await assert.rejects(snapshot(crew,'tasks'),error=>error.code==='22023');
  await actor(owner,()=>db.query("insert into public.company_inventory_items(company_id,name,quantity) select $1,'Item '||g,1 from generate_series(1,5001) g",[company]));
  await assert.rejects(snapshot(crew,'inventory'),error=>error.code==='54000');
});
