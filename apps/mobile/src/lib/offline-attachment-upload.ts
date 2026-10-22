import {attachmentUploadContentType,attachmentUploadStage,decodeAttachmentUploadManifest,decodeAttachmentUploadReservation,type AttachmentUploadManifest,type AttachmentUploadReservation} from '@fireops/domain';
import type {OfflineOutboxSession} from './offline-outbox';
import type {OfflineAttachmentUpload} from './offline-attachment-types';
import type {OfflineAttachmentVault} from './offline-attachment-vault';

export interface AttachmentUploadTransport{
  reserve(manifest:AttachmentUploadManifest,signal:AbortSignal):Promise<unknown>;
  /** `exists` means an object is already stored at the immutable path; it is not proof of bytes. */
  upload(reservation:AttachmentUploadReservation,localUri:string,signal:AbortSignal):Promise<'stored'|'exists'>;
  /** Trusted verifier response body; HTTP failures resolve with their body too. */
  verify(manifest:AttachmentUploadManifest,signal:AbortSignal):Promise<unknown>;
}
const code=(error:unknown)=>String((error as {code?:unknown})?.code??'');
const text=(error:unknown,fallback:string)=>error instanceof Error&&error.message?error.message:fallback;
const kind=(value:unknown)=>value&&typeof value==='object'?(value as {kind?:unknown}).kind:undefined;

/**
 * Sends retained bytes to the private sync bucket and records the trusted
 * byte receipt. Progress is persisted BEFORE bytes are sent so an interrupted
 * upload is known to be uncertain. A verified receipt is NOT a business-record
 * attachment: no record mutation, review or file release happens here.
 */
export function createOfflineAttachmentUploader(options:{session:OfflineOutboxSession;vault:Pick<OfflineAttachmentVault,'localUri'>;transport:AttachmentUploadTransport;canRun:()=>boolean}){
  const {session,vault,transport}=options;const running=new Map<string,Promise<OfflineAttachmentUpload>>();
  const guard=(signal:AbortSignal)=>{if(signal.aborted||!options.canRun())throw Object.assign(new Error('Attachment upload paused'),{code:'SYNC_PAUSED'})};
  async function verified(manifest:AttachmentUploadManifest,reservation:AttachmentUploadReservation,signal:AbortSignal):Promise<OfflineAttachmentUpload>{
    const id=manifest.attachmentId;const body=await transport.verify(manifest,signal);guard(signal);const result=kind(body);
    const returned=(body as {reservation?:unknown}|null)?.reservation;
    if(result==='verified'){
      const confirmed=decodeAttachmentUploadReservation(returned,manifest);
      if(!confirmed.receipt)throw new Error('Verifier did not return a byte receipt.');
      return session.recordAttachmentUpload(id,{stage:'verified',reservation:confirmed});
    }
    if(result==='not_uploaded')return session.recordAttachmentUpload(id,{stage:'reserved',reservation:returned??reservation,error:'Server has no stored bytes yet. Upload will be retried.'});
    if(result==='mismatch')return session.recordAttachmentUpload(id,{stage:'reserved',reservation,error:'Server rejected stored bytes that did not match this device copy. The original bytes will be uploaded again.'});
    if(result==='access_revoked')return session.recordAttachmentUpload(id,{stage:'blocked',reservation,error:'Company owner/admin access is required to upload this file.'});
    return session.recordAttachmentUpload(id,{stage:'stored',reservation,error:'Stored bytes are not verified yet. Verification will be retried.'});
  }
  async function run(id:string,signal:AbortSignal):Promise<OfflineAttachmentUpload>{
    guard(signal);const asset=await session.getAttachment(id);guard(signal);
    if(!asset||asset.state!=='ready')throw new Error('A verified device copy is required before uploading.');
    const {state:_state,error:_error,...intent}=asset;const manifest=decodeAttachmentUploadManifest(intent);
    const previous=await session.getAttachmentUpload(id);guard(signal);if(previous?.receipt)return previous;
    if(!attachmentUploadContentType(manifest))return session.recordAttachmentUpload(id,{stage:'blocked',error:'This file type cannot be uploaded to fleet records. The device copy is retained.'});
    let reservation=previous?.reservation??null;
    if(!previous){await session.markAttachmentRemoteAttempt(id);guard(signal)}
    try{
      reservation=decodeAttachmentUploadReservation(await transport.reserve(manifest,signal),manifest);guard(signal);
      const remote=attachmentUploadStage(reservation);
      if(remote==='verified')return await session.recordAttachmentUpload(id,{stage:'verified',reservation});
      if(remote==='reserved'){
        // Persist uncertainty first: after this point bytes may reach the server.
        await session.recordAttachmentUpload(id,{stage:'uploading',reservation,attempt:true});guard(signal);
        const uri=await vault.localUri(id);guard(signal);
        await transport.upload(reservation,uri,signal);guard(signal);
        await session.recordAttachmentUpload(id,{stage:'stored',reservation});guard(signal);
      }else await session.recordAttachmentUpload(id,{stage:'stored',reservation});
      guard(signal);return await verified(manifest,reservation,signal);
    }catch(error){
      if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;
      const blocked=code(error)==='42501'?'Company owner/admin access is required to upload this file.':code(error)==='PT409'?'The server already holds different bytes or provenance for this attachment. Nothing was replaced.':code(error)==='22023'?'The server rejected this attachment declaration. The device copy is retained.':null;
      const current=await session.getAttachmentUpload(id);
      if(blocked)await session.recordAttachmentUpload(id,{stage:'blocked',...(reservation?{reservation}:{}),error:blocked});
      else if(current&&!current.receipt)await session.recordAttachmentUpload(id,{stage:current.stage,error:text(error,'Upload could not be confirmed. It will be retried with the same attachment identity.')});
      throw error;
    }
  }
  return {
    /** Single-flight per attachment; retries reuse the same identity and path. */
    upload(id:string,signal:AbortSignal):Promise<OfflineAttachmentUpload>{
      const existing=running.get(id);if(existing)return existing;
      const task=run(id,signal).finally(()=>{if(running.get(id)===task)running.delete(id)});running.set(id,task);return task;
    },
  };
}
export type OfflineAttachmentUploader=ReturnType<typeof createOfflineAttachmentUploader>;
