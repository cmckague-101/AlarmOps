import {decodeAttachmentUploadManifest,decodeVehicleSlotCopy,isVehicleFileSlot,vehicleSlotFileValue,type SyncRecord} from '@fireops/domain';
import type {CachedOfflineRecord,OfflineOutboxSession,OutboxEntry} from './offline-outbox';
import type {OfflineAttachmentUploader} from './offline-attachment-upload';

export interface SlotCopyTransport{
  /** Copy Edge Function body; HTTP failures resolve with their structured body too. */
  copy(target:{companyId:string;userId:string;attachmentId:string},signal:AbortSignal):Promise<unknown>;
}
type Prepared={kind:'ready'}|{kind:'pending'|'blocked';error:string};
const code=(error:unknown)=>String((error as {code?:unknown})?.code??'');
const message=(error:unknown,fallback:string)=>error instanceof Error&&error.message?error.message:fallback;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const blockedKinds:Record<string,string>={access_revoked:'Company owner/admin access is required to upload this file.',conflict:'This upload is already used for another vehicle file. Nothing was replaced.',invalid:'This file cannot fill a vehicle file slot.',not_found:'The server has no reservation for this file.'};

const patchOf=(entry:OutboxEntry)=>entry.operation.mutation.kind==='update'?entry.operation.mutation.patch:{};
const referencesFile=(value:unknown,attachmentId:string)=>typeof (value as {path?:unknown}|null)?.path==='string'&&(value as {path:string}).path.endsWith(`/sync-${attachmentId}`);
/** The newly added inspection of an append-only inspection change. */
function addedInspection(entry:OutboxEntry):Record<string,unknown>|null{
  const slot=patchOf(entry).inspections;const list=slot?.present&&Array.isArray(slot.value)?slot.value:null;
  return list&&list[0]&&typeof list[0]==='object'?list[0] as Record<string,unknown>:null;
}
/** Every proposed file value referencing `attachmentId`: file slots and new-inspection photos. */
export function fileReferences(entry:OutboxEntry,attachmentId:string):{field:string;value:unknown}[]{
  const refs:{field:string;value:unknown}[]=Object.entries(patchOf(entry)).filter(([field,slot])=>isVehicleFileSlot(field)&&slot.present&&referencesFile(slot.value,attachmentId)).map(([field,slot])=>({field,value:slot.present?slot.value:null}));
  const items=addedInspection(entry)?.items;
  if(Array.isArray(items))for(const item of items as Record<string,unknown>[])if(referencesFile(item.photo,attachmentId))refs.push({field:'inspections',value:item.photo});
  return refs;
}
/** Slot fields whose proposed value references `attachmentId`. */
export const slotsReferencing=(entry:OutboxEntry,attachmentId:string)=>[...new Set(fileReferences(entry,attachmentId).map(ref=>ref.field))];

/**
 * Worker hook: every bound file must have verified bytes and a server-proven
 * fleet-files copy matching the exact value the saved operation proposes,
 * before the record change is sent. Nothing here changes the operation.
 */
export function createSlotAttachmentPreparer(options:{session:OfflineOutboxSession;uploader:Pick<OfflineAttachmentUploader,'upload'>;transport:SlotCopyTransport}){
  const {session,uploader,transport}=options;
  return async function prepare(entry:OutboxEntry,signal:AbortSignal):Promise<Prepared>{
    for(const id of entry.attachmentIds??[]){
      const asset=await session.getAttachment(id);if(!asset)return {kind:'blocked',error:'A file referenced by this change is unavailable on this device.'};
      const {state:_state,error:_error,...intent}=asset;const manifest=decodeAttachmentUploadManifest(intent);
      let expected;try{expected=vehicleSlotFileValue(manifest)}catch(error){return {kind:'blocked',error:message(error,'This file cannot fill a vehicle file slot.')}}
      const refs=fileReferences(entry,id);
      if(!refs.length||refs.some(ref=>!same(ref.value,expected)))return {kind:'blocked',error:'This change does not reference its saved file exactly. Nothing was sent.'};
      try{
        const upload=await uploader.upload(id,signal);
        if(upload.stage==='blocked')return {kind:'blocked',error:upload.error??'File upload is blocked.'};
        if(upload.stage!=='verified')return {kind:'pending',error:upload.error??'Waiting for the server to verify uploaded bytes.'};
        const body=await transport.copy({companyId:manifest.companyId,userId:manifest.userId,attachmentId:id},signal);const kind=(body as {kind?:unknown}|null)?.kind;
        if(kind==='ready'){decodeVehicleSlotCopy(body,manifest);continue}
        if(typeof kind==='string'&&blockedKinds[kind])return {kind:'blocked',error:blockedKinds[kind]};
        return {kind:'pending',error:'The server is still preparing this file. It will be retried.'};
      }catch(error){
        if(code(error)==='SYNC_PAUSED'||signal.aborted)throw error;
        if(code(error)==='42501')return {kind:'blocked',error:blockedKinds.access_revoked};
        return {kind:'pending',error:message(error,'File upload could not be confirmed. It will be retried.')};
      }
    }
    return {kind:'ready'};
  };
}

