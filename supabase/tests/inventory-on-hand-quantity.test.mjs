import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadGuardedEditSchema,migration} from './fixtures/fleet-sync-harness.mjs';
// Inventory quantity is on-hand stock: checkout lowers it, check-in restores it,
// online and offline. Existing totals convert once when the migration runs.
const db=new PGlite();
const company='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001',crew='20000000-0000-4000-8000-000000000002',tech='20000000-0000-4000-8000-000000000003';
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(user,task,role='authenticated'){
  await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user??'',role]);await db.exec(`set local role ${role}`);const result=await task();await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
}
const command=(user,entityType,entityId,cmd,payload)=>({schemaVersion:1,operationId:randomUUID(),companyId:company,entityType,entityId,provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'command',command:cmd,payload}});
const send=(user,op)=>actor(user,async()=>(await row('select public.sync_user_command($1::jsonb) result',[JSON.stringify(op)])).result);
const checkout=(user,id,quantity)=>actor(user,()=>db.query('select public.checkout_inventory_item($1,$2)',[id,quantity]));
const checkin=(user,id,borrower,quantity)=>actor(user,async()=>(await row('select public.checkin_inventory_item($1,$2,$3) remaining',[id,borrower,quantity])).remaining);
const onHand=async id=>(await row('select quantity from public.company_inventory_items where id=$1',[id])).quantity;
const held=async(id,user)=>(await row('select quantity from public.company_inventory_checkouts where item_id=$1 and user_id=$2',[id,user]))?.quantity??0;
const stamp=async id=>(await row("select to_json(updated_at)#>>'{}' value from public.company_inventory_items where id=$1",[id])).value;
async function seed(){
  await db.exec('truncate public.companies cascade;truncate public.profiles cascade');
  await db.query("insert into public.companies(id,name,company_code) values($1,'Crew Co','CC-1')",[company]);
  await db.query("insert into public.profiles(user_id,full_name,email) values($1,'Owner','o@x'),($2,'Crew Person','c@x'),($3,'Tech','t@x')",[owner,crew,tech]);
  await db.query('insert into public.company_members values($1,$2,$3),($1,$4,$5),($1,$6,$7)',[company,owner,'owner',crew,'fire_fighter',tech,'shop_tech']);
}
async function item(quantity,name='Gloves'){const id=randomUUID();await actor(owner,()=>db.query('insert into public.company_inventory_items(id,company_id,name,quantity) values($1,$2,$3,$4)',[id,company,name,quantity]));return id}

const converted={};
before(async()=>{
  await loadGuardedEditSchema(db);
  // Rows saved under the old meaning (quantity = total) before the migration.
  await seed();
  converted.radio=await item(12,'Radio');converted.shelter=await item(4,'Shelter');converted.pulaski=await item(8,'Pulaski');
  await checkout(crew,converted.radio,2);await checkout(tech,converted.radio,3);await checkout(crew,converted.shelter,4);
  converted.before=await stamp(converted.radio);
  await db.exec(migration('20270109000100_inventory_on_hand_quantity'));
  for(const key of ['radio','shelter','pulaski'])converted[`${key}After`]=await onHand(converted[key]);
  converted.after=await stamp(converted.radio);
  converted.held=await held(converted.radio,tech);
});
beforeEach(seed);
after(async()=>{await db.close()});

test('existing totals convert once to on-hand stock; checkouts are kept',()=>{
  assert.equal(converted.radioAfter,7);assert.equal(converted.shelterAfter,0);assert.equal(converted.pulaskiAfter,8);
  assert.equal(converted.held,3);assert.notEqual(converted.after,converted.before);
});
test('online checkout lowers on-hand stock and is limited by it; check-in restores it',async()=>{
  const id=await item(5);
  await checkout(crew,id,2);assert.equal(await onHand(id),3);assert.equal(await held(id,crew),2);
  await checkout(tech,id,3);assert.equal(await onHand(id),0);
  await assert.rejects(checkout(crew,id,1),error=>error.code==='22023'&&/Only 0 units/.test(error.message));
  assert.equal(await checkin(owner,id,crew,1),1);assert.equal(await onHand(id),1);assert.equal(await held(id,crew),1);
  assert.equal(await checkin(owner,id,tech,3),0);assert.equal(await onHand(id),4);assert.equal(await held(id,tech),0);
  await assert.rejects(checkin(crew,id,crew,1),error=>error.code==='42501');
  await assert.rejects(checkin(owner,id,crew,2),error=>error.code==='22023');
  assert.equal(await onHand(id),4);
});
test('offline checkout and return move on-hand stock; shortfalls change nothing',async()=>{
  const id=await item(3);
  assert.equal((await send(crew,command(crew,'inventory_checkout',id,'checkout.add',{quantity:2}))).notApplied,undefined);
  assert.equal(await onHand(id),1);
  assert.equal((await send(tech,command(tech,'inventory_checkout',id,'checkout.add',{quantity:2}))).notApplied,'insufficient_stock');
  assert.equal(await onHand(id),1);assert.equal(await held(id,tech),0);
  const base=(await row("select to_json(updated_at)#>>'{}' value from public.company_inventory_checkouts where item_id=$1",[id])).value;
  const returned=await send(owner,command(owner,'inventory_return',id,'return.checkin',{userId:crew,quantity:2,base:{updatedAt:base}}));
  assert.equal(returned.notApplied,undefined);assert.deepEqual(returned.record.checkouts,{});assert.equal(await onHand(id),3);
});
test('managers set on-hand stock freely, even below units checked out',async()=>{
  const id=await item(5);await checkout(crew,id,4);
  const updated=await send(owner,command(owner,'inventory_item',id,'item.update',{quantity:0,base:{updatedAt:await stamp(id)}}));
  assert.equal(updated.notApplied,undefined);assert.equal(updated.record.quantity,0);
  await actor(owner,()=>db.query('update public.company_inventory_items set quantity=2 where id=$1',[id]));
  assert.equal(await onHand(id),2);assert.equal(await held(id,crew),4);
});
test('crew cannot move stock directly, even with the stock-move flag set',async()=>{
  const id=await item(5);
  await actor(crew,async()=>{await db.query("select set_config('fireops.inventory_stock_move','on',true)");await db.query('update public.company_inventory_items set quantity=99 where id=$1',[id])});
  assert.equal(await onHand(id),5);
  await assert.rejects(actor(crew,()=>db.query('select public.move_inventory_stock($1,$2,10)',[company,id])),error=>error.code==='42501');
  assert.equal(await onHand(id),5);
});
test('check-in refuses to push on-hand stock past 999,999',async()=>{
  const id=await item(5);await checkout(crew,id,2);
  await actor(owner,()=>db.query('update public.company_inventory_items set quantity=999999 where id=$1',[id]));
  await assert.rejects(checkin(owner,id,crew,1),error=>error.code==='22023');
  assert.equal(await held(id,crew),2);
});
