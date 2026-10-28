import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Crew receive (and are pushed) their returned payroll; submissions reach only
// owners and accounting, through the real notification function.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',admin='20000000-0000-4000-8000-000000000002',accounting='20000000-0000-4000-8000-000000000003',crew='20000000-0000-4000-8000-000000000004';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);await db.exec('set local role authenticated');const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const inbox=async user=>(await db.query('select n.event_type,n.path,j.id is not null pushed from public.user_notifications n left join public.push_notification_jobs j on j.notification_id=n.id where n.user_id=$1 order by n.created_at',[user])).rows;
before(async()=>{
  await loadGuardedEditSchema(db);
  const accountingRole=migration('20261225000100_accounting_role');
  await db.exec(accountingRole.slice(0,accountingRole.indexOf('-- Payroll and invoice files'))+'commit;');
  const delivery=migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(delivery.slice(delivery.indexOf('create table public.push_notification_jobs'),delivery.indexOf('create index push_notification_jobs_ready_idx')));
  await db.exec('drop function public.create_user_notification(uuid,uuid,uuid,text,text,uuid,text,text,text,text,text)');
  await db.exec(migration('20261226000100_payroll_rejected_notifications'));
});
beforeEach(async()=>{
  await db.exec('truncate public.user_notifications cascade;truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Admin','a@x'),($3,'Accounting','b@x'),($4,'Crew','c@x')",[owner,admin,accounting,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$8,$9)',[company,owner,'owner',admin,'admin',accounting,'accounting',crew,'fire_fighter']);
});
after(async()=>{await db.close()});

test('submitted payroll notifies owner and accounting; returned payroll notifies and pushes to the crew member',async()=>{
  const days=Array.from({length:21},()=>({date:'',hoursWorked:0,crewIds:[],notes:''}));const form=randomUUID();
  await send(crew,command(crew,'payroll_form',form,'form.save',{rows:days}));await send(crew,command(crew,'payroll_form',form,'form.submit',{}));
  assert.deepEqual(await inbox(accounting),[{event_type:'system',path:'/payroll',pushed:true}]);
  assert.equal((await inbox(owner)).length,1);
  assert.deepEqual(await inbox(admin),[]);
  assert.deepEqual(await inbox(crew),[]);
  const base={updatedAt:(await row("select to_json(updated_at)#>>'{}' value from public.payroll_forms where id=$1",[form])).value};
  await send(accounting,command(accounting,'payroll_review',form,'review.reject',{base,notes:'Missing hours'}));
  assert.deepEqual(await inbox(crew),[{event_type:'payroll_rejected',path:'/payroll',pushed:true}]);
});
