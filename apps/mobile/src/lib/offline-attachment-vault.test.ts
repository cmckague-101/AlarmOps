import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,renameSync,existsSync,unlinkSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineAttachmentVault,type OfflineAttachmentFiles} from './offline-attachment-vault';
import {offlineAttachmentMaxBytes,type OfflineAttachmentIntent} from './offline-attachment-types';
import {createOfflineSyncWorker} from './offline-sync-worker';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001';
const scope={userId:user,companyId:company};const entity='30000000-0000-4000-8000-000000000001';
const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const date='2026-01-01T00:00:00Z';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
function database(path:string){
  const sqlite=new DatabaseSync(path);let closed=false;const close=()=>{if(!closed){sqlite.close();closed=true}};cleanup.push(close);
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};return {db,sqlite,close};
}
async function setup(existingRoot?:string){
  const root=existingRoot??mkdtempSync(join(tmpdir(),'offline-files-'));if(!existingRoot)cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const data=database(join(root,'store.db'));const store=await createOfflineOutbox(data.db);const session=store.activate(scope);
  await session.putRecord('vehicle',entity,{revision:'1',record:{id:entity,unit:'E1'}});
  const directory=join(root,'managed',user,company);mkdirSync(directory,{recursive:true});const path=(asset:string,slot:string)=>join(directory,`${asset}.${slot}`);
  const hash=(value:Uint8Array)=>({byteSize:value.byteLength,sha256:createHash('sha256').update(value).digest('hex')});
  const files:OfflineAttachmentFiles={source:vi.fn(async uri=>hash(readFileSync(fileURLToPath(uri)))),inspect:vi.fn(async(asset,slot)=>existsSync(path(asset,slot))?hash(readFileSync(path(asset,slot))):null),copy:vi.fn(async(uri,asset)=>{copyFileSync(fileURLToPath(uri),path(asset,'part'))}),promote:vi.fn(async asset=>{if(existsSync(path(asset,'blob')))throw new Error('Exists');renameSync(path(asset,'part'),path(asset,'blob'))}),remove:vi.fn(async(asset,slot)=>{if(existsSync(path(asset,slot)))unlinkSync(path(asset,slot))}),uri:asset=>pathToFileURL(path(asset,'blob')).href};
  const mode={allowed:true};const make=()=>{const vault=createOfflineAttachmentVault({session,files,canAccess:()=>mode.allowed,createId:()=>id(99),connectivity:()=> 'offline',now:()=>date});cleanup.push(()=>vault.dispose());return vault};const vault=make();
  const picked=join(root,'picked.tmp');if(!existsSync(picked))writeFileSync(picked,new Uint8Array([0,255,1,9,17]));
  const input={attachmentId:id(1),entityType:'vehicle' as const,entityId:entity,uri:pathToFileURL(picked).href,name:'photo.png',mimeType:'image/png'};
  const operation={schemaVersion:1 as const,operationId:id(50),companyId:company,entityType:'vehicle' as const,entityId:entity,provenance:{userId:user,deviceId:id(99),savedAt:date,connectivity:'offline' as const},dependsOn:[],mutation:{kind:'update' as const,baseRevision:'1',base:{id:entity,unit:'E1'},patch:{notes:{present:true as const,value:'Saved'}}}};
  return {...data,root,store,session,files,vault,make,mode,path,picked,input,operation,hash};
}
describe('durable scoped attachment vault (actual SQLite and files)',()=>{
  it('keeps private bytes after picker loss and database reopen with original provenance',async()=>{
    const f=await setup();const saved=await f.vault.stage(f.input);expect(saved).toMatchObject({state:'ready',byteSize:5,savedAt:date,connectivity:'offline',deviceId:id(99)});expect(readFileSync(fileURLToPath(await f.vault.localUri(id(1))))).toEqual(readFileSync(f.picked));unlinkSync(f.picked);f.vault.dispose();f.store.pause();f.close();
    const restored=await setup(f.root);unlinkSync(restored.picked);await restored.vault.recover();expect((await restored.session.getAttachment(id(1)))?.state).toBe('ready');expect(await restored.vault.stage(restored.input)).toEqual(saved);expect(await restored.store.countUnresolvedForUser(user)).toBe(1);
  });
  it('retains incomplete work after disk-full copy failure and retries identical bytes',async()=>{
    const f=await setup();vi.mocked(f.files.copy).mockImplementationOnce(async()=>{writeFileSync(f.path(id(1),'part'),new Uint8Array([0]));throw new Error('disk full')});await expect(f.vault.stage(f.input)).rejects.toThrow('disk full');expect((await f.session.getAttachment(id(1)))?.state).toBe('missing');expect(existsSync(f.picked)).toBe(true);await f.vault.recover();expect((await f.session.getAttachment(id(1)))?.state).toBe('missing');expect((await f.vault.stage(f.input)).state).toBe('ready');
  });
  it('recovers a complete partial copy after interrupted promotion without picker data',async()=>{
    const f=await setup();vi.mocked(f.files.promote).mockRejectedValueOnce(new Error('interrupted'));await expect(f.vault.stage(f.input)).rejects.toThrow('interrupted');unlinkSync(f.picked);await f.vault.recover();expect((await f.session.getAttachment(id(1)))?.state).toBe('ready');
  });
  it('recovers moved bytes when SQLite readiness acknowledgment fails',async()=>{
    const f=await setup();f.sqlite.exec("CREATE TRIGGER fail_ready BEFORE UPDATE ON offline_attachments WHEN NEW.state='ready' BEGIN SELECT RAISE(FAIL,'disk full');END;");await expect(f.vault.stage(f.input)).rejects.toThrow('disk full');expect(existsSync(f.path(id(1),'blob'))).toBe(true);expect((await f.session.getAttachment(id(1)))?.state).not.toBe('ready');f.sqlite.exec('DROP TRIGGER fail_ready');unlinkSync(f.picked);await f.vault.recover();expect((await f.session.getAttachment(id(1)))?.state).toBe('ready');
  });
  it('detects corruption before file access and never overwrites inconsistent final bytes',async()=>{
    const f=await setup();await f.vault.stage(f.input);writeFileSync(f.path(id(1),'blob'),'wrong');await expect(f.vault.localUri(id(1))).rejects.toThrow('integrity');await expect(f.vault.stage(f.input)).rejects.toThrow('repair');expect(readFileSync(f.path(id(1),'blob'),'utf8')).toBe('wrong');expect((await f.session.getAttachment(id(1)))?.state).toBe('missing');
  });
  it('repairs bound corrupt copies only with exact original bytes without changing metadata or references',async()=>{
    const f=await setup();const original=await f.vault.stage(f.input);await f.session.enqueue(f.operation,{id:entity},{attachmentIds:[id(1)]});writeFileSync(f.path(id(1),'blob'),'bad');await expect(f.vault.localUri(id(1))).rejects.toThrow('integrity');const wrong=join(f.root,'wrong');writeFileSync(wrong,'not original');await expect(f.vault.repair(id(1),pathToFileURL(wrong).href)).rejects.toThrow('exact original');expect(readFileSync(f.path(id(1),'blob'),'utf8')).toBe('bad');
    expect(await f.vault.repair(id(1),f.input.uri)).toEqual(original);expect((await f.session.list())[0].attachmentIds).toEqual([id(1)]);expect(await f.session.listAttachmentReferences()).toEqual([{attachmentId:id(1),operationId:f.operation.operationId}]);
  });
  it('recovers interrupted explicit repair from verified partial bytes',async()=>{
    const f=await setup();const original=await f.vault.stage(f.input);writeFileSync(f.path(id(1),'blob'),'bad');vi.mocked(f.files.promote).mockRejectedValueOnce(new Error('interrupted repair'));await expect(f.vault.repair(id(1),f.input.uri)).rejects.toThrow('interrupted repair');expect((await f.session.getAttachment(id(1)))?.state).toBe('missing');unlinkSync(f.picked);await f.vault.recover();expect(await f.session.getAttachment(id(1))).toEqual(original);
  });
  it('rejects different retry bytes, names, targets and path identities',async()=>{
    const f=await setup();vi.mocked(f.files.copy).mockRejectedValueOnce(new Error('disk full'));await expect(f.vault.stage(f.input)).rejects.toThrow();writeFileSync(f.picked,'different');await expect(f.vault.stage(f.input)).rejects.toThrow('differ');await expect(f.vault.stage({...f.input,name:'other.png'})).rejects.toThrow('reused');await expect(f.vault.stage({...f.input,entityId:id(2)})).rejects.toThrow('reused');expect(()=>f.vault.stage({...f.input,attachmentId:'../escape'})).toThrow('identity');
  });
  it('requires verified downloaded targets before creating an attachment draft',async()=>{
    const f=await setup();await f.session.removeRecord('vehicle',entity);await expect(f.vault.stage(f.input)).rejects.toThrow('Download verified');expect(await f.session.listAttachments()).toEqual([]);
  });
  it('binds attachment references and projections atomically and blocks unsupported scalar delivery',async()=>{
    const f=await setup();await f.vault.stage(f.input);const saved=await f.session.enqueue(f.operation,{id:entity,notes:'Saved'},{attachmentIds:[id(1)]});expect(saved.attachmentIds).toEqual([id(1)]);await expect(f.vault.discard(id(1))).rejects.toThrow('still reference');
    const transport={deliver:vi.fn(),canonical:vi.fn(),outcome:vi.fn()};const worker=createOfflineSyncWorker({session:f.session,transport,canAccess:()=>true,canRun:()=>true,token:()=>id(80)});cleanup.push(()=>worker.stop());await worker.wake();expect(transport.deliver).not.toHaveBeenCalled();expect((await f.session.list())[0]).toMatchObject({status:'blocked',error:expect.stringContaining('attachment workflow')});expect(await f.store.countUnresolvedForUser(user)).toBe(2);expect(existsSync(f.path(id(1),'blob'))).toBe(true);
  });
  it('rolls back an operation when attachment-reference storage fails',async()=>{
    const f=await setup();await f.vault.stage(f.input);f.sqlite.exec("CREATE TRIGGER fail_ref BEFORE INSERT ON offline_attachment_refs BEGIN SELECT RAISE(FAIL,'disk full');END;");await expect(f.session.enqueue(f.operation,{id:entity},{attachmentIds:[id(1)]})).rejects.toThrow('disk full');expect(await f.session.list()).toEqual([]);expect(await f.session.getProjection('vehicle',entity)).toBeNull();expect((await f.session.getAttachment(id(1)))?.state).toBe('ready');
  });
  it('retains immutable references on retry and rejects unready or other-target files',async()=>{
    const f=await setup();await f.vault.stage(f.input);await f.session.enqueue(f.operation,{id:entity},{attachmentIds:[id(1)]});expect((await f.session.enqueue(f.operation,{id:entity},{attachmentIds:[id(1)]})).attachmentIds).toEqual([id(1)]);await expect(f.session.enqueue(f.operation,{id:entity})).rejects.toThrow('cannot be changed');
    await expect(f.session.enqueue({...f.operation,operationId:id(51),entityId:id(3)},{id:id(3)},{attachmentIds:[id(1)]})).rejects.toThrow('another record');
  });
  it('journals discard before deletion and recovers interrupted cleanup without deleting originals',async()=>{
    const f=await setup();const saved=await f.vault.stage(f.input);vi.mocked(f.files.remove).mockRejectedValueOnce(new Error('locked'));await expect(f.vault.discard(id(1))).rejects.toThrow('locked');expect((await f.session.getAttachment(id(1)))?.state).toBe('discarding');await expect(f.session.enqueue(f.operation,{id:entity},{attachmentIds:[id(1)]})).rejects.toThrow('unavailable');await f.vault.recover();expect((await f.session.getAttachment(id(1)))).toMatchObject({state:'discarded',sha256:saved.sha256,name:'photo.png'});expect(existsSync(f.path(id(1),'blob'))).toBe(false);expect(existsSync(f.picked)).toBe(true);expect(await f.store.countUnresolvedForUser(user)).toBe(0);
  });
  it('cannot confirm late copies after account replacement; original scope can recover later',async()=>{
    const f=await setup();let release!:()=>void;const wait=new Promise<void>(yes=>{release=yes});vi.mocked(f.files.copy).mockImplementationOnce(async(uri,asset)=>{copyFileSync(fileURLToPath(uri),f.path(asset,'part'));await wait});const pending=f.vault.stage(f.input);await vi.waitFor(()=>expect(f.files.copy).toHaveBeenCalledOnce());f.mode.allowed=false;const other=f.store.activate({...scope,userId:id(3)});release();await expect(pending).rejects.toThrow('access changed');expect(await other.listAttachments()).toEqual([]);await expect(other.getAttachment(id(1))).resolves.toBeNull();expect(await f.store.countUnresolvedForUser(user)).toBe(1);
  });
  it('upgrades v6 without changing existing operations, downloads or raw bases',async()=>{
    const f=await setup();await f.session.enqueue(f.operation,{id:entity,notes:'Saved'});await f.session.restartFleetDownload('previous-plan');const before=await f.session.list();f.vault.dispose();f.store.pause();f.sqlite.exec('DROP TABLE offline_company_snapshots; DROP TABLE offline_user_snapshots; DROP TABLE offline_attachment_documents; DROP TABLE offline_attachment_uploads; DROP TABLE offline_attachment_refs; DROP TABLE offline_attachments; ALTER TABLE offline_operations DROP COLUMN attachment_ids_json; PRAGMA user_version=6;');
    const restored=(await createOfflineOutbox(f.db)).activate(scope);expect(await restored.list()).toEqual(before);expect((await restored.getFleetDownload())?.generationId).toBe('previous-plan');expect((await restored.listRecords())[0].record).toEqual({id:entity,unit:'E1'});expect(await restored.listAttachments()).toEqual([]);expect(f.sqlite.prepare('PRAGMA user_version').get()).toEqual({user_version:12});
  });
  it('enforces byte bounds and a quota across the same user’s companies',async()=>{
    const f=await setup();const intent:OfflineAttachmentIntent={...scope,attachmentId:id(1),entityType:'vehicle',entityId:entity,name:'file',mimeType:null,byteSize:offlineAttachmentMaxBytes,sha256:'a'.repeat(64),deviceId:id(99),savedAt:date,connectivity:'offline'};
    for(let i=1;i<=10;i++)await f.session.reserveAttachment({...intent,attachmentId:id(i)});const other=f.store.activate({...scope,companyId:id(5)});await expect(other.reserveAttachment({...intent,companyId:id(5),attachmentId:id(11),byteSize:1})).rejects.toThrow('quota');expect(()=>other.reserveAttachment({...intent,companyId:id(5),attachmentId:id(12),byteSize:offlineAttachmentMaxBytes+1})).toThrow('bytes');
  });
});
