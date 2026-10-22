import {describe,expect,it} from 'vitest';
import {attachmentUploadContentType,attachmentUploadPath,attachmentUploadStage,decodeAttachmentUploadManifest,decodeAttachmentUploadReservation,type AttachmentUploadManifest} from './attachment-upload';
const manifest:AttachmentUploadManifest={attachmentId:'40000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001',entityType:'vehicle',entityId:'30000000-0000-4000-8000-000000000001',name:'Photo.jpg',mimeType:'image/jpeg',byteSize:1024,sha256:'a'.repeat(64),deviceId:'device-1',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'};
const path=`${manifest.companyId}/${manifest.userId}/${manifest.attachmentId}`;
const objectId='50000000-0000-4000-8000-000000000001';
const reservation=(changes:Record<string,unknown>={})=>({schemaVersion:1,manifest,bucket:'fleet-sync-files',path,contentType:'image/jpeg',receivedAt:'2026-01-02T00:00:00Z',object:null,receipt:null,...changes});
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
