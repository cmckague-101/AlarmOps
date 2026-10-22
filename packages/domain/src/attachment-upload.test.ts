import {describe,expect,it} from 'vitest';
import {attachmentUploadContentType,attachmentUploadPath,attachmentUploadStage,decodeAttachmentUploadManifest,decodeAttachmentUploadReservation,type AttachmentUploadManifest} from './attachment-upload';
const manifest:AttachmentUploadManifest={attachmentId:'40000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001',entityType:'vehicle',entityId:'30000000-0000-4000-8000-000000000001',name:'Photo.jpg',mimeType:'image/jpeg',byteSize:1024,sha256:'a'.repeat(64),deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'};
const path=`${manifest.companyId}/${manifest.userId}/${manifest.attachmentId}`;
const objectId='50000000-0000-4000-8000-000000000001';
const reservation=(changes:Record<string,unknown>={})=>({schemaVersion:1,manifest,bucket:'fleet-sync-files',path,contentType:'image/jpeg',receivedAt:'2026-01-02T00:00:00Z',object:null,receipt:null,release:null,...changes});
const receipt=(changes:Record<string,unknown>={})=>({schemaVersion:1,kind:'uploaded',companyId:manifest.companyId,userId:manifest.userId,attachmentId:manifest.attachmentId,entityType:'vehicle',entityId:manifest.entityId,bucket:'fleet-sync-files',path,byteSize:1024,sha256:'a'.repeat(64),objectId,verifiedAt:'2026-01-02T00:01:00Z',...changes});
const stored={objectId,updatedAt:'2026-01-02T00:00:30Z',byteSize:1024};
describe('attachment upload contract',()=>{
  it('derives a stable company/user/attachment path and supported upload type',()=>{
    expect(attachmentUploadPath(manifest)).toBe(path);expect(()=>attachmentUploadPath({...manifest,userId:'../other'})).toThrow();
    expect(attachmentUploadContentType(manifest)).toBe('image/jpeg');expect(attachmentUploadContentType({mimeType:null})).toBeNull();expect(attachmentUploadContentType({mimeType:'text/html'})).toBeNull();
  });
  it('rejects manifests with extra fields or invalid identity, bytes or provenance',()=>{
    expect(decodeAttachmentUploadManifest(manifest)).toEqual(manifest);
    for(const change of [{extra:1},{attachmentId:'X'},{byteSize:0},{byteSize:attachmentLimit()},{sha256:'A'.repeat(64)},{name:'a\u007f'},{savedAt:'2026-01-01'},{connectivity:'wifi'},{entityType:'crew'},{deviceId:' '}])
      expect(()=>decodeAttachmentUploadManifest({...manifest,...change})).toThrow();
  });
  it('binds reservations to the exact retained intent and reports progress truthfully',()=>{
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation(),manifest))).toBe('reserved');
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({object:stored}),manifest))).toBe('stored_unverified');
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({object:{...stored,byteSize:null}}),manifest))).toBe('stored_unverified');
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({object:{...stored,byteSize:12}}),manifest))).toBe('stored_size_mismatch');
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({object:stored,receipt:receipt()}),manifest))).toBe('verified');
    for(const change of [{path:'other'},{bucket:'fleet-files'},{contentType:'image/png'},{manifest:{...manifest,sha256:'b'.repeat(64)}},{receivedAt:'never'}])
      expect(()=>decodeAttachmentUploadReservation(reservation(change),manifest)).toThrow();
  });
  it('never accepts a receipt for different bytes or a replaced/missing object',()=>{
    for(const change of [{sha256:'b'.repeat(64)},{byteSize:2},{entityId:manifest.attachmentId},{kind:'attached'},{path:'other'}])
      expect(()=>decodeAttachmentUploadReservation(reservation({object:stored,receipt:receipt(change)}),manifest)).toThrow();
    expect(()=>decodeAttachmentUploadReservation(reservation({receipt:receipt()}),manifest)).toThrow(/unavailable or was replaced/);
    expect(()=>decodeAttachmentUploadReservation(reservation({object:{...stored,objectId:'50000000-0000-4000-8000-000000000002'},receipt:receipt()}),manifest)).toThrow(/replaced/);
  });
});
function attachmentLimit(){return 10*1024*1024+1}
describe('attachment document reference contract',()=>{
  const input={requestId:'60000000-0000-4000-8000-000000000001',documentName:' Registration ',deviceId:'device-1',savedAt:'2026-01-03T00:00:00.000Z',connectivity:'offline' as const};
  it('builds a vehicle-only immutable request and validates applied/rejected results',async()=>{
    const {createAttachmentDocumentRequest,decodeAttachmentDocumentResult}=await import('./attachment-upload');
    const request=createAttachmentDocumentRequest(manifest,input);expect(request).toMatchObject({entityType:'vehicle',entityId:manifest.entityId,attachmentId:manifest.attachmentId,documentName:'Registration',provenance:{userId:manifest.userId}});
    expect(()=>createAttachmentDocumentRequest({...manifest,entityType:'issue'},input)).toThrow(/vehicle/);expect(()=>createAttachmentDocumentRequest({...manifest,byteSize:8*1024*1024+1},input)).toThrow(/8 MB/);expect(()=>createAttachmentDocumentRequest(manifest,{...input,documentName:' '})).toThrow();
    const applied={kind:'applied',receivedAt:'2026-01-03T00:00:01Z',revision:'2',documentId:manifest.attachmentId,path:`${manifest.companyId}/${manifest.userId}/sync-${manifest.attachmentId}`};
    expect(decodeAttachmentDocumentResult(applied,request)).toEqual(applied);
    for(const change of [{path:'other'},{documentId:'x'},{revision:'0'},{kind:'synced'}])expect(()=>decodeAttachmentDocumentResult({...applied,...change},request)).toThrow();
    expect(decodeAttachmentDocumentResult({kind:'rejected',receivedAt:applied.receivedAt,reason:'record_deleted'},request).kind).toBe('rejected');
    expect(()=>decodeAttachmentDocumentResult({kind:'rejected',receivedAt:applied.receivedAt,reason:'other'},request)).toThrow();
  });
});
describe('released staging copies',()=>{
  const removed={reason:'applied',requestedAt:'2026-01-03T00:00:00Z',objectRemovedAt:'2026-01-03T00:00:01Z'};
  it('accepts receipts without objects only after release and classifies them as released',()=>{
    const value=decodeAttachmentUploadReservation(reservation({receipt:receipt(),release:removed}),manifest);expect(attachmentUploadStage(value)).toBe('released');expect(value.release).toEqual(removed);
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({object:stored,receipt:receipt(),release:{...removed,objectRemovedAt:null}}),manifest))).toBe('released');
    expect(attachmentUploadStage(decodeAttachmentUploadReservation(reservation({release:{...removed,reason:'user_released'}}),manifest))).toBe('released');
    expect(decodeAttachmentUploadReservation((({release:_r,...rest})=>rest)(reservation()),manifest).release).toBeNull();
  });
  it('rejects inconsistent releases',()=>{
    for(const release of [{...removed,reason:'expired'},{...removed,requestedAt:'never'},removed])expect(()=>decodeAttachmentUploadReservation(reservation({release}),manifest)).toThrow();
    expect(()=>decodeAttachmentUploadReservation(reservation({object:stored,receipt:receipt(),release:removed}),manifest)).toThrow(/still exists/);
  });
});
