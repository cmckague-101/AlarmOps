import type {AttachmentDocumentRequest,AttachmentDocumentResult,AttachmentUploadReceipt,AttachmentUploadReservation} from '@fireops/domain';
export const offlineAttachmentMaxBytes=10*1024*1024;
export const offlineAttachmentUserQuota=100*1024*1024;
export type OfflineAttachmentState='staging'|'ready'|'missing'|'discarding'|'discarded';
export type OfflineAttachmentIntent={attachmentId:string;userId:string;companyId:string;entityType:'vehicle'|'issue';entityId:string;name:string;mimeType:string|null;byteSize:number;sha256:string;deviceId:string;savedAt:string;connectivity:'online'|'offline'|'unknown'};
export type OfflineAttachment=OfflineAttachmentIntent & {state:OfflineAttachmentState;error:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function attachmentId(value:unknown):asserts value is string{if(typeof value!=='string'||!uuid.test(value))throw new Error('Invalid attachment identity.')}
export function validateAttachmentIntent(value:OfflineAttachmentIntent,scope:{userId:string;companyId:string}){
  attachmentId(value.attachmentId);attachmentId(value.entityId);
  if(value.userId!==scope.userId||value.companyId!==scope.companyId||!['vehicle','issue'].includes(value.entityType))throw new Error('Attachment belongs to another account, company or workflow.');
  if(typeof value.name!=='string'||!value.name.trim()||value.name.length>255||/[\u0000-\u001f]/.test(value.name))throw new Error('Invalid attachment name.');
  if(value.mimeType!==null&&(typeof value.mimeType!=='string'||!value.mimeType.trim()||value.mimeType.length>200||/[\r\n\u0000]/.test(value.mimeType)))throw new Error('Invalid reported attachment type.');
  if(!Number.isSafeInteger(value.byteSize)||value.byteSize<=0||value.byteSize>offlineAttachmentMaxBytes||typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.sha256))throw new Error('Invalid attachment bytes or digest.');
  if(typeof value.deviceId!=='string'||!value.deviceId.trim()||typeof value.savedAt!=='string'||!Number.isFinite(Date.parse(value.savedAt))||!['online','offline','unknown'].includes(value.connectivity))throw new Error('Invalid attachment provenance.');
}
/**
 * Remote byte progress, separate from local readiness. `uploading` means bytes
 * may have been sent (uncertain); `verified` is a server byte receipt only —
 * never a business-record attachment, review outcome or sync completion.
 */
export type OfflineAttachmentUploadStage='reserved'|'uploading'|'stored'|'verified'|'blocked';
export type OfflineAttachmentUpload={attachmentId:string;stage:OfflineAttachmentUploadStage;reservation:AttachmentUploadReservation|null;receipt:AttachmentUploadReceipt|null;error:string|null;attempts:number;updatedAt:string};
/** Saved intent to reference verified bytes as one vehicle document. `applied` is the server's business result. */
export type OfflineAttachmentDocument={attachmentId:string;request:AttachmentDocumentRequest;stage:'pending'|'applied'|'rejected'|'blocked';result:AttachmentDocumentResult|null;error:string|null;attempts:number;createdAt:string;updatedAt:string};