/** Kept slot fields of a final operation, or null while its result is not final. */
export function settledSlotFields(entry:OutboxEntry):{kept:string[];revision:string|null}|null{
  const outcome=entry.reviewOutcome;const slots=Object.keys(patchOf(entry)).filter(field=>isVehicleFileSlot(field)||field==='inspections');
  if(entry.status==='synced')return {kept:outcome&&outcome.outcome!=='kept'?slots.filter(field=>outcome.keptFields.includes(field)):slots,revision:outcome?.revision??(entry.receipt?.kind==='applied'?entry.receipt.revision:null)};
  if(entry.status==='not_selected'||(entry.status==='blocked'&&outcome))return {kept:outcome?slots.filter(field=>outcome.keptFields.includes(field)):[],revision:outcome?.revision??null};
  return null;
}
/** Policy: a kept file is confirmed when a verified record at/after the result revision holds the exact proposed value. */
export function slotConfirmedInRecord(entry:OutboxEntry,field:string,revision:string|null,records:readonly CachedOfflineRecord[]):boolean{
  const cached=records.find(item=>item.entityType==='vehicle'&&item.entityId===entry.operation.entityId);const patch=entry.operation.mutation.kind==='update'?entry.operation.mutation.patch:{};
  if(!revision||!cached?.record||BigInt(cached.revision)<BigInt(revision))return false;
  if(field==='inspections'){
    const added=addedInspection(entry);const list=(cached.record as SyncRecord).inspections;
    return !!added&&Array.isArray(list)&&list.some(item=>same(item,added));
  }
  return same((cached.record as SyncRecord)[field],patch[field]?.present?patch[field].value:undefined);
}

/**
 * After a final result: release file bindings, then remove device copies of
 * kept files once the refreshed vehicle shows them. Files that were not kept
 * stay on the device until the user explicitly discards them.
 */
export function createSlotAttachmentSettler(options:{session:OfflineOutboxSession;discard:(id:string)=>Promise<void>}){
  const {session}=options;
  return async function settle(signal:AbortSignal){
    const [entries,assets,records]=await Promise.all([session.list(),session.listAttachments(),session.listRecords()]);
    for(const entry of entries){
      if(signal.aborted||!entry.attachmentIds?.length)continue;const settled=settledSlotFields(entry);if(!settled)continue;
      const kept=entry.attachmentIds.filter(id=>slotsReferencing(entry,id).some(field=>settled.kept.includes(field)));
      const confirmed=kept.every(id=>slotsReferencing(entry,id).filter(field=>settled.kept.includes(field)).every(field=>slotConfirmedInRecord(entry,field,settled.revision,records)));
      // Wait for canonical confirmation before unbinding kept files.
      if(kept.length&&!confirmed)continue;
      await session.releaseOperationAttachments(entry.operation.operationId);
      for(const id of kept){
        const asset=assets.find(item=>item.attachmentId===id);if(!asset||['discarding','discarded'].includes(asset.state))continue;
        try{await options.discard(id)}catch{/* Another operation may still bind it; retried next run. */}
      }
    }
  };
}
