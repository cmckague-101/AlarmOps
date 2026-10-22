import {attachmentDocumentMaxBytes,attachmentUploadContentType} from '@fireops/domain';
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
