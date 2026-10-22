import type {OfflineOutboxSession} from './offline-outbox';
import type {OfflineAttachment,OfflineAttachmentDocument,OfflineAttachmentUpload} from './offline-attachment-types';
import type {OfflineAttachmentDocumentSync} from './offline-attachment-documents';
import type {OfflineAttachmentVault} from './offline-attachment-vault';
export type AttachmentDraft=OfflineAttachment & {operationIds:readonly string[];upload:OfflineAttachmentUpload|null;document:OfflineAttachmentDocument|null};
export type AttachmentDraftState={items:readonly AttachmentDraft[];checking:boolean;checked:boolean;busyId:string|null;error:string|null;syncing:boolean;syncError:string|null};
export const emptyAttachmentDraftState:AttachmentDraftState={items:[],checking:false,checked:false,busyId:null,error:null,syncing:false,syncError:null};
/** `documents` delivers saved vehicle-document intents; without it, drafts stay local only. */
export function createOfflineAttachmentController(options:{session:OfflineOutboxSession;vault:OfflineAttachmentVault;canAccess:()=>boolean;documents?:OfflineAttachmentDocumentSync;changed?:()=>void}){
  const {session,vault}=options;let state:AttachmentDraftState=emptyAttachmentDraftState;let active=false;let epoch=0;
  const listeners=new Set<()=>void>();const emit=(patch:Partial<AttachmentDraftState>)=>{state={...state,...patch};listeners.forEach(listener=>listener())};
  const valid=(version:number)=>active&&epoch===version&&options.canAccess();
  const guard=()=>{if(!active||!options.canAccess())throw new Error('Attachment account or permissions changed.');if(state.checking||state.busyId)throw new Error('Another attachment check is in progress. Wait and retry.')};
  async function items():Promise<AttachmentDraft[]>{
    const [assets,references,uploads,documents]=await Promise.all([session.listAttachments(),session.listAttachmentReferences(),session.listAttachmentUploads(),session.listAttachmentDocuments()]);
    return assets.map(asset=>({...asset,operationIds:references.filter(ref=>ref.attachmentId===asset.attachmentId).map(ref=>ref.operationId),upload:uploads.find(item=>item.attachmentId===asset.attachmentId)??null,document:documents.find(item=>item.attachmentId===asset.attachmentId)??null}));
  }
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
    /** Saves bytes and an immutable vehicle-document intent on device. Retry with the same IDs. */
    saveVehicleDocument(input:{attachmentId:string;requestId:string;entityId:string;uri:string;name:string;mimeType:string|null;documentName:string}){
      if(!options.documents)return Promise.reject(new Error('Vehicle document sync is unavailable in this build.'));
      return action(input.attachmentId,async()=>{
        const saved=await vault.stage({attachmentId:input.attachmentId,entityType:'vehicle',entityId:input.entityId,uri:input.uri,name:input.name,mimeType:input.mimeType});
        return session.requestAttachmentDocument(saved.attachmentId,{requestId:input.requestId,documentName:input.documentName,savedAt:saved.savedAt,connectivity:saved.connectivity});
      });
    },
    /** Uploads/attaches saved vehicle documents. Never marks anything synced without a server result. */
    async sync(signal:AbortSignal){
      if(!options.documents||!active||!options.canAccess()||state.syncing||state.checking||state.busyId)return;const version=epoch;emit({syncing:true,syncError:null});
      let applied=false;
      try{applied=(await options.documents.run(signal)).some(item=>item.stage==='applied');if(!valid(version))return;const rows=await items();if(valid(version))emit({items:rows,syncing:false})}
      catch(error){if(valid(version)){let rows:AttachmentDraft[]|null=null;try{rows=await items()}catch{/* keep previous rows */}if(valid(version))emit({...(rows?{items:rows}:{}),syncing:false,syncError:(error as {code?:unknown})?.code==='SYNC_PAUSED'?null:message(error)})}}
      if(applied&&valid(version))options.changed?.();
    },
  };
  return controller;
}
export type OfflineAttachmentController=ReturnType<typeof createOfflineAttachmentController>;
