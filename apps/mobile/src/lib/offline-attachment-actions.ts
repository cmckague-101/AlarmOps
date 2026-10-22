import {attachmentDocumentMaxBytes,attachmentUploadContentType,vehicleSlotFileValue,type AttachmentUploadManifest,type SyncRecord,type VehicleFileSlot} from '@fireops/domain';
import type {OfflineAttachment} from './offline-attachment-types';
import type {DetailSaveExtras,OfflineDetailDraft} from './offline-detail-editor';
import type {OfflineAttachmentController} from './offline-attachment-controller';
/** Picker/confirmation results may arrive after an account, role or route change. */
export function createAttachmentDraftActions(options:{controller:OfflineAttachmentController;isCurrent:()=>boolean;pickOriginal:()=>Promise<string|null>;confirmDiscard:()=>Promise<boolean>}){
  return {
    async repair(id:string){
      if(!options.isCurrent())return;const uri=await options.pickOriginal();if(!uri||!options.isCurrent())return;await options.controller.repair(id,uri);
    },
    async discard(id:string){
      if(!options.isCurrent()||!await options.confirmDiscard()||!options.isCurrent())return;await options.controller.discard(id);
    },
  };
}
export type PickedVehicleDocument={uri:string;name:string;mimeType:string|null;size:number|null};
/** Client-side preflight only; the vault hashes bytes and the server revalidates everything. */
export function vehicleDocumentPickError(file:PickedVehicleDocument):string|null{
  if(!attachmentUploadContentType({mimeType:file.mimeType}))return 'Choose a JPEG, PNG, WebP, GIF or PDF file.';
  if(file.size!==null&&(file.size<=0||file.size>attachmentDocumentMaxBytes))return 'Choose a file that is 8 MB or smaller.';
  return null;
}
/** Stable IDs per chosen file make a failed save an exact retry, never a second document. */
export function createVehicleDocumentActions(options:{controller:Pick<OfflineAttachmentController,'saveVehicleDocument'>;isCurrent:()=>boolean;pick:()=>Promise<PickedVehicleDocument|null>;createId:()=>string}){
  let chosen:{file:PickedVehicleDocument;attachmentId:string;requestId:string}|null=null;
  return {
    async choose(){
      if(!options.isCurrent())return null;const file=await options.pick();if(!file||!options.isCurrent())return null;
      const error=vehicleDocumentPickError(file);if(error)throw new Error(error);
      chosen={file,attachmentId:options.createId(),requestId:options.createId()};return file;
    },
    async save(entityId:string,documentName:string){
      if(!chosen)throw new Error('Choose a file first.');if(!options.isCurrent())return false;const {file,attachmentId,requestId}=chosen;
      await options.controller.saveVehicleDocument({attachmentId,requestId,entityId,uri:file.uri,name:file.name,mimeType:file.mimeType,documentName});return options.isCurrent();
    },
  };
}
/**
 * One slot replacement: stage the chosen file, then save the slot change on a
 * fresh verified draft. IDs and the staged value are kept so a failed save is
 * retried exactly (same file, same operation), never duplicated.
 */
export function createVehicleSlotActions(options:{
  stage:(input:{attachmentId:string;entityId:string;uri:string;name:string;mimeType:string|null})=>Promise<OfflineAttachment>;
  prepare:()=>Promise<OfflineDetailDraft>;save:(draft:OfflineDetailDraft,values:SyncRecord,extras:DetailSaveExtras)=>Promise<unknown>;
  isCurrent:()=>boolean;pick:()=>Promise<PickedVehicleDocument|null>;createId:()=>string;entityId:string;
}){
  let pending:{slot:VehicleFileSlot;draft:OfflineDetailDraft|null;file:PickedVehicleDocument|null;attachmentId:string|null}|null=null;
  async function commit(){
    const current=pending!;
    if(current.file&&current.attachmentId){
      const staged=await options.stage({attachmentId:current.attachmentId,entityId:options.entityId,uri:current.file.uri,name:current.file.name,mimeType:current.file.mimeType});if(!options.isCurrent())return false;
      const {state:_state,error:_error,...manifest}=staged;
      current.draft??=await options.prepare();if(!options.isCurrent())return false;
      await options.save(current.draft,{[current.slot]:vehicleSlotFileValue(manifest as AttachmentUploadManifest)},{attachmentIds:[current.attachmentId]});
    }else{
      current.draft??=await options.prepare();if(!options.isCurrent())return false;
      await options.save(current.draft,{},{remove:[current.slot]});
    }
    pending=null;return options.isCurrent();
  }
  return {
    get pendingSlot(){return pending?.slot??null},
    async replace(slot:VehicleFileSlot){
      if(pending)throw new Error('Finish or retry the previous file change first.');if(!options.isCurrent())return false;
      const file=await options.pick();if(!file||!options.isCurrent())return false;const error=vehicleDocumentPickError(file);if(error)throw new Error(error);
      pending={slot,draft:null,file,attachmentId:options.createId()};return commit();
    },
    async clear(slot:VehicleFileSlot){if(pending)throw new Error('Finish or retry the previous file change first.');if(!options.isCurrent())return false;pending={slot,draft:null,file:null,attachmentId:null};return commit()},
    retry(){if(!pending)return Promise.resolve(false);return commit()},
    /** Abandons an unsaved change; a staged file stays as an unbound draft the user can discard. */
    cancel(){pending=null},
  };
}
