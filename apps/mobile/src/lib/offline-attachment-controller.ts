import type {OfflineOutboxSession} from './offline-outbox';
import type {OfflineAttachment} from './offline-attachment-types';
import type {OfflineAttachmentVault} from './offline-attachment-vault';
export type AttachmentDraft=OfflineAttachment & {operationIds:readonly string[]};
export type AttachmentDraftState={items:readonly AttachmentDraft[];checking:boolean;checked:boolean;busyId:string|null;error:string|null};
export const emptyAttachmentDraftState:AttachmentDraftState={items:[],checking:false,checked:false,busyId:null,error:null};
export function createOfflineAttachmentController(options:{session:OfflineOutboxSession;vault:OfflineAttachmentVault;canAccess:()=>boolean}){
  const {session,vault}=options;let state:AttachmentDraftState=emptyAttachmentDraftState;let active=false;let epoch=0;
  const listeners=new Set<()=>void>();const emit=(patch:Partial<AttachmentDraftState>)=>{state={...state,...patch};listeners.forEach(listener=>listener())};
  const valid=(version:number)=>active&&epoch===version&&options.canAccess();
  const guard=()=>{if(!active||!options.canAccess())throw new Error('Attachment account or permissions changed.');if(state.checking||state.busyId)throw new Error('Another attachment check is in progress. Wait and retry.')};
  async function items(){const [assets,references]=await Promise.all([session.listAttachments(),session.listAttachmentReferences()]);return assets.map(asset=>({...asset,operationIds:references.filter(ref=>ref.attachmentId===asset.attachmentId).map(ref=>ref.operationId)}))}
  const message=(error:unknown)=>error instanceof Error?error.message:'Attachment work could not be confirmed. Retained data was not discarded.';
  async function action<T>(id:string,task:()=>Promise<T>):Promise<T>{
    guard();const version=epoch;emit({busyId:id,error:null});
    try{const result=await task();if(!valid(version))throw new Error('Attachment account changed before confirmation.');await vault.recover();if(!valid(version))throw new Error('Attachment account changed before confirmation.');const rows=await items();if(!valid(version))throw new Error('Attachment account changed before confirmation.');emit({items:rows,checked:true,busyId:null});return result}
    catch(error){if(valid(version)){
      // After an action failure, do not promote raw manifest states to verified
      // availability. Keep them inspectable for explicit recovery/cleanup.
      let rows:AttachmentDraft[]=[];try{rows=await items()}catch{/* Storage failure: publish no stale values. */}
      if(valid(version))emit({items:rows,checked:false,busyId:null,error:message(error)});
    }throw error}
  }
  const controller={
    scope:Object.freeze({...session.scope}),
    getSnapshot:()=>state,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    pause(){active=false;epoch++;emit({...emptyAttachmentDraftState})},
    stop(){active=false;epoch++;vault.dispose();emit({...emptyAttachmentDraftState})},
    async resume(){active=true;epoch++;emit({...emptyAttachmentDraftState});await controller.recover()},
    async recover(){
      if(!active||!options.canAccess()||state.checking||state.busyId)return;const version=epoch;emit({checking:true,checked:false,items:[],error:null});
      try{await vault.recover();if(!valid(version))return;const rows=await items();if(valid(version))emit({items:rows,checking:false,checked:true})}
      catch(error){if(valid(version))emit({items:[],checking:false,checked:false,error:message(error)})}
    },
    stage(input:Parameters<OfflineAttachmentVault['stage']>[0]){return action(input.attachmentId,()=>vault.stage(input))},
    repair(id:string,uri:string){return action(id,()=>vault.repair(id,uri))},
    discard(id:string){return action(id,()=>vault.discard(id))},
  };
  return controller;
}
export type OfflineAttachmentController=ReturnType<typeof createOfflineAttachmentController>;
