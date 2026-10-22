import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,renameSync,existsSync,unlinkSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {AttachmentUploadManifest} from '@fireops/domain';
import {createOfflineOutbox,type OutboxDatabase,type OutboxSqlConnection,type OutboxSqlValue} from './offline-outbox';
import {createOfflineAttachmentVault,type OfflineAttachmentFiles} from './offline-attachment-vault';
import {createOfflineAttachmentUploader,type AttachmentUploadTransport} from './offline-attachment-upload';
import {createNativeAttachmentUploadTransport} from './offline-attachment-upload-transport';
const user='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001',entity='30000000-0000-4000-8000-000000000001';
const scope={userId:user,companyId:company};const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const date='2026-01-01T00:00:00.000Z';
const objectId='50000000-0000-4000-8000-000000000001';const bytes=new Uint8Array([0,255,1,9,17]);const sha=createHash('sha256').update(bytes).digest('hex');
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()});
function database(path:string){
  const sqlite=new DatabaseSync(path);let closed=false;const close=()=>{if(!closed){sqlite.close();closed=true}};cleanup.push(close);
  const tx:OutboxSqlConnection={async execAsync(sql){sqlite.exec(sql)},async runAsync(sql,...args){return {changes:Number(sqlite.prepare(sql).run(...args).changes)}},async getFirstAsync<T>(sql:string,...args:OutboxSqlValue[]){return (sqlite.prepare(sql).get(...args) as T|undefined)??null},async getAllAsync<T>(sql:string,...args:OutboxSqlValue[]){return sqlite.prepare(sql).all(...args) as T[]}};
  const db:OutboxDatabase={...tx,async withExclusiveTransactionAsync(fn){sqlite.exec('BEGIN IMMEDIATE');try{await fn(tx);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}}};return {db,sqlite,close};
}
const path=`${company}/${user}/${id(1)}`;
const reservation=(manifest:AttachmentUploadManifest,changes:Record<string,unknown>={})=>({schemaVersion:1,manifest,bucket:'fleet-sync-files',path,contentType:'image/png',receivedAt:'2026-01-02T00:00:00Z',object:null,receipt:null,...changes});
const stored={objectId,updatedAt:'2026-01-02T00:00:30Z',byteSize:5};
const receipt={schemaVersion:1,kind:'uploaded',companyId:company,userId:user,attachmentId:id(1),entityType:'vehicle',entityId:entity,bucket:'fleet-sync-files',path,byteSize:5,sha256:sha,objectId,verifiedAt:'2026-01-02T00:01:00Z'};
async function setup(existingRoot?:string,mimeType:string|null='image/png'){
  const root=existingRoot??mkdtempSync(join(tmpdir(),'offline-upload-'));if(!existingRoot)cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const data=database(join(root,'store.db'));const store=await createOfflineOutbox(data.db);const session=store.activate(scope);
  await session.putRecord('vehicle',entity,{revision:'1',record:{id:entity,unit:'E1'}});
  const directory=join(root,'managed');mkdirSync(directory,{recursive:true});const file=(asset:string,slot:string)=>join(directory,`${asset}.${slot}`);
  const hash=(value:Uint8Array)=>({byteSize:value.byteLength,sha256:createHash('sha256').update(value).digest('hex')});
  const files:OfflineAttachmentFiles={source:async uri=>hash(readFileSync(fileURLToPath(uri))),inspect:async(asset,slot)=>existsSync(file(asset,slot))?hash(readFileSync(file(asset,slot))):null,copy:async(uri,asset)=>{copyFileSync(fileURLToPath(uri),file(asset,'part'))},promote:async asset=>{renameSync(file(asset,'part'),file(asset,'blob'))},remove:async(asset,slot)=>{if(existsSync(file(asset,slot)))unlinkSync(file(asset,slot))},uri:asset=>pathToFileURL(file(asset,'blob')).href};
  const mode={run:true};const vault=createOfflineAttachmentVault({session,files,canAccess:()=>true,createId:()=>id(99),connectivity:()=>'offline',now:()=>date});cleanup.push(()=>vault.dispose());
  const picked=join(root,'picked.tmp');writeFileSync(picked,bytes);
  if(!existingRoot)await vault.stage({attachmentId:id(1),entityType:'vehicle',entityId:entity,uri:pathToFileURL(picked).href,name:'photo.png',mimeType});
  const {state:_s,error:_e,...manifest}=(await session.getAttachment(id(1)))!;
  const transport={reserve:vi.fn<AttachmentUploadTransport['reserve']>().mockResolvedValue(reservation(manifest)),upload:vi.fn<AttachmentUploadTransport['upload']>().mockResolvedValue('stored'),
    verify:vi.fn<AttachmentUploadTransport['verify']>().mockResolvedValue({kind:'verified',reservation:reservation(manifest,{object:stored,receipt})})};
  const uploader=createOfflineAttachmentUploader({session,vault,transport,canRun:()=>mode.run});
  return {...data,root,store,session,vault,transport,uploader,mode,manifest,signal:new AbortController().signal,file};
}
describe('native attachment byte upload and receipts (actual SQLite)',()=>{
  it('persists uncertainty before sending bytes and keeps the verified receipt across restart',async()=>{
    const f=await setup();f.transport.upload.mockImplementation(async(_reservation,uri)=>{
      expect(await f.session.getAttachmentUpload(id(1))).toMatchObject({stage:'uploading',attempts:1});expect(readFileSync(fileURLToPath(uri))).toEqual(Buffer.from(bytes));return 'stored'});
    const result=await f.uploader.upload(id(1),f.signal);expect(result).toMatchObject({stage:'verified',error:null,receipt:{sha256:sha,objectId}});
    expect(f.transport.reserve).toHaveBeenCalledWith(f.manifest,f.signal);
    f.store.pause();f.close();const again=await setup(f.root);expect(await again.session.getAttachmentUpload(id(1))).toEqual(result);
    expect(await again.uploader.upload(id(1),again.signal)).toEqual(result);expect(again.transport.reserve).not.toHaveBeenCalled();
    expect((await again.session.getAttachment(id(1)))?.state).toBe('ready');expect(await again.session.listAttachmentReferences()).toEqual([]);
  });
  it('after a lost upload response retries with the same identity and does not resend stored bytes',async()=>{
    const f=await setup();f.transport.upload.mockRejectedValueOnce(new Error('network lost'));
    await expect(f.uploader.upload(id(1),f.signal)).rejects.toThrow('network lost');expect(await f.session.getAttachmentUpload(id(1))).toMatchObject({stage:'uploading',error:'network lost',receipt:null});
    f.transport.reserve.mockResolvedValueOnce(reservation(f.manifest,{object:stored}));
    expect((await f.uploader.upload(id(1),f.signal)).stage).toBe('verified');expect(f.transport.upload).toHaveBeenCalledOnce();expect(f.transport.reserve.mock.calls.every(call=>call[0]===f.manifest||call[0].attachmentId===id(1))).toBe(true);
  });
  it('treats verifier mismatch as not uploaded and sends the original bytes again',async()=>{
    const f=await setup();f.transport.verify.mockResolvedValueOnce({kind:'mismatch',objectRemoved:true});
    expect(await f.uploader.upload(id(1),f.signal)).toMatchObject({stage:'reserved',receipt:null,error:expect.stringContaining('did not match')});
    expect((await f.uploader.upload(id(1),f.signal)).stage).toBe('verified');expect(f.transport.upload).toHaveBeenCalledTimes(2);
  });
  it('keeps stored-but-unverified bytes pending while verification is busy',async()=>{
    const f=await setup();f.transport.verify.mockResolvedValueOnce({kind:'in_progress'});
    expect(await f.uploader.upload(id(1),f.signal)).toMatchObject({stage:'stored',receipt:null});
  });
  it('blocks conflicting, unauthorized and unsupported uploads without discarding device bytes',async()=>{
    for(const [error,message] of [[{code:'PT409'},'different bytes'],[{code:'42501'},'owner/admin']] as const){
      const f=await setup();f.transport.reserve.mockRejectedValueOnce(error);await expect(f.uploader.upload(id(1),f.signal)).rejects.toBe(error);
      expect(await f.session.getAttachmentUpload(id(1))).toMatchObject({stage:'blocked',error:expect.stringContaining(message)});expect((await f.session.getAttachment(id(1)))?.state).toBe('ready');
    }
    const unsupported=await setup(undefined,null);expect(await unsupported.uploader.upload(id(1),unsupported.signal)).toMatchObject({stage:'blocked',reservation:null});expect(unsupported.transport.reserve).not.toHaveBeenCalled();
  });
  it('never records receipts for different bytes, replaced objects or changed reservations',async()=>{
    const f=await setup();
    f.transport.verify.mockResolvedValueOnce({kind:'verified',reservation:reservation(f.manifest,{object:stored,receipt:{...receipt,sha256:'b'.repeat(64)}})});
    await expect(f.uploader.upload(id(1),f.signal)).rejects.toThrow();expect((await f.session.getAttachmentUpload(id(1)))?.receipt).toBeNull();
    f.transport.verify.mockResolvedValueOnce({kind:'verified',reservation:reservation(f.manifest,{object:{...stored,objectId:id(7)},receipt})});
    await expect(f.uploader.upload(id(1),f.signal)).rejects.toThrow(/replaced/);
    f.transport.reserve.mockResolvedValueOnce(reservation(f.manifest,{receivedAt:'2026-03-01T00:00:00Z'}));await expect(f.uploader.upload(id(1),f.signal)).rejects.toThrow(/reservation changed/);
    await expect(f.session.recordAttachmentUpload(id(1),{stage:'verified',reservation:reservation(f.manifest)})).rejects.toThrow(/receipt/);
    const done=await f.uploader.upload(id(1),f.signal);expect(done.stage).toBe('verified');
    expect(await f.session.recordAttachmentUpload(id(1),{stage:'blocked',error:'late'})).toEqual(done);
  });
  it('requires a verified device copy and stops on pause without recording a failure',async()=>{
    const f=await setup();await f.session.missingAttachment(id(1),'gone');await expect(f.uploader.upload(id(1),f.signal)).rejects.toThrow(/verified device copy/);expect(f.transport.reserve).not.toHaveBeenCalled();
    const g=await setup();g.transport.reserve.mockImplementationOnce(async manifest=>{g.mode.run=false;return reservation(manifest)});
    await expect(g.uploader.upload(id(1),g.signal)).rejects.toMatchObject({code:'SYNC_PAUSED'});expect(g.transport.upload).not.toHaveBeenCalled();expect(await g.session.getAttachmentUpload(id(1))).toBeNull();
  });
  it('isolates upload progress by account and coalesces concurrent attempts',async()=>{
    const f=await setup();const [a,b]=await Promise.all([f.uploader.upload(id(1),f.signal),f.uploader.upload(id(1),f.signal)]);expect(a).toEqual(b);expect(f.transport.reserve).toHaveBeenCalledOnce();
    const other=f.store.activate({...scope,userId:id(3)});expect(await other.listAttachmentUploads()).toEqual([]);await expect(other.recordAttachmentUpload(id(1),{stage:'blocked',error:'x'})).rejects.toThrow(/not saved/);
  });
});

