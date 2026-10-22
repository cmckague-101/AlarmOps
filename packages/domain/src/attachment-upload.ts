// Remote ownership/byte-receipt contract for retained native attachment drafts.
// A verified upload receipt proves stored bytes only: it is NOT a business
// record attachment, a pending review or a synchronized change.
export const attachmentUploadBucket='fleet-sync-files';
export const attachmentUploadMaxBytes=10*1024*1024;
export const attachmentUploadContentTypes=['image/jpeg','image/png','image/webp','image/gif','application/pdf'] as const;
export type AttachmentUploadContentType=typeof attachmentUploadContentTypes[number];
export type AttachmentUploadManifest={attachmentId:string;userId:string;companyId:string;entityType:'vehicle'|'issue';entityId:string;name:string;mimeType:string|null;byteSize:number;sha256:string;deviceId:string;savedAt:string;connectivity:'online'|'offline'|'unknown'};
export type AttachmentUploadReceipt={schemaVersion:1;kind:'uploaded';companyId:string;userId:string;attachmentId:string;entityType:'vehicle'|'issue';entityId:string;bucket:typeof attachmentUploadBucket;path:string;byteSize:number;sha256:string;objectId:string;verifiedAt:string};
/** Storage metadata is reported by the Storage service and is NOT byte proof. */
export type AttachmentUploadObject={objectId:string;updatedAt:string;byteSize:number|null};
/** Staging copy released: applied documents (service) or an explicit user release. */
export type AttachmentUploadRelease={reason:'applied'|'user_released';requestedAt:string;objectRemovedAt:string|null};
export type AttachmentUploadReservation={schemaVersion:1;manifest:AttachmentUploadManifest;bucket:typeof attachmentUploadBucket;path:string;contentType:AttachmentUploadContentType;receivedAt:string;object:AttachmentUploadObject|null;receipt:AttachmentUploadReceipt|null;release:AttachmentUploadRelease|null};
/** never_sent/reserved need upload; stored_unverified needs the trusted verifier; mismatch needs investigation, not overwrite. */
export type AttachmentUploadStage='reserved'|'stored_unverified'|'stored_size_mismatch'|'verified'|'released';
const fields=['attachmentId','userId','companyId','entityType','entityId','name','mimeType','byteSize','sha256','deviceId','savedAt','connectivity'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Same shape the server accepts for device-reported save times.
const reportedTime=/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/;
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid attachment upload response.');return value as Record<string,unknown>};
const time=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function decodeAttachmentUploadManifest(value:unknown):AttachmentUploadManifest{
  const data=object(value);
  if(Object.keys(data).length!==fields.length||fields.some(field=>!Object.prototype.hasOwnProperty.call(data,field)))throw new Error('Invalid attachment manifest shape.');
  for(const field of ['attachmentId','userId','companyId','entityId'])if(typeof data[field]!=='string'||!uuid.test(data[field] as string))throw new Error('Invalid attachment upload identity.');
  if(!['vehicle','issue'].includes(data.entityType as string)||!['online','offline','unknown'].includes(data.connectivity as string))throw new Error('Unsupported attachment upload scope.');
  if(typeof data.name!=='string'||!data.name.trim()||data.name.length>255||/[\u0000-\u001f\u007f]/.test(data.name))throw new Error('Invalid attachment name.');
  if(data.mimeType!==null&&(typeof data.mimeType!=='string'||!data.mimeType.trim()||data.mimeType.length>200||/[\r\n\u0000]/.test(data.mimeType)))throw new Error('Invalid reported attachment MIME type.');
  if(!Number.isSafeInteger(data.byteSize)||(data.byteSize as number)<=0||(data.byteSize as number)>attachmentUploadMaxBytes||typeof data.sha256!=='string'||!/^[0-9a-f]{64}$/.test(data.sha256)||typeof data.deviceId!=='string'||!data.deviceId.trim()||data.deviceId.trim().length>200||!time(data.savedAt)||!reportedTime.test(data.savedAt as string))throw new Error('Invalid attachment byte/provenance declaration.');
  return Object.fromEntries(fields.map(field=>[field,data[field]])) as AttachmentUploadManifest;
}
/** Reported MIME type selects the upload content type; it is not content validation. */
export function attachmentUploadContentType(manifest:Pick<AttachmentUploadManifest,'mimeType'>):AttachmentUploadContentType|null{
  return (attachmentUploadContentTypes as readonly string[]).includes(manifest.mimeType as string)?manifest.mimeType as AttachmentUploadContentType:null;
}
export function attachmentUploadPath(value:Pick<AttachmentUploadManifest,'companyId'|'userId'|'attachmentId'>){
  for(const id of [value.companyId,value.userId,value.attachmentId])if(!uuid.test(id))throw new Error('Invalid upload path identity.');
  return `${value.companyId}/${value.userId}/${value.attachmentId}`;
}
export function decodeAttachmentUploadReceipt(value:unknown,expected:AttachmentUploadManifest):AttachmentUploadReceipt{
  const data=object(value);
  if(data.schemaVersion!==1||data.kind!=='uploaded'||data.bucket!==attachmentUploadBucket||data.path!==attachmentUploadPath(expected)||!time(data.verifiedAt)||typeof data.objectId!=='string'||!uuid.test(data.objectId))throw new Error('Invalid verified upload receipt.');
  for(const field of ['companyId','userId','attachmentId','entityType','entityId','byteSize','sha256'] as const)if(data[field]!==expected[field])throw new Error('Upload receipt does not match retained attachment intent.');
  return {schemaVersion:1,kind:'uploaded',companyId:expected.companyId,userId:expected.userId,attachmentId:expected.attachmentId,entityType:expected.entityType,entityId:expected.entityId,bucket:attachmentUploadBucket,path:data.path as string,byteSize:expected.byteSize,sha256:expected.sha256,objectId:data.objectId,verifiedAt:data.verifiedAt as string};
}
export function decodeAttachmentUploadReservation(value:unknown,expected:AttachmentUploadManifest):AttachmentUploadReservation{
  const data=object(value);const manifest=decodeAttachmentUploadManifest(data.manifest);
  if(fields.some(field=>manifest[field]!==expected[field])||data.schemaVersion!==1||data.bucket!==attachmentUploadBucket||data.path!==attachmentUploadPath(expected)||!time(data.receivedAt))throw new Error('Upload reservation does not match retained attachment intent.');
  const contentType=attachmentUploadContentType(manifest);
  if(!contentType||data.contentType!==contentType)throw new Error('Upload reservation content type does not match retained attachment intent.');
  let stored:AttachmentUploadObject|null=null;
  if(data.object!==null){
    const item=object(data.object);
    if(typeof item.objectId!=='string'||!uuid.test(item.objectId)||!time(item.updatedAt)||(item.byteSize!==null&&!Number.isSafeInteger(item.byteSize)))throw new Error('Invalid remote object metadata.');
    stored={objectId:item.objectId,updatedAt:item.updatedAt as string,byteSize:item.byteSize as number|null};
  }
  const receipt=data.receipt===null?null:decodeAttachmentUploadReceipt(data.receipt,expected);
  let release:AttachmentUploadRelease|null=null;
  if(data.release!==undefined&&data.release!==null){
    const item=object(data.release);
    if(!['applied','user_released'].includes(item.reason as string)||!time(item.requestedAt)||(item.objectRemovedAt!==null&&!time(item.objectRemovedAt)))throw new Error('Invalid upload release.');
    if(item.reason==='applied'&&!receipt)throw new Error('Only verified uploads are released as applied documents.');
    if(item.objectRemovedAt!==null&&stored)throw new Error('Released remote object still exists.');
    release={reason:item.reason as AttachmentUploadRelease['reason'],requestedAt:item.requestedAt as string,objectRemovedAt:item.objectRemovedAt as string|null};
  }
  // After release the staging object is legitimately gone; otherwise a receipt needs its exact object.
  if(receipt&&(stored?stored.objectId!==receipt.objectId:!release))throw new Error('Verified remote object is unavailable or was replaced.');
  return {schemaVersion:1,manifest,bucket:attachmentUploadBucket,path:data.path as string,contentType,receivedAt:data.receivedAt as string,object:stored,receipt,release};
}
export function attachmentUploadStage(reservation:AttachmentUploadReservation):AttachmentUploadStage{
  if(reservation.release)return 'released';
  if(reservation.receipt)return 'verified';
  if(!reservation.object)return 'reserved';
  return reservation.object.byteSize!==null&&reservation.object.byteSize!==reservation.manifest.byteSize?'stored_size_mismatch':'stored_unverified';
}

/** Legacy fleet-files bucket limit; vehicle documents are copied there for existing viewers. */
export const attachmentDocumentMaxBytes=8*1024*1024;
/** One vehicle-document reference for verified bytes. Issues have no file field yet. */
export type AttachmentDocumentRequest={schemaVersion:1;requestId:string;companyId:string;entityType:'vehicle';entityId:string;attachmentId:string;documentName:string;provenance:{userId:string;deviceId:string;savedAt:string;connectivity:'online'|'offline'|'unknown'}};
export type AttachmentDocumentResult=
  |{kind:'applied';receivedAt:string;revision:string;documentId:string;path:string}
  |{kind:'rejected';receivedAt:string;reason:'record_deleted'|'invalid_documents'|'document_id_conflict'};
export function createAttachmentDocumentRequest(manifest:AttachmentUploadManifest,input:{requestId:string;documentName:string;deviceId:string;savedAt:string;connectivity:AttachmentUploadManifest['connectivity']}):AttachmentDocumentRequest{
  if(manifest.entityType!=='vehicle')throw new Error('Only vehicle documents can reference uploaded files.');
  if(manifest.byteSize>attachmentDocumentMaxBytes)throw new Error('Vehicle documents must be 8 MB or smaller.');
  const documentName=input.documentName.trim();
  if(!uuid.test(input.requestId)||!documentName||documentName.length>120||/[\u0000-\u001f\u007f]/.test(documentName))throw new Error('Invalid attachment document request.');
  if(!input.deviceId.trim()||input.deviceId.trim().length>200||!time(input.savedAt)||!reportedTime.test(input.savedAt))throw new Error('Invalid attachment document provenance.');
  return {schemaVersion:1,requestId:input.requestId,companyId:manifest.companyId,entityType:'vehicle',entityId:manifest.entityId,attachmentId:manifest.attachmentId,documentName,provenance:{userId:manifest.userId,deviceId:input.deviceId,savedAt:input.savedAt,connectivity:input.connectivity}};
}
export function decodeAttachmentDocumentResult(value:unknown,expected:AttachmentDocumentRequest):AttachmentDocumentResult{
  const data=object(value);
  if(!time(data.receivedAt))throw new Error('Invalid attachment document result.');
  if(data.kind==='applied'){
    if(typeof data.revision!=='string'||!/^[1-9][0-9]*$/.test(data.revision)||data.documentId!==expected.attachmentId||data.path!==`${expected.companyId}/${expected.provenance.userId}/sync-${expected.attachmentId}`)throw new Error('Attachment document result does not match the request.');
    return {kind:'applied',receivedAt:data.receivedAt as string,revision:data.revision,documentId:data.documentId as string,path:data.path as string};
  }
  if(data.kind==='rejected'&&['record_deleted','invalid_documents','document_id_conflict'].includes(data.reason as string))return {kind:'rejected',receivedAt:data.receivedAt as string,reason:data.reason as 'record_deleted'};
  throw new Error('Unrecognized attachment document result.');
}

/** Single-slot vehicle files updated through the verified detail-update path. */
export const vehicleFileSlots=['photo','contract','viprChecklist','registration','insurance','dotInspection'] as const;
export type VehicleFileSlot=typeof vehicleFileSlots[number];
export type VehicleSlotFileValue={name:string;type:AttachmentUploadContentType;dataUrl:'';path:string};
export const isVehicleFileSlot=(field:string):field is VehicleFileSlot=>(vehicleFileSlots as readonly string[]).includes(field);
/** Deterministic value the server accepts only after it proved the fleet-files copy. */
export function vehicleSlotFileValue(manifest:AttachmentUploadManifest):VehicleSlotFileValue{
  const type=attachmentUploadContentType(manifest);
  if(manifest.entityType!=='vehicle'||!type)throw new Error('Only supported vehicle uploads can fill a vehicle file slot.');
  if(manifest.byteSize>attachmentDocumentMaxBytes)throw new Error('Vehicle files must be 8 MB or smaller.');
  return {name:manifest.name,type,dataUrl:'',path:`${manifest.companyId}/${manifest.userId}/sync-${attachmentUploadPath(manifest).split('/')[2]}`};
}
export function decodeVehicleSlotCopy(value:unknown,manifest:AttachmentUploadManifest):VehicleSlotFileValue{
  const data=object(value);const expected=vehicleSlotFileValue(manifest);const file=data.value===undefined?null:object(data.value);
  if(data.kind!=='ready'||!file||Object.keys(file).length!==4||(['name','type','dataUrl','path'] as const).some(key=>file[key]!==expected[key]))throw new Error('Vehicle file copy does not match the retained upload.');
  return expected;
}
