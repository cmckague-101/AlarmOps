import type {OfflineOutboxSession} from './offline-outbox';
import {attachmentId,offlineAttachmentMaxBytes,type OfflineAttachment,type OfflineAttachmentIntent} from './offline-attachment-types';
export type AttachmentDigest={byteSize:number;sha256:string};
export interface OfflineAttachmentFiles{
  source(uri:string):Promise<AttachmentDigest>;
  inspect(id:string,slot:'part'|'blob'):Promise<AttachmentDigest|null>;
  copy(uri:string,id:string,expectedBytes:number):Promise<void>;
  promote(id:string):Promise<void>;
  remove(id:string,slot:'part'|'blob'):Promise<void>;
  uri(id:string):string;
}
// Share file ownership across replaced provider instances in the same process.
// SQLite session guards independently fence old-account writes.
const tails=new Map<string,Promise<unknown>>();
export function createOfflineAttachmentVault(options:{session:OfflineOutboxSession;files:OfflineAttachmentFiles;canAccess:()=>boolean;createId:()=>string;connectivity:()=>OfflineAttachmentIntent['connectivity'];now?:()=>string}){
  const {session,files}=options;const identity={...session.scope};const key=`${identity.userId}:${identity.companyId}`;let disposed=false;
  const allowed=()=>!disposed&&options.canAccess();
  const guard=()=>{if(!allowed())throw new Error('Attachment access changed. Return to the current account and company.')};
  async function run<T>(task:()=>Promise<T>):Promise<T>{
    const previous=tails.get(key)??Promise.resolve();const next=previous.catch(()=>{}).then(async()=>{guard();return task()});tails.set(key,next);
    try{return await next}finally{if(tails.get(key)===next)tails.delete(key)}
  }
  const matches=(asset:OfflineAttachmentIntent,value:AttachmentDigest|null)=>!!value&&value.byteSize===asset.byteSize&&value.sha256===asset.sha256;
  async function finish(asset:OfflineAttachment):Promise<OfflineAttachment>{
    guard();const final=await files.inspect(asset.attachmentId,'blob');guard();
    if(final&&!matches(asset,final))throw new Error('Managed file is inconsistent. Keep it for explicit repair; it was not overwritten.');
    if(!final){const partial=await files.inspect(asset.attachmentId,'part');guard();if(!matches(asset,partial))throw new Error('Attachment bytes are incomplete. Reselect the original file or discard this unbound draft.');await files.promote(asset.attachmentId);guard()}
    // A final hash/size check is required even after a successful move.
    if(!matches(asset,await files.inspect(asset.attachmentId,'blob')))throw new Error('Attachment copy could not be verified.');guard();
    if(!await session.readyAttachment(asset.attachmentId))throw new Error('Attachment was discarded while it was being saved.');guard();
    const saved=await session.getAttachment(asset.attachmentId);guard();if(!saved||saved.state!=='ready')throw new Error('Attachment save was not confirmed.');return saved;
  }
  async function failure(id:string):Promise<boolean>{if(allowed())try{await session.missingAttachment(id,'Device copy is incomplete or inconsistent. Reselect the original file or explicitly discard an unbound draft.');return true}catch{/* Preserve original manifest and bytes on storage failure. */}return false}
  const vault={
    dispose(){disposed=true},
    stage(input:{attachmentId:string;entityType:'vehicle'|'issue';entityId:string;uri:string;name:string;mimeType:string|null}):Promise<OfflineAttachment>{
      const request={...input};attachmentId(request.attachmentId);attachmentId(request.entityId);const savedAt=(options.now??(()=>new Date().toISOString()))();const connectivity=options.connectivity();
      return run(async()=>{
        let reserved=false;
        try{
          const previous=await session.getAttachment(request.attachmentId);guard();
          if(previous){
            if(previous.entityType!==request.entityType||previous.entityId!==request.entityId||previous.name!==request.name||previous.mimeType!==request.mimeType||['discarding','discarded'].includes(previous.state))throw new Error('Attachment identity was reused for different or discarded work.');
            reserved=true;
            const final=await files.inspect(request.attachmentId,'blob');guard();const partial=final?null:await files.inspect(request.attachmentId,'part');guard();
            if(matches(previous,final)||matches(previous,partial))return await finish(previous);
          }else{
            const target=(await session.listRecords()).find(row=>row.entityType===request.entityType&&row.entityId===request.entityId);guard();
            if(!target?.record)throw new Error('Download verified record details before saving attachment drafts.');
          }
          const digest=await files.source(request.uri);guard();
          if(digest.byteSize<=0||digest.byteSize>offlineAttachmentMaxBytes)throw new Error('Attachment must be 10 MB or smaller.');
          if(previous&&!matches(previous,digest))throw new Error('Reselected bytes differ from the original intent. Save them as a new attachment.');
          const intent:OfflineAttachmentIntent=previous?(({state:_state,error:_error,...value})=>value)(previous):{...identity,attachmentId:request.attachmentId,entityType:request.entityType,entityId:request.entityId,name:request.name,mimeType:request.mimeType,...digest,deviceId:await session.getDeviceId(options.createId),savedAt,connectivity};guard();
          const asset=await session.reserveAttachment(intent);reserved=true;guard();
          if(await files.inspect(request.attachmentId,'blob'))throw new Error('Managed file needs explicit repair, not replacement.');guard();
          // A failed partial copy may be replaced only after the new source was
          // verified against the immutable intent. Never delete the picker file.
          await files.remove(request.attachmentId,'part');guard();await files.copy(request.uri,request.attachmentId,asset.byteSize);guard();return await finish(asset);
        }catch(error){if(reserved)await failure(request.attachmentId);throw error}
      });
    },
    recover():Promise<void>{return run(async()=>{
      for(const asset of await session.listAttachments()){
        guard();if(asset.state==='discarding'||asset.state==='discarded'){
          await files.remove(asset.attachmentId,'part');guard();await files.remove(asset.attachmentId,'blob');guard();if(asset.state==='discarding')await session.finishAttachmentDiscard(asset.attachmentId);continue;
        }
        try{await finish(asset)}catch{guard();if(!await failure(asset.attachmentId))throw new Error('Attachment recovery could not be confirmed. Device work has not been discarded.')}
      }
    })},
    localUri(id:string):Promise<string>{attachmentId(id);return run(async()=>{
      const asset=await session.getAttachment(id);guard();if(!asset||asset.state!=='ready')throw new Error('No verified device copy is available.');
      if(!matches(asset,await files.inspect(id,'blob'))){await failure(id);throw new Error('Device file failed integrity verification. Nothing was uploaded.')}guard();return files.uri(id);
    })},
    discard(id:string):Promise<void>{attachmentId(id);return run(async()=>{
      const asset=await session.getAttachment(id);guard();if(!asset)throw new Error('Attachment is unavailable in this account/company.');
      await session.beginAttachmentDiscard(id);guard();await files.remove(id,'part');guard();await files.remove(id,'blob');guard();await session.finishAttachmentDiscard(id);guard();
    })},
  };
  return vault;
}
export type OfflineAttachmentVault=ReturnType<typeof createOfflineAttachmentVault>;
