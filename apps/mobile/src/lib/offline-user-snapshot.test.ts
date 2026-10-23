import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createUserSnapshotSync,decodeUserSnapshot} from './offline-user-snapshot';
// Verified own tasks/settings download stored in real SQLite (no server/UI).
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const scope={userId:user,companyId:company};const task={id:'50000000-0000-4000-8000-000000000001',subject:'Filters',description:'',dueDate:'2026-01-05'};
const value=(changes={})=>({schemaVersion:1,companyId:company,userId:user,serverRequestAt:'2026-01-02T00:00:00Z',receiptWatermark:'5',tasks:[task],availability:true,dashboard:{tasks:false},...changes});
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
async function setup(){
  const sqlite=new DatabaseSync(':memory:');cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);return {store,db,session:store.activate(scope)};
}
describe('verified user snapshot',()=>{
  it('decodes only the exact account/company and strict shapes',()=>{
    expect(decodeUserSnapshot(value(),scope).tasks).toEqual([task]);expect(decodeUserSnapshot(value({tasks:null}),scope).tasks).toBeNull();
    for(const bad of [{userId:other},{companyId:other},{receiptWatermark:'-1'},{receiptWatermark:5},{serverRequestAt:'soon'},{availability:'yes'},{dashboard:{tasks:'no'}},
      {tasks:[{...task,extra:1}]},{tasks:[task,task]},{tasks:[{...task,dueDate:'Jan 5'}]},{tasks:{}},{extra:true}])expect(()=>decodeUserSnapshot(value(bad),scope),JSON.stringify(bad)).toThrow();
  });
  it('stores per account/company across restarts and never replaces a newer download with an older one',async()=>{
    const f=await setup();expect(await f.session.getUserSnapshot()).toBeNull();
    await f.session.putUserSnapshot(value(),'device-1');
    expect((await f.session.putUserSnapshot(value({serverRequestAt:'2026-01-01T00:00:00Z',tasks:[]}),'device-2')).snapshot.tasks).toEqual([task]);
    expect((await f.session.putUserSnapshot(value({serverRequestAt:'2026-01-03T00:00:00Z',receiptWatermark:'4',tasks:[]}),'device-3')).verifiedAt).toBe('device-1');
    expect((await f.session.putUserSnapshot(value({serverRequestAt:'2026-01-03T00:00:00Z',receiptWatermark:'6',tasks:[]}),'device-4')).snapshot.tasks).toEqual([]);
    expect((await (await createOfflineOutbox(f.db)).activate(scope).getUserSnapshot())?.verifiedAt).toBe('device-4');
    expect(await f.store.activate({...scope,companyId:other}).getUserSnapshot()).toBeNull();
    await expect(f.session.putUserSnapshot(value({userId:other}),'x')).rejects.toThrow();
  });
  it('loads the saved download, refreshes once at a time only when allowed, and keeps it on failure',async()=>{
    const f=await setup();await f.session.putUserSnapshot(value(),'saved');let allowed=false;
    const download=vi.fn(async()=>value({serverRequestAt:'2026-01-03T00:00:00Z',receiptWatermark:'9',tasks:[]}));
    const sync=createUserSnapshotSync({session:f.session,download,canRun:()=>allowed,now:()=>'now'});
    await sync.load();expect(sync.getSnapshot()).toMatchObject({loaded:true,verifiedAt:'saved'});await sync.refresh();expect(download).not.toHaveBeenCalled();
    allowed=true;await Promise.all([sync.refresh(),sync.refresh()]);expect(download).toHaveBeenCalledTimes(1);expect(sync.getSnapshot()).toMatchObject({verifiedAt:'now',refreshing:false,error:''});
    download.mockRejectedValueOnce({code:'54000'});await sync.refresh();expect(sync.getSnapshot()).toMatchObject({verifiedAt:'now',error:expect.stringContaining('Too many')});
    download.mockResolvedValueOnce(value({userId:other}));await sync.refresh();expect(sync.getSnapshot().snapshot?.receiptWatermark).toBe('9');expect(sync.getSnapshot().error).toContain('could not be downloaded');
  });
});
