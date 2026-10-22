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