describe('account-bound native attachment transport',()=>{
  function transport(){
    const builder={setHeader:vi.fn().mockReturnThis(),abortSignal:vi.fn().mockResolvedValue({data:{ok:true},error:null})};const bucket={upload:vi.fn().mockResolvedValue({data:{},error:null})};
    const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:user},access_token:'bound-token'}},error:null})},rpc:vi.fn(()=>builder),storage:{from:vi.fn(()=>bucket)},functions:{invoke:vi.fn().mockResolvedValue({data:{kind:'verified'},error:null})}};
    const mode={run:true};const readBytes=vi.fn(async()=>bytes.buffer.slice(0));
    return {builder,bucket,client,mode,readBytes,value:createNativeAttachmentUploadTransport(client as unknown as SupabaseClient,scope,()=>mode.run,readBytes),signal:new AbortController().signal};
  }
  const manifest:AttachmentUploadManifest={attachmentId:id(1),userId:user,companyId:company,entityType:'vehicle',entityId:entity,name:'photo.png',mimeType:'image/png',byteSize:5,sha256:sha,deviceId:id(99),savedAt:date,connectivity:'offline'};
  const reserved={schemaVersion:1 as const,manifest,bucket:'fleet-sync-files' as const,path,contentType:'image/png' as const,receivedAt:date,object:null,receipt:null};
  it('reserves with the bound user token and uploads without overwrite',async()=>{
    const f=transport();await f.value.reserve(manifest,f.signal);expect(f.client.rpc).toHaveBeenCalledWith('reserve_fleet_sync_attachment',{manifest});expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-token');
    expect(await f.value.upload(reserved,'file:///copy',f.signal)).toBe('stored');expect(f.client.storage.from).toHaveBeenCalledWith('fleet-sync-files');expect(f.bucket.upload).toHaveBeenCalledWith(path,expect.any(ArrayBuffer),{contentType:'image/png',upsert:false});
    f.bucket.upload.mockResolvedValueOnce({data:null,error:{statusCode:'409',message:'The resource already exists'}});expect(await f.value.upload(reserved,'file:///copy',f.signal)).toBe('exists');
  });
  it('refuses foreign scope, wrong sessions and changed device copies before sending',async()=>{
    const f=transport();await expect(f.value.reserve({...manifest,companyId:id(5)},f.signal)).rejects.toMatchObject({code:'42501'});
    f.readBytes.mockResolvedValueOnce(new ArrayBuffer(4));await expect(f.value.upload(reserved,'file:///copy',f.signal)).rejects.toThrow(/changed/);
    f.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'x'}},error:null});await expect(f.value.verify(manifest,f.signal)).rejects.toMatchObject({code:'401'});
    expect(f.client.rpc).not.toHaveBeenCalled();expect(f.bucket.upload).not.toHaveBeenCalled();expect(f.client.functions.invoke).not.toHaveBeenCalled();
  });
  it('returns structured verifier outcomes from HTTP errors and maps revoked access',async()=>{
    const f=transport();f.client.functions.invoke.mockResolvedValueOnce({data:null,error:{context:new Response(JSON.stringify({kind:'mismatch'}),{status:409})}});
    expect(await f.value.verify(manifest,f.signal)).toEqual({kind:'mismatch'});
    expect(f.client.functions.invoke).toHaveBeenCalledWith('verify-fleet-sync-attachment',expect.objectContaining({body:{companyId:company,attachmentId:id(1)},headers:{Authorization:'Bearer bound-token'}}));
    f.client.functions.invoke.mockResolvedValueOnce({data:null,error:{context:new Response('{}',{status:403})}});await expect(f.value.verify(manifest,f.signal)).rejects.toMatchObject({code:'42501'});
    const network=new Error('offline');f.client.functions.invoke.mockResolvedValueOnce({data:null,error:network});await expect(f.value.verify(manifest,f.signal)).rejects.toBe(network);
  });
});
