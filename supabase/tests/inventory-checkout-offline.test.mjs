import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadInventorySchema} from './fixtures/fleet-sync-harness.mjs';
// Gear checkout: one stock check for online and offline; stock is never
// exceeded; offline shortfalls and deleted items change nothing and say why.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000005';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
function checkout(user,itemId,quantity,companyId=company){
  return {schemaVersion:1,operationId:randomUUID(),companyId,entityType:'inventory_checkout',entityId:itemId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:'checkout.add',payload:{quantity}}};
}
const send=(op,user=op.provenance.userId)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const online=(user,itemId,quantity)=>actor(user,async()=>(await row('select (public.checkout_inventory_item($1,$2)).quantity result',[itemId,quantity])).result);
const held=async(itemId,user)=>(await row('select quantity from public.company_inventory_checkouts where item_id=$1 and user_id=$2',[itemId,user]))?.quantity??0;
async function item(quantity=5){const id=randomUUID();await actor(owner,()=>db.query("insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,'Gloves',$3)",[id,company,quantity]));return id}
before(async()=>{await loadInventorySchema(db)});
beforeEach(async()=>{
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query('insert into public.companies values($1),($2)',[company,other]);
  await db.query('insert into public.profiles values($1,$2),($3,$4),($5,$6),($7,$8)',[owner,'Owner',crew,'Crew Person',tech,'Tech',outsider,'Outsider']);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech',other,outsider]);
});
after(async()=>{await db.close()});

test('crew can check out online again (retired member role fixed); managers cannot',async()=>{
  const id=await item();assert.equal(await online(crew,id,2),2);assert.equal(await online(tech,id,1),1);assert.equal(await online(crew,id,1),3);
  assert.equal((await row('select user_name from public.company_inventory_checkouts where user_id=$1',[crew])).user_name,'Crew Person');
  await assert.rejects(online(owner,id,1),error=>error.code==='42501');
  await assert.rejects(online(crew,id,2),error=>error.code==='22023'&&/Only 1 units/.test(error.message));
  await assert.rejects(online(crew,randomUUID(),1),error=>error.code==='P0002');
});
test('offline checkouts apply once and report the held quantity',async()=>{
  const id=await item();const op=checkout(crew,id,2);const result=await send(op);
  assert.equal(result.notApplied,undefined);assert.deepEqual(result.record,{id,checkedOut:2});assert.deepEqual(await send(op),result);assert.equal(await held(id,crew),2);
});
test('a shortfall at arrival changes nothing; competing offline checkouts never exceed stock',async()=>{
  const id=await item(3);const first=await send(checkout(crew,id,2));const second=await send(checkout(tech,id,2));
  assert.equal(first.notApplied,undefined);assert.equal(second.notApplied,'insufficient_stock');assert.deepEqual(second.record,{id,checkedOut:0});
  assert.equal(await held(id,tech),0);assert.equal((await row('select sum(quantity)::int total from public.company_inventory_checkouts')).total,2);
  assert.equal((await send(checkout(tech,id,1))).notApplied,undefined);
});
test('deleted items and invalid requests change nothing; managers and outsiders are refused',async()=>{
  const gone=await send(checkout(crew,randomUUID(),1));assert.equal(gone.notApplied,'item_deleted');assert.equal(gone.record,null);
  const id=await item();
  for(const quantity of [0,-1,1.5,'2',1000000])await assert.rejects(send(checkout(crew,id,quantity)),error=>error.code==='22023',String(quantity));
  await assert.rejects(send(checkout(owner,id,1)),error=>error.code==='42501');await assert.rejects(send(checkout(outsider,id,1)),error=>error.code==='42501');
  await assert.rejects(actor(crew,()=>db.query('select public.inventory_checkout_core($1,$2,1)',[company,id])),error=>error.code==='42501');
  assert.equal((await row('select count(*)::int count from public.company_inventory_checkouts')).count,0);
});
