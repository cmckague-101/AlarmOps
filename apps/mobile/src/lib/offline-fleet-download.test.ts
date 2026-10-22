import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineSyncWorker,offlineSyncNotice} from './offline-sync-worker';
import {decodeFleetDownloadPage,initialFleetDownload,type FleetDownloadPage} from './offline-fleet-download';
const scope={userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001'};
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='a'.repeat(64);const date='2026-01-01T12:00:00Z';
const record=(n:number)=>({entityType:'vehicle' as const,entityId:id(n),revision:'1',record:{id:id(n),unit:`E${n}`,notes:'Base'}});
function page(last=false):FleetDownloadPage{return {companyId:scope.companyId,snapshotToken:token,serverRequestAt:date,scope:'all',total:26,vehicles:25,issues:0,records:last?[{entityType:'vehicle',entityId:id(26),revision:'2',record:null}]:Array.from({length:25},(_,i)=>record(i+1)),nextCursor:last?null:{entityType:'vehicle',entityId:id(25)}}}
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
async function setup(path=':memory:'){
  const sqlite=new DatabaseSync(path);let closed=false;const close=()=>{if(!closed){sqlite.close();closed=true}};cleanup.push(close);
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  const store=await createOfflineOutbox(db);const session=store.activate(scope);const mode={run:true,manager:true};let sequence=0;
  const transport={deliver:vi.fn(),canonical:vi.fn(),outcome:vi.fn(),readRecord:vi.fn(),downloadPage:vi.fn().mockResolvedValueOnce(page()).mockResolvedValue(page(true))};
  const worker=createOfflineSyncWorker({session,transport,canAccess:()=>true,canRun:()=>mode.run,canReadRecords:()=>mode.manager,token:()=>`generation-${++sequence}`});cleanup.push(()=>worker.stop());
  return {sqlite,close,store,session,worker,transport,mode};
}
describe('verified fleet inventory download protocol',()=>{
  it('rejects scope/snapshot mismatch, invalid counts, identity changes, duplicate pages and bad cursors',()=>{
    for(const modify of [(p:any)=>p.companyId='other',(p:any)=>p.snapshotToken='bad',(p:any)=>p.vehicles=99,(p:any)=>p.records[0].record.id='other',(p:any)=>p.records[1]=p.records[0],(p:any)=>p.nextCursor.entityId=id(24)]){
      const raw=page();modify(raw);expect(()=>decodeFleetDownloadPage(raw,scope.companyId,initialFleetDownload('g'))).toThrow();
    }
    expect(()=>decodeFleetDownloadPage(page(),scope.companyId,{snapshotToken:'b'.repeat(64),cursor:null})).toThrow();
  });
});
describe('durable scoped inventory pages (real SQLite)',()=>{
  it('commits records, proven deletions and coverage without downgrading newer cache records',async()=>{
    const f=await setup();await f.session.putRecord('vehicle',id(1),{revision:'5',record:{...record(1).record,notes:'Newer'}});await f.session.restartFleetDownload('g');await f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,page());expect((await f.session.getFleetDownload())?.complete).toBe(false);
    await f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,page(true));expect(await f.session.getFleetDownload()).toMatchObject({complete:true,received:26,lastCompletedAt:date});expect((await f.session.listRecords()).find(row=>row.entityId===id(1))?.revision).toBe('5');expect((await f.session.listRecords()).find(row=>row.entityId===id(26))?.record).toBeNull();
  });
  it('rolls back page data and membership when durable cursor storage fails',async()=>{
    const f=await setup();await f.session.restartFleetDownload('g');f.sqlite.exec("CREATE TRIGGER fail_progress BEFORE UPDATE ON offline_fleet_downloads BEGIN SELECT RAISE(FAIL,'disk full');END;");await expect(f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,page())).rejects.toThrow('disk full');expect(await f.session.listRecords()).toEqual([]);expect((await f.session.getFleetDownload())?.received).toBe(0);expect(f.sqlite.prepare('SELECT count(*) count FROM offline_fleet_download_members').get()).toEqual({count:0});
  });
  it('does not infer deletion or claim complete coverage when previously verified IDs are absent',async()=>{
    const f=await setup();await f.session.putRecord('vehicle',id(99),{revision:'1',record:{id:id(99)}});await f.session.restartFleetDownload('g');await f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,page());await expect(f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,page(true))).rejects.toThrow('No deletion was assumed');expect((await f.session.getFleetDownload())?.complete).toBe(false);expect((await f.session.listRecords()).find(row=>row.entityId===id(99))?.record).toEqual({id:id(99)});
  });
  it('checks final live counts and can prove an authorized empty inventory',async()=>{
    const f=await setup();await f.session.restartFleetDownload('g');await f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,{...page(),vehicles:24});await expect(f.session.applyFleetDownloadPage((await f.session.getFleetDownload())!,{...page(true),vehicles:24})).rejects.toThrow('coverage counts');expect((await f.session.getFleetDownload())?.received).toBe(25);
    const empty=await setup();await empty.session.restartFleetDownload('empty');await empty.session.applyFleetDownloadPage((await empty.session.getFleetDownload())!,{...page(),records:[],nextCursor:null,total:0,vehicles:0});expect((await empty.session.getFleetDownload())?.complete).toBe(true);
  });
  it('fences cancelled or replaced download generations and isolates other accounts',async()=>{
    const f=await setup();await f.session.restartFleetDownload('old');const previous=(await f.session.getFleetDownload())!;await f.session.stopFleetDownload();await f.session.restartFleetDownload('new');expect(await f.session.applyFleetDownloadPage(previous,page())).toBe(false);expect(await f.session.restartFleetDownload('late','old')).toBe(false);expect((await f.session.getFleetDownload())?.generationId).toBe('new');expect(await f.session.listRecords()).toEqual([]);const other=f.store.activate({...scope,userId:'other'});expect(await other.getFleetDownload()).toBeNull();expect(await other.listRecords()).toEqual([]);
  });
  it('resumes a durable cursor after SQLite close/reopen without downloading earlier pages again',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'fleet-download-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'cache.db');const first=await setup(path);await first.session.restartFleetDownload('g');await first.session.applyFleetDownloadPage((await first.session.getFleetDownload())!,page());first.worker.stop();first.store.pause();first.close();
    const restored=await setup(path);restored.transport.downloadPage.mockReset().mockResolvedValue(page(true));await restored.worker.resume();expect(restored.transport.downloadPage).toHaveBeenCalledOnce();expect(restored.transport.downloadPage.mock.calls[0][0]).toMatchObject({snapshotToken:token,cursor:{entityType:'vehicle',entityId:id(25)}});expect((await restored.session.getFleetDownload())?.complete).toBe(true);
  });
});
describe('foreground download worker',()=>{
  it('requires opt-in and automatically rescans completed coverage on reconnect',async()=>{
    const f=await setup();await f.worker.wake();expect(f.transport.downloadPage).not.toHaveBeenCalled();await f.worker.startFleetDownload();expect((await f.session.getFleetDownload())?.complete).toBe(true);f.transport.downloadPage.mockReset().mockResolvedValueOnce(page()).mockResolvedValue(page(true));await f.worker.resume();expect(f.transport.downloadPage).toHaveBeenCalledTimes(2);expect(f.transport.deliver).not.toHaveBeenCalled();
  });
  it('keeps committed pages after network failure and resumes their exact snapshot/cursor',async()=>{
    const f=await setup();f.transport.downloadPage.mockReset().mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('network')).mockResolvedValue(page(true));await f.worker.startFleetDownload();expect((await f.session.getFleetDownload())?.received).toBe(25);expect(f.worker.getSnapshot().downloadError).toContain('incomplete');expect(offlineSyncNotice(f.worker.getSnapshot())).toMatchObject({message:'Fleet download needs attention',dismissible:false});await f.worker.resume();expect(f.transport.downloadPage.mock.calls[2][0]).toMatchObject({snapshotToken:token,cursor:{entityType:'vehicle',entityId:id(25)}});expect((await f.session.getFleetDownload())?.complete).toBe(true);
  });
  it('restarts changed snapshots with a bounded retry budget',async()=>{
    const f=await setup();f.transport.downloadPage.mockReset().mockRejectedValueOnce({code:'PT409'}).mockResolvedValueOnce(page()).mockResolvedValue(page(true));await f.worker.startFleetDownload();expect((await f.session.getFleetDownload())?.complete).toBe(true);
    f.transport.downloadPage.mockReset().mockRejectedValue({code:'PT409'});await f.worker.startFleetDownload();expect(f.transport.downloadPage).toHaveBeenCalledTimes(3);expect((await f.session.getFleetDownload())?.complete).toBe(false);expect(f.worker.getSnapshot().downloadError).toContain('kept changing');
  });
  it('does not start offline, after demotion or without a foreground connection',async()=>{
    const f=await setup();f.mode.run=false;await f.worker.startFleetDownload();expect(await f.session.getFleetDownload()).toBeNull();f.mode.run=true;f.mode.manager=false;await f.worker.startFleetDownload();expect(f.transport.downloadPage).not.toHaveBeenCalled();
  });
  it('does not retain or publish a late page after manager access is withdrawn',async()=>{
    const f=await setup();let resolve!:(value:unknown)=>void;f.transport.downloadPage.mockReset().mockReturnValue(new Promise(yes=>{resolve=yes}));const running=f.worker.startFleetDownload();await vi.waitFor(()=>expect(f.transport.downloadPage).toHaveBeenCalledOnce());f.mode.manager=false;resolve(page());await running;expect(await f.session.listRecords()).toEqual([]);expect(f.worker.getSnapshot().download).toBeNull();
  });
  it('drops late pages after cancellation and preserves already saved records',async()=>{
    const f=await setup();let resolve!:(value:unknown)=>void;f.transport.downloadPage.mockReset().mockReturnValue(new Promise(yes=>{resolve=yes}));const running=f.worker.startFleetDownload();await vi.waitFor(()=>expect(f.transport.downloadPage).toHaveBeenCalledOnce());await f.worker.stopFleetDownload();resolve(page());await running;expect(await f.session.getFleetDownload()).toBeNull();expect(await f.session.listRecords()).toEqual([]);
  });
  it('does not re-enable cancelled downloads after a late snapshot error',async()=>{
    const f=await setup();let reject!:(error:unknown)=>void;f.transport.downloadPage.mockReset().mockReturnValue(new Promise((_yes,no)=>{reject=no}));const running=f.worker.startFleetDownload();await vi.waitFor(()=>expect(f.transport.downloadPage).toHaveBeenCalledOnce());await f.worker.stopFleetDownload();reject({code:'PT409'});await running;expect(await f.session.getFleetDownload()).toBeNull();expect(f.worker.getSnapshot().downloadError).toBeNull();expect(f.transport.downloadPage).toHaveBeenCalledOnce();
  });
  it('clears unavailable canonical downloads after permission denial without inventing tombstones',async()=>{
    const f=await setup();await f.session.putRecord('vehicle',id(1),{revision:'1',record:record(1).record});
    const operation={schemaVersion:1 as const,operationId:id(90),companyId:scope.companyId,entityType:'vehicle' as const,entityId:id(1),provenance:{userId:scope.userId,deviceId:'phone',savedAt:date,connectivity:'offline' as const},dependsOn:[],mutation:{kind:'update' as const,baseRevision:'1',base:record(1).record,patch:{notes:{present:true as const,value:'Saved intent'}}}};
    await f.session.enqueue(operation,{...record(1).record,notes:'Saved intent'});f.transport.deliver.mockRejectedValue({code:'42501'});f.transport.downloadPage.mockReset().mockRejectedValue({code:'42501'});await f.worker.startFleetDownload();
    expect(await f.session.listRecords()).toEqual([]);expect((await f.session.list())[0].operation).toEqual(operation);expect(await f.session.getProjection('vehicle',id(1))).toMatchObject({operationId:operation.operationId,record:{notes:'Saved intent'}});expect((await f.session.getFleetDownload())?.complete).toBe(false);expect(f.worker.getSnapshot().downloadError).toContain('incomplete');
  });
});
describe('inventory scope',()=>{
  it('accepts vehicle-only crew pages and rejects issues inside them',async()=>{
    const {decodeFleetDownloadPage}=await import('./offline-fleet-download');
    const base={companyId:'10000000-0000-4000-8000-000000000001',snapshotToken:'a'.repeat(64),serverRequestAt:'2026-01-01T00:00:00Z',total:0,vehicles:0,issues:0,records:[],nextCursor:null};
    expect(decodeFleetDownloadPage({...base,scope:'vehicles'},base.companyId,{snapshotToken:null,cursor:null}).scope).toBe('vehicles');
    expect(decodeFleetDownloadPage(base,base.companyId,{snapshotToken:null,cursor:null}).scope).toBe('all');
    expect(()=>decodeFleetDownloadPage({...base,scope:'vehicles',issues:1,total:1},base.companyId,{snapshotToken:null,cursor:null})).toThrow();
    expect(()=>decodeFleetDownloadPage({...base,scope:'everything'},base.companyId,{snapshotToken:null,cursor:null})).toThrow();
  });
});
