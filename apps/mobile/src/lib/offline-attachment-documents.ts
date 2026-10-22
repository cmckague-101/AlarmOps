import type {AttachmentDocumentRequest} from '@fireops/domain';
import type {OfflineOutboxSession} from './offline-outbox';
import type {OfflineAttachmentDocument} from './offline-attachment-types';
import type {OfflineAttachmentUploader} from './offline-attachment-upload';

export interface AttachmentDocumentTransport{
  /** Attach Edge Function body; HTTP failures resolve with their structured body too. */
  attach(request:AttachmentDocumentRequest,signal:AbortSignal):Promise<unknown>;
  /** Explicit staging release after a discard (also retries applied cleanup). */
  release?(target:{companyId:string;userId:string;attachmentId:string},signal:AbortSignal):Promise<unknown>;
}
const code=(error:unknown)=>String((error as {code?:unknown})?.code??'');
const message=(error:unknown,fallback:string)=>error instanceof Error&&error.message?error.message:fallback;
const retryable=new Set(['not_ready','copy_mismatch','copy_missing','source_unavailable']);
const blockedKinds:Record<string,string>={access_revoked:'Company owner/admin access is required to attach this file.',conflict:'The server already holds a different document request for this file. Nothing was replaced.',invalid:'The server rejected this document request. The device copy is retained.'};

/**
 * Delivers saved vehicle-document intents: verified bytes first, then the
 * immutable request. Only a server result marks them applied/rejected; an
 * applied document does not delete local or remote bytes automatically.
 */
/** Policy: once the applied document is visible in a verified record at/after its revision, the device copy is removed (metadata kept). */
export function documentConfirmedInRecord(document:OfflineAttachmentDocument,records:readonly {entityType:string;entityId:string;revision:string;record:Record<string,unknown>|null}[]):boolean{
  const result=document.result;if(result?.kind!=='applied')return false;
  const cached=records.find(item=>item.entityType==='vehicle'&&item.entityId===document.request.entityId);
  if(!cached?.record||BigInt(cached.revision)<BigInt(result.revision))return false;
  const documents=cached.record.documents;
  return Array.isArray(documents)&&documents.some(item=>!!item&&typeof item==='object'&&(item as {id?:unknown}).id===document.attachmentId&&(item as {file?:{path?:unknown}}).file?.path===result.path);
}
export function createOfflineAttachmentDocumentSync(options:{session:OfflineOutboxSession;uploader:Pick<OfflineAttachmentUploader,'upload'>;transport:AttachmentDocumentTransport;canRun:()=>boolean;discard?:(id:string)=>Promise<void>;settle?:(signal:AbortSignal)=>Promise<void>}){
  const {session,uploader,transport}=options;let running:Promise<OfflineAttachmentDocument[]>|null=null;
  const guard=(signal:AbortSignal)=>{if(signal.aborted||!options.canRun())throw Object.assign(new Error('Attachment sync paused'),{code:'SYNC_PAUSED'})};
  async function deliver(document:OfflineAttachmentDocument,signal:AbortSignal):Promise<OfflineAttachmentDocument>{
    const id=document.attachmentId;let upload;
    try{upload=await uploader.upload(id,signal)}catch(error){if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;return session.recordAttachmentDocument(id,{error:message(error,'File upload could not be confirmed. It will be retried.')})}
    guard(signal);
    if(upload.stage==='blocked')return session.recordAttachmentDocument(id,{blocked:upload.error??'File upload is blocked.'});
    if(upload.stage!=='verified')return session.recordAttachmentDocument(id,{error:upload.error??'Waiting for the server to verify uploaded bytes.'});
    try{
      const body=await transport.attach(document.request,signal);guard(signal);
      const data=body&&typeof body==='object'?body as {kind?:unknown;result?:unknown}:{};
      if(data.kind==='completed')return await session.recordAttachmentDocument(id,{result:data.result,attempt:true});
      if(typeof data.kind==='string'&&blockedKinds[data.kind])return await session.recordAttachmentDocument(id,{blocked:blockedKinds[data.kind],attempt:true});
      return await session.recordAttachmentDocument(id,{error:typeof data.kind==='string'&&retryable.has(data.kind)?'The server is still preparing this document. It will be retried.':'Document result was not recognized. It will be retried with the same request.',attempt:true});
    }catch(error){
      if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;
      if(code(error)==='42501')return session.recordAttachmentDocument(id,{blocked:blockedKinds.access_revoked,attempt:true});
      return session.recordAttachmentDocument(id,{error:message(error,'Document could not be confirmed. It will be retried with the same request.'),attempt:true});
    }
  }
  async function removeConfirmedCopies(documents:OfflineAttachmentDocument[],signal:AbortSignal){
    if(!options.discard)return;const applied=documents.filter(item=>item.result?.kind==='applied');if(!applied.length)return;
    const [assets,records]=await Promise.all([session.listAttachments(),session.listRecords()]);
    for(const document of applied){
      guard(signal);const asset=assets.find(item=>item.attachmentId===document.attachmentId);
      if(!asset||['discarding','discarded'].includes(asset.state)||!documentConfirmedInRecord(document,records))continue;
      try{await options.discard(document.attachmentId)}catch(error){if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;/* Retained; retried next run. */}
    }
  }
  async function releaseStaging(signal:AbortSignal){
    const release=transport.release;if(!release)return;
    for(const item of await session.listAttachmentReleases()){
      if(item.state!=='pending')continue;guard(signal);const {attachmentId,companyId,userId}=item.attachment;
      try{
        const body=await release({companyId,userId,attachmentId},signal);guard(signal);const kind=body&&typeof body==='object'?(body as {kind?:unknown}).kind:undefined;
        if(kind==='released'||kind==='attached')await session.recordAttachmentRelease(attachmentId,{state:kind});
        else if(kind==='not_found')await session.recordAttachmentRelease(attachmentId,{state:'none'});
        else await session.recordAttachmentRelease(attachmentId,{state:'pending',error:kind==='in_use'?'The server upload is still in use; release will be retried.':kind==='access_revoked'?'Company owner/admin access is required to release the server upload.':'Server upload release is not confirmed yet.'});
      }catch(error){if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;await session.recordAttachmentRelease(attachmentId,{state:'pending',error:message(error,'Server upload release could not be confirmed. It will be retried.')})}
    }
  }
  async function run(signal:AbortSignal){
    guard(signal);const out:OfflineAttachmentDocument[]=[];
    for(const document of await session.listAttachmentDocuments()){guard(signal);out.push(document.stage==='pending'?await deliver(document,signal):document)}
    await removeConfirmedCopies(out,signal);await options.settle?.(signal);guard(signal);await releaseStaging(signal);
    return out;
  }
  return {
    /** Single-flight; retries reuse every saved request unchanged. */
    run(signal:AbortSignal):Promise<OfflineAttachmentDocument[]>{if(running)return running;running=run(signal).finally(()=>{running=null});return running},
  };
}
export type OfflineAttachmentDocumentSync=ReturnType<typeof createOfflineAttachmentDocumentSync>;
