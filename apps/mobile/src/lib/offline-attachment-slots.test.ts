import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,renameSync,existsSync,unlinkSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {vehicleSlotFileValue,type AttachmentUploadManifest,type SyncRecord} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxEntry,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineAttachmentVault,type OfflineAttachmentFiles} from './offline-attachment-vault';
import {createOfflineAttachmentUploader} from './offline-attachment-upload';
import {createOfflineDetailEditor} from './offline-detail-editor';
import {createOfflineSyncWorker,type OfflineSyncTransport} from './offline-sync-worker';
import {createSlotAttachmentPreparer,createSlotAttachmentSettler,settledSlotFields,slotConfirmedInRecord} from './offline-attachment-slots';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',entity='30000000-0000-4000-8000-000000000001';
const scope={userId:user,companyId:company};const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const date='2026-01-01T00:00:00.000Z';
const bytes=new Uint8Array([0,255,1,9,17]);const legacy={name:'old.jpg',type:'image/jpeg',dataUrl:'',path:`${company}/${user}/legacy.jpg`};
const base={id:entity,unit:'E1',photo:legacy};
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
function database(path:string){
  const sqlite=new DatabaseSync(path);cleanup.push(()=>sqlite.close());
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};return db;
}
async function setup(){
  const root=mkdtempSync(join(tmpdir(),'offline-slots-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const store=await createOfflineOutbox(database(join(root,'store.db')));const session=store.activate(scope);
  await session.putRecord('vehicle',entity,{revision:'1',record:base});
  const directory=join(root,'managed');mkdirSync(directory,{recursive:true});const file=(asset:string,slot:string)=>join(directory,`${asset}.${slot}`);
  const hash=(value:Uint8Array)=>({byteSize:value.byteLength,sha256:createHash('sha256').update(value).digest('hex')});
  const files:OfflineAttachmentFiles={source:async uri=>hash(readFileSync(fileURLToPath(uri))),inspect:async(asset,slot)=>existsSync(file(asset,slot))?hash(readFileSync(file(asset,slot))):null,copy:async(uri,asset)=>{copyFileSync(fileURLToPath(uri),file(asset,'part'))},promote:async asset=>{renameSync(file(asset,'part'),file(asset,'blob'))},remove:async(asset,slot)=>{if(existsSync(file(asset,slot)))unlinkSync(file(asset,slot))},uri:asset=>pathToFileURL(file(asset,'blob')).href};
  const vault=createOfflineAttachmentVault({session,files,canAccess:()=>true,createId:()=>id(99),connectivity:()=>'offline',now:()=>date});cleanup.push(()=>vault.dispose());
  const picked=join(root,'picked.jpg');writeFileSync(picked,bytes);
  const asset=await vault.stage({attachmentId:id(1),entityType:'vehicle',entityId:entity,uri:pathToFileURL(picked).href,name:'Front.jpg',mimeType:'image/jpeg'});
  const {state:_s,error:_e,...manifest}=asset;const value=vehicleSlotFileValue(manifest as AttachmentUploadManifest);
  const verified={schemaVersion:1,manifest,bucket:'fleet-sync-files',path:`${company}/${user}/${id(1)}`,contentType:'image/jpeg',receivedAt:date,object:{objectId:id(70),updatedAt:date,byteSize:5},release:null,
    receipt:{schemaVersion:1,kind:'uploaded',companyId:company,userId:user,attachmentId:id(1),entityType:'vehicle',entityId:entity,bucket:'fleet-sync-files',path:`${company}/${user}/${id(1)}`,byteSize:5,sha256:manifest.sha256,objectId:id(70),verifiedAt:date}};
  const uploadTransport={reserve:vi.fn().mockResolvedValue(verified),upload:vi.fn(),verify:vi.fn()};
  const uploader=createOfflineAttachmentUploader({session,vault,transport:uploadTransport,canRun:()=>true});
  const copy=vi.fn().mockResolvedValue({kind:'ready',value,stagingReleased:true});
  const prepare=createSlotAttachmentPreparer({session,uploader,transport:{copy}});
  const editor=createOfflineDetailEditor({session,readRecord:vi.fn(),canEdit:()=>true,offline:()=>true,id:()=>id(50),now:()=>date,changed:async()=>{}});cleanup.push(()=>editor.dispose());
  const syncTransport={deliver:vi.fn<OfflineSyncTransport['deliver']>(async()=>({kind:'applied',receivedAt:date,revision:'2',record:{...base,photo:value}})),
    canonical:vi.fn().mockResolvedValue({revision:'2',record:{...base,photo:value}}),outcome:vi.fn().mockResolvedValue(null),readRecord:vi.fn()};
  let token=0;const worker=createOfflineSyncWorker({session,transport:syncTransport,canAccess:()=>true,canRun:()=>true,token:()=>`attempt-${++token}`,now:()=>0,timeoutMs:1000,prepareAttachments:prepare});cleanup.push(()=>worker.stop());
  const settle=createSlotAttachmentSettler({session,discard:value=>vault.discard(value)});
  return {session,store,vault,uploadTransport,uploader,copy,prepare,editor,syncTransport,worker,settle,value,manifest,file,signal:new AbortController().signal};
}
describe('offline vehicle file slots (actual SQLite and files)',()=>{
  it('saves a slot replacement bound to its file and refuses hand-written or mismatched values',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:entity});
    await expect(f.editor.save(draft,{photo:f.value})).rejects.toThrow(/saved device file/);
    await expect(f.editor.save(draft,{photo:{...f.value,path:`${company}/${user}/legacy.jpg`}},{attachmentIds:[id(1)]})).rejects.toThrow(/saved device file/);
    await expect(f.editor.save(draft,{},{remove:['unit']})).rejects.toThrow(/file slots/);
    const entry=await f.editor.save(draft,{photo:f.value},{attachmentIds:[id(1)]});
    expect(entry.attachmentIds).toEqual([id(1)]);expect(entry.operation.mutation.kind==='update'&&entry.operation.mutation.patch).toEqual({photo:{present:true,value:f.value}});
    await expect(f.editor.save(draft,{photo:f.value})).rejects.toThrow();expect(await f.editor.save(draft,{photo:f.value},{attachmentIds:[id(1)]})).toEqual(entry);
    await expect(f.vault.discard(id(1))).rejects.toThrow(/reference/);
  });
  it('uploads and proves the file before delivering the unchanged record change, then settles and removes the device copy',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:entity});await f.editor.save(draft,{photo:f.value},{attachmentIds:[id(1)]});
    f.syncTransport.deliver.mockImplementationOnce(async operation=>{expect(f.copy).toHaveBeenCalledOnce();expect((await f.session.getAttachmentUpload(id(1)))?.stage).toBe('verified');expect(operation.mutation.kind==='update'&&operation.mutation.patch).toEqual({photo:{present:true,value:f.value}});return {kind:'applied',receivedAt:date,revision:'2',record:{...base,photo:f.value}}});
    await f.worker.wake();const [entry]=await f.session.list();expect(entry.status).toBe('synced');
    await f.settle(f.signal);expect((await f.session.getAttachment(id(1)))?.state).toBe('discarded');expect(existsSync(f.file(id(1),'blob'))).toBe(false);
    expect(await f.session.listAttachmentReferences()).toEqual([]);expect((await f.session.listAttachmentReleases())[0].state).toBe('pending');
  });
  it('keeps file-bearing work pending while bytes or the copy are not ready, and blocks mismatched work',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:entity});await f.editor.save(draft,{photo:f.value},{attachmentIds:[id(1)]});
    f.copy.mockResolvedValueOnce({kind:'not_ready'});await f.worker.wake();
    expect((await f.session.list())[0]).toMatchObject({status:'pending',error:expect.stringContaining('preparing')});expect(f.syncTransport.deliver).not.toHaveBeenCalled();
    const entry=(await f.session.list())[0];const forged={...entry,operation:{...entry.operation,mutation:{...entry.operation.mutation,patch:{photo:{present:true,value:{...f.value,name:'Other.jpg'}}}}}} as OutboxEntry;
    expect(await f.prepare(forged,f.signal)).toMatchObject({kind:'blocked'});
    f.copy.mockResolvedValueOnce({kind:'access_revoked'});expect(await f.prepare(entry,f.signal)).toMatchObject({kind:'blocked',error:expect.stringContaining('owner/admin')});
    f.copy.mockResolvedValueOnce({kind:'ready',value:{...f.value,path:'elsewhere'}});expect((await f.prepare(entry,f.signal)).kind).toBe('pending');
  });
  it('waits for a verified record showing the file before removing the device copy',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:entity});await f.editor.save(draft,{photo:f.value},{attachmentIds:[id(1)]});
    f.syncTransport.canonical.mockResolvedValue({revision:'2',record:base});f.syncTransport.deliver.mockResolvedValueOnce({kind:'applied',receivedAt:date,revision:'2',record:base});
    await f.worker.wake();await f.settle(f.signal);expect((await f.session.getAttachment(id(1)))?.state).toBe('ready');expect((await f.session.listAttachmentReferences()).length).toBe(1);
    await f.session.putRecord('vehicle',entity,{revision:'3',record:{...base,photo:f.value}});await f.settle(f.signal);expect((await f.session.getAttachment(id(1)))?.state).toBe('discarded');
  });
  it('clears a slot without any file and never removes the previous file',async()=>{
    const f=await setup();const draft=await f.editor.prepare({entityType:'vehicle',entityId:entity});const entry=await f.editor.save(draft,{},{remove:['photo']});
    expect(entry.attachmentIds).toBeUndefined();expect(entry.operation.mutation.kind==='update'&&entry.operation.mutation.patch).toEqual({photo:{present:false}});
    await f.worker.wake();expect(f.copy).not.toHaveBeenCalled();expect(f.syncTransport.deliver).toHaveBeenCalledOnce();
  });
});
describe('final result rules for file slots',()=>{
  const entry=(changes:Partial<OutboxEntry>)=>({operation:{entityId:entity,mutation:{kind:'update',patch:{photo:{present:true,value:{path:'p'}},notes:{present:true,value:'n'}}}},attachmentIds:[id(1)],receipt:null,reviewOutcome:null,status:'pending',...changes}) as unknown as OutboxEntry;
  const outcome=(kind:'kept'|'partially_kept'|'not_selected',kept:string[])=>({kind:'reviewed',outcome:kind,keptFields:kept,discardedFields:[],revision:'4'}) as never;
  it('keeps files only when the server kept their slot',()=>{
    expect(settledSlotFields(entry({}))).toBeNull();
    expect(settledSlotFields(entry({status:'synced',receipt:{kind:'applied',receivedAt:date,revision:'2',record:null}}))).toEqual({kept:['photo'],revision:'2'});
    expect(settledSlotFields(entry({status:'synced',reviewOutcome:outcome('kept',['photo','notes'])}))).toEqual({kept:['photo'],revision:'4'});
    expect(settledSlotFields(entry({status:'blocked',reviewOutcome:outcome('partially_kept',['notes'])}))).toEqual({kept:[],revision:'4'});
    expect(settledSlotFields(entry({status:'not_selected',reviewOutcome:outcome('not_selected',[])}))).toEqual({kept:[],revision:'4'});
  });
  it('confirms by exact value at or after the result revision',()=>{
    const value=entry({status:'synced'});const records=(revision:string,photo:SyncRecord[string])=>[{entityType:'vehicle' as const,entityId:entity,revision,verifiedAt:date,record:{id:entity,photo}}];
    expect(slotConfirmedInRecord(value,'photo','2',records('2',{path:'p'}))).toBe(true);expect(slotConfirmedInRecord(value,'photo','2',records('1',{path:'p'}))).toBe(false);
    expect(slotConfirmedInRecord(value,'photo','2',records('3',{path:'q'}))).toBe(false);expect(slotConfirmedInRecord(value,'photo',null,records('3',{path:'p'}))).toBe(false);
  });
});
