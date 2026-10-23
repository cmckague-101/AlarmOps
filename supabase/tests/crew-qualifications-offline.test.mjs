import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadCrewQualificationSchema} from './fixtures/fleet-sync-harness.mjs';
// Offline own qualification records without files: the real self-service
// functions validate; edits/deletes apply only to the entry seen.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const credential=(id,changes={})=>({id,name:'S-130',recordType:'Training',courseCode:'S-130',completionDate:'2026-05-01',provider:'NWCG',...changes});
const crewData=async()=>(await row('select data from public.fleet_crew where record_id=$1',[crew])).data;
before(async()=>{await loadCrewQualificationSchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x')",[owner,crew]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5)',[company,owner,'owner',crew,'fire_fighter']);
  await db.query("insert into public.fleet_crew(company_id,record_id,data,version,updated_by) values($1,$2,$3,1,$4)",[company,crew,JSON.stringify({id:crew,name:'Crew Person'}),owner]);
});
after(async()=>{await db.close()});

test('adds, edits and deletes own credentials without files; stale edits keep the current entry',async()=>{
  const id=randomUUID();const add=command(crew,'crew_credential',id,'credential.add',{credential:credential(id)});
  assert.deepEqual((await send(crew,add)).record,credential(id));assert.equal((await crewData()).credentials.length,1);
  assert.equal((await send(crew,command(crew,'crew_credential',id,'credential.add',{credential:credential(id)}))).notApplied,undefined);
  await assert.rejects(send(crew,command(crew,'crew_credential',id,'credential.add',{credential:credential(id,{provider:'Other'})})),error=>error.code==='23505');
  const edited=await send(crew,command(crew,'crew_credential',id,'credential.update',{credential:credential(id,{provider:'CAL FIRE'}),base:credential(id)}));
  assert.equal(edited.record.provider,'CAL FIRE');
  assert.equal((await send(crew,command(crew,'crew_credential',id,'credential.delete',{base:credential(id)}))).notApplied,'changed_elsewhere');
  assert.equal((await send(crew,command(crew,'crew_credential',id,'credential.delete',{base:credential(id,{provider:'CAL FIRE'})}))).record,null);
  assert.deepEqual((await crewData()).credentials,[]);
});
test('files are never added or changed offline; photo-only types are refused',async()=>{
  const id=randomUUID();
  await assert.rejects(send(crew,command(crew,'crew_credential',id,'credential.add',{credential:{...credential(id),file:{name:'a.pdf',type:'application/pdf',path:`${company}/${crew}/a.pdf`}}})),error=>error.code==='22023');
  await assert.rejects(send(crew,command(crew,'crew_credential',id,'credential.add',{credential:credential(id,{recordType:'License'})})),error=>error.code==='22023');
  const withFile={...credential(id),file:{name:'a.pdf',type:'application/pdf',dataUrl:'',path:`${company}/${crew}/a.pdf`}};
  await db.query("update public.fleet_crew set data=data||jsonb_build_object('credentials',jsonb_build_array($2::jsonb)) where record_id=$1",[crew,JSON.stringify(withFile)]);
  await assert.rejects(send(crew,command(crew,'crew_credential',id,'credential.update',{credential:credential(id,{provider:'X'}),base:withFile})),error=>error.code==='22023');
  assert.equal((await send(crew,command(crew,'crew_credential',id,'credential.update',{credential:{...withFile,provider:'X'},base:withFile}))).record.provider,'X');
});
test('experience and the annual record follow the same rules',async()=>{
  const id=randomUUID();const experience={id,incident:'Oak Fire',position:'FFT2',days:'14'};
  await send(crew,command(crew,'crew_experience',id,'experience.add',{experience}));
  assert.equal((await send(crew,command(crew,'crew_experience',id,'experience.update',{experience:{...experience,days:'15'},base:experience}))).record.days,'15');
  const annual={rt130CompletionDate:'2026-04-01',rt130CurrencyDate:'2027-04-01',wctCompletionDate:'2026-04-02',wctCurrencyDate:'2027-04-02'};
  assert.deepEqual((await send(crew,command(crew,'annual_record',crew,'annual.set',{record:annual,base:null}))).record.record,annual);
  assert.equal((await send(crew,command(crew,'annual_record',crew,'annual.set',{record:{...annual,wctCurrencyDate:'2027-05-01'},base:null}))).notApplied,'changed_elsewhere');
  await assert.rejects(send(crew,command(crew,'annual_record',owner,'annual.set',{record:annual,base:null})),error=>error.code==='42501');
});
