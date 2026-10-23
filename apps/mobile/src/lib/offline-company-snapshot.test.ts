import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createOfflineOutbox,type OutboxDatabase,type OutboxEntry,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createCompanySnapshotSync,decodeCompanySnapshot,entriesAfterDownload} from './offline-company-snapshot';
// Verified company-list downloads stored in real SQLite (no server/UI).
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const scope={userId:user,companyId:company};
const item={id:'50000000-0000-4000-8000-000000000001',name:'Gloves',quantity:5,created_at:'2026-01-01T00:00:00+00:00',updated_at:'2026-01-01T00:00:00+00:00'};
const inventory=(changes={})=>({schemaVersion:1,section:'inventory',companyId:company,userId:user,serverRequestAt:'2026-01-02T00:00:00Z',receiptWatermark:'5',tables:{company_inventory_items:[item],company_inventory_checkouts:[]},...changes});
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
async function setup(){
  const sqlite=new DatabaseSync(':memory:');cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);return {store,db,session:store.activate(scope)};
}
describe('verified company-list downloads',()=>{
  it('decodes only the exact account, company, section and column sets',()=>{
    expect(decodeCompanySnapshot(inventory(),scope,'inventory').tables.company_inventory_items).toEqual([item]);
    for(const bad of [{userId:other},{companyId:other},{section:'training'},{receiptWatermark:'x'},{serverRequestAt:'soon'},{extra:1},
      {tables:{company_inventory_items:[item]}},{tables:{company_inventory_items:[{...item,secret:1}],company_inventory_checkouts:[]}},{tables:{company_inventory_items:{},company_inventory_checkouts:[]}}])
      expect(()=>decodeCompanySnapshot(inventory(bad),scope,'inventory'),JSON.stringify(bad)).toThrow();
    expect(()=>decodeCompanySnapshot(inventory(),scope,'receipts')).toThrow();
  });
  it('stores each section per account/company and never replaces a newer download',async()=>{
    const f=await setup();expect(await f.session.getCompanySnapshot('inventory')).toBeNull();
    await f.session.putCompanySnapshot('inventory',inventory(),'device-1');
    const older=await f.session.putCompanySnapshot('inventory',inventory({serverRequestAt:'2026-01-01T00:00:00Z',tables:{company_inventory_items:[],company_inventory_checkouts:[]}}),'device-2');
    expect(older.snapshot.tables.company_inventory_items).toEqual([item]);expect(older.verifiedAt).toBe('device-1');
    await expect(f.session.putCompanySnapshot('inventory',inventory({receiptWatermark:'4',serverRequestAt:'2026-01-03T00:00:00Z'}),'device-3')).resolves.toMatchObject({verifiedAt:'device-1'});
    const restarted=(await createOfflineOutbox(f.db)).activate(scope);expect((await restarted.getCompanySnapshot('inventory'))?.verifiedAt).toBe('device-1');
    expect(await restarted.getCompanySnapshot('training')).toBeNull();
    expect(await (await createOfflineOutbox(f.db)).activate({userId:user,companyId:other}).getCompanySnapshot('inventory')).toBeNull();
  });
  it('downloads every section, keeps earlier ones after a failure and reports errors',async()=>{
    const f=await setup();
    const download=vi.fn(async(section:string)=>{if(section==='payroll')throw {code:'54000'};if(section!=='inventory')throw new Error('offline');return inventory()});
    const sync=createCompanySnapshotSync({session:f.session,download,canRun:()=>true,now:()=>'device-1'});cleanup.push(()=>sync.stop());
    await sync.load();expect(sync.getSnapshot()).toMatchObject({loaded:true,sections:{}});
    await sync.refresh();expect(download.mock.calls.map(call=>call[0])).toEqual(['inventory','training','payroll','invoices','receipts']);
    expect(sync.getSnapshot().sections.inventory?.verifiedAt).toBe('device-1');expect(sync.getSnapshot().error).toMatch(/could not be downloaded/);
    const again=createCompanySnapshotSync({session:f.session,download,canRun:()=>false});cleanup.push(()=>again.stop());await again.load();expect(again.getSnapshot().sections.inventory?.snapshot.receiptWatermark).toBe('5');
    await again.refresh();expect(download).toHaveBeenCalledTimes(5);
  });
  it('keeps overlaying own changes applied after the download watermark, but not refused ones',()=>{
    const entry=(revision:string,status:OutboxEntry['status']='synced',notApplied?:string)=>({status,receipt:{kind:'applied',revision},delivery:notApplied?{notApplied}:{kind:'applied'}}) as unknown as OutboxEntry;
    const entries=[entry('4'),entry('6'),entry('7','synced','course_full'),entry('8','pending')];
    expect(entriesAfterDownload(entries,'5').map(item=>item.status)).toEqual(['synced','pending','synced','pending']);
    expect(entriesAfterDownload(entries,null).map(item=>item.status)).toEqual(['synced','synced','synced','pending']);
  });
});
