import type {SupabaseClient} from '@supabase/supabase-js';
import {attachmentUploadBucket} from '@fireops/domain';
import type {OutboxScope} from './offline-outbox';
import type {AttachmentUploadTransport} from './offline-attachment-upload';
import type {AttachmentDocumentTransport} from './offline-attachment-documents';

const paused=()=>Object.assign(new Error('Attachment upload paused'),{code:'SYNC_PAUSED'});
const exists=(error:{statusCode?:unknown;status?:unknown;message?:unknown})=>String(error.statusCode??error.status??'')==='409'||/already exists|duplicate/i.test(String(error.message??''));

/**
 * Account-bound attachment transport. Uses the verified local session token,
 * never a service key. Storage RLS independently requires the caller's own
 * reservation for the exact path, so a replaced session cannot upload there.
 */
export function createNativeAttachmentUploadTransport(client:SupabaseClient,scope:OutboxScope,canRun:()=>boolean,readBytes:(uri:string)=>Promise<ArrayBuffer>):AttachmentUploadTransport & Required<AttachmentDocumentTransport>{
  const identity={...scope};
  async function token(signal:AbortSignal){
    if(signal.aborted||!canRun())throw paused();
    const {data,error}=await client.auth.getSession();
    if(error||!data.session||data.session.user.id!==identity.userId)throw Object.assign(new Error('Session must be verified before uploading'),{code:'401'});
    if(signal.aborted||!canRun())throw paused();
    return data.session.access_token;
  }
  const scoped=(manifest:{userId:string;companyId:string})=>{if(manifest.userId!==identity.userId||manifest.companyId!==identity.companyId)throw Object.assign(new Error('Attachment account changed'),{code:'42501'})};
  return {
    async reserve(manifest,signal){
      scoped(manifest);const bearer=await token(signal);
      const result=await client.rpc('reserve_fleet_sync_attachment',{manifest}).setHeader('Authorization',`Bearer ${bearer}`).abortSignal(signal);
      if(result.error)throw result.error;return result.data;
    },
    async upload(reservation,localUri,signal){
      scoped(reservation.manifest);await token(signal);const body=await readBytes(localUri);
      if(body.byteLength!==reservation.manifest.byteSize)throw new Error('Device copy changed before upload. Nothing was sent.');
      if(signal.aborted||!canRun())throw paused();
      const {error}=await client.storage.from(attachmentUploadBucket).upload(reservation.path,body,{contentType:reservation.contentType,upsert:false});
      if(!error)return 'stored';if(exists(error as never))return 'exists';throw error;
    },
    async verify(manifest,signal){scoped(manifest);return invoke('verify-fleet-sync-attachment',{companyId:manifest.companyId,attachmentId:manifest.attachmentId},signal)},
    async attach(request,signal){scoped({userId:request.provenance.userId,companyId:request.companyId});return invoke('attach-fleet-sync-document',request,signal)},
    async release(target,signal){scoped(target);return invoke('release-fleet-sync-attachment',{companyId:target.companyId,attachmentId:target.attachmentId},signal)},
  };
  async function invoke(name:string,body:unknown,signal:AbortSignal){
    const bearer=await token(signal);
    const {data,error}=await client.functions.invoke(name,{body,headers:{Authorization:`Bearer ${bearer}`},signal} as never);
    if(!error)return data;
    // Structured verifier outcomes (mismatch/in progress/revoked) arrive as HTTP errors.
    const response=(error as {context?:Response}).context;
    if(response&&typeof response.json==='function'){
      const parsed=await response.json().catch(()=>null) as {kind?:unknown}|null;
      if(response.status===403)throw Object.assign(new Error('Company owner/admin access is required to upload this file.'),{code:'42501'});
      if(parsed&&typeof parsed.kind==='string')return parsed;
    }
      throw error;
  }
}
