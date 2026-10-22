import {createSyncPatch,isVehicleFileSlot,vehicleFileSlots,type SyncOperation,type SyncRecord} from '@fireops/domain';
import {projectOfflineFleet} from './offline-fleet-model';
import type {OfflineOutboxSession,OutboxEntry,ContinuationReview} from './offline-outbox';
import {decodeCanonicalSyncRecord} from './offline-sync-protocol';

export type DetailTarget={readonly entityType:'vehicle'|'issue';readonly entityId:string};
export type OfflineDetailDraft=DetailTarget & {readonly revision:string;readonly record:SyncRecord;readonly verifiedAt:string;readonly pendingParentId?:string};
const fields={vehicle:['unit','type','year','make','model','vin','plate','notes',...vehicleFileSlots],issue:['title','description','priority']};
const syncFilePath=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/sync-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export type DetailSaveExtras={readonly remove?:readonly string[];readonly attachmentIds?:readonly string[]};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const active=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
/** File slots accept only the deterministic proven-copy value for a bound attachment (the server rechecks the proof). */
export function validateOfflineDetailValues(entityType:DetailTarget['entityType'],values:SyncRecord,extras:DetailSaveExtras={}){
  createSyncPatch({},values);
  for(const field of extras.remove??[])if(entityType!=='vehicle'||!isVehicleFileSlot(field)||field in values)throw new Error('Only vehicle file slots can be cleared here.');
  for(const [field,value] of Object.entries(values)){
    if(!fields[entityType].includes(field))throw new Error('This field is not enabled for offline editing.');
    if(isVehicleFileSlot(field)){
      const file=value as Record<string,unknown>|null;const match=typeof file?.path==='string'?syncFilePath.exec(file.path):null;
      if(!file||typeof file!=='object'||Array.isArray(file)||Object.keys(file).sort().join()!=='dataUrl,name,path,type'||file.dataUrl!==''||typeof file.name!=='string'||typeof file.type!=='string'||!match||!(extras.attachmentIds??[]).includes(match[1]))
        throw new Error('Vehicle files must reference a saved device file.');
    }else if(field==='year'){
      if(typeof value!=='number'||!Number.isInteger(value)||value<1000||value>9999)throw new Error('Vehicle year must contain four digits.');
    }else{
      if(typeof value!=='string'||value.length>(['notes','description'].includes(field)?10000:200))throw new Error('Invalid detail field value.');
      if(['unit','type','make','model','title'].includes(field)&&!value.trim())throw new Error('Detail field cannot be blank.');
      if(field==='priority'&&!['Low','Medium','High','Critical'].includes(value))throw new Error('Invalid issue priority.');
    }
  }
}

/** Owns verified edit bases, not another activate() handle. UI adapters must retain the returned draft. */
export function createOfflineDetailEditor(options:{
  session:OfflineOutboxSession;readRecord:(target:DetailTarget,signal:AbortSignal)=>Promise<unknown>;
  canEdit:()=>boolean;offline:()=>boolean;id:()=>string;now?:()=>string;changed:()=>Promise<void>;
  downloaded?:()=>Promise<void>;reserve?:(target:DetailTarget,owner:string)=>()=>void;
}){
  let disposed=false;
  const requests=new Set<AbortController>();
  const rebaseReviews=new WeakMap<ContinuationReview,ContinuationReview>();
  const drafts=new WeakMap<OfflineDetailDraft,{base:OfflineDetailDraft;deviceId:string;parent?:OutboxEntry;operation?:SyncOperation;values?:SyncRecord;extras?:{remove:string[];attachmentIds:string[]}}>();
  function guard(){if(disposed||!options.canEdit())throw new Error('This offline editor is no longer available for the current account or permissions.')}
  async function available(target:DetailTarget){
    const entries=await options.session.list();
    const matching=entries.filter(entry=>entry.operation.entityType===target.entityType&&entry.operation.entityId===target.entityId&&active(entry));
    const parent=matching[matching.length-1];
    if(parent&&(parent.operation.mutation.kind!=='update'||Object.keys(parent.operation.mutation.patch).some(field=>!fields[target.entityType].includes(field))))throw new Error('This pending workflow cannot be edited with the scalar editor.');
    return {entries,parent};
  }
  const editor={
    dispose(){disposed=true;for(const request of requests)request.abort();requests.clear()},
    async prepare(target:DetailTarget,mode?:{downloadedOnly?:boolean}):Promise<OfflineDetailDraft>{
      const downloadedOnly=mode?.downloadedOnly===true;
      guard();if(!['vehicle','issue'].includes(target.entityType))throw new Error('Unsupported detail editor.');
      const identity={...target};const {entries,parent}=await available(identity);guard();
      if(!options.offline()&&!downloadedOnly){
        const controller=new AbortController();requests.add(controller);
        const timeout=setTimeout(()=>controller.abort(),30_000);
        let onAbort=()=>{};
        const aborted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('Verified download was interrupted. Reconnect and try again.'));controller.signal.addEventListener('abort',onAbort,{once:true})});
        try{
          const raw=await Promise.race([options.readRecord(identity,controller.signal),aborted]);guard();
          const value=decodeCanonicalSyncRecord(identity,raw,'1');
          const saved=await options.session.putRecord(identity.entityType,identity.entityId,value);guard();
          if(saved.revision!==value.revision)throw new Error('Server record revision moved backwards. Verify server state before editing.');
        }catch(error){
          if(!disposed&&options.canEdit()&&error&&typeof error==='object'&&String((error as {code?:unknown}).code)==='42501'){
            await options.session.removeRecord(identity.entityType,identity.entityId);
            try{await options.downloaded?.()}catch{/* Removed access must not leave a stale published base. */}
          }
          throw error;
        }finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',onAbort);requests.delete(controller)}
      }
      const cached=(await options.session.listRecords()).find(row=>row.entityType===identity.entityType&&row.entityId===identity.entityId);guard();
      if(!cached)throw new Error('Open this detail editor online once to download a verified record before editing offline.');
      if(!cached.record)throw new Error('This record was deleted. Offline restoration is not supported.');
      const displayed=projectOfflineFleet([],{scope:options.session.scope,records:[cached],entries,loaded:true,offline:options.offline()}).records.find(row=>row.entityType===identity.entityType&&row.entityId===identity.entityId)?.record;
      if(!displayed)throw new Error('This record is unavailable.');
      const draft:OfflineDetailDraft={...identity,revision:cached.revision,record:clone(displayed),verifiedAt:cached.verifiedAt,...(parent?{pendingParentId:parent.operation.operationId}:{})};
      const deviceId=await options.session.getDeviceId(options.id);guard();
      drafts.set(draft,{base:clone(draft),deviceId,parent:parent?clone(parent):undefined});
      try{await options.downloaded?.()}catch{/* Download remains durable if publication needs retry. */}
      guard();return draft;
    },
    async prepareRebase(operationId:string,mode?:{downloadedOnly?:boolean}):Promise<ContinuationReview>{
      guard();const entry=(await options.session.list()).find(entry=>entry.operation.operationId===operationId);guard();
      if(!entry||!['vehicle','issue'].includes(entry.operation.entityType))throw new Error('Later edit is unavailable.');
      await editor.prepare({entityType:entry.operation.entityType as DetailTarget['entityType'],entityId:entry.operation.entityId},mode);guard();
      const review=await options.session.getContinuationReview(operationId);guard();rebaseReviews.set(review,clone(review));return review;
    },
    async rebase(review:ContinuationReview,choices:Readonly<Record<string,'current'|'saved'>>):Promise<OutboxEntry>{
      guard();const owned=rebaseReviews.get(review);if(!owned||Object.keys(createSyncPatch(owned as unknown as SyncRecord,review as unknown as SyncRecord)).length)throw new Error('Reload this account’s rebase review before continuing.');
      const operation=owned.operation;const release=options.reserve?.({entityType:operation.entityType as DetailTarget['entityType'],entityId:operation.entityId},operation.operationId)??(()=>{});
      let entry:OutboxEntry;try{entry=await options.session.rebaseContinuation(owned,choices)}finally{release()}
      try{await options.changed()}catch{/* Committed local decision remains durable. */}return entry;
    },
    async save(draft:OfflineDetailDraft,values:SyncRecord,extras:DetailSaveExtras={}):Promise<OutboxEntry>{
      guard();const owned=drafts.get(draft);if(!owned)throw new Error('Reload verified details before saving.');
      validateOfflineDetailValues(owned.base.entityType,values,extras);
      const saved={remove:[...(extras.remove??[])].sort(),attachmentIds:[...(extras.attachmentIds??[])].sort()};
      if(owned.operation){
        if(Object.keys(createSyncPatch(owned.values!,values)).length||JSON.stringify(owned.extras)!==JSON.stringify(saved))throw new Error('Retry the original values or reopen this editor before changing a failed save.');
      }else{
        const base=owned.base;const projected={...base.record,...clone(values)};for(const field of saved.remove)delete projected[field];
        const patch=createSyncPatch(base.record,projected);
        if(!Object.keys(patch).length)throw new Error('No detail changes to save.');
        owned.values=clone(values);owned.extras=saved;
        owned.operation={schemaVersion:1,operationId:options.id(),companyId:options.session.scope.companyId,entityType:base.entityType,entityId:base.entityId,
          provenance:{userId:options.session.scope.userId,deviceId:owned.deviceId,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.offline()?'offline':'online'},
          dependsOn:owned.parent?[owned.parent.operation.operationId]:[],mutation:{kind:'update',baseRevision:base.revision,base:clone(base.record),patch}};
      }
      guard();const operation=clone(owned.operation!);
      const base=owned.base;
      const release=options.reserve?.(base,operation.operationId)??(()=>{});
      let entry:OutboxEntry;
      const projection:Record<string,SyncRecord[string]>={...base.record,...owned.values};for(const field of owned.extras!.remove)delete projection[field];
      try{entry=await options.session.enqueue(operation,projection,{exclusiveRecord:!owned.parent,continuationParent:owned.parent?.operation.operationId,...(owned.extras!.attachmentIds.length?{attachmentIds:owned.extras!.attachmentIds}:{})})}finally{release()}
      // Durable commit succeeded. A notice refresh failure must never report the save itself failed.
      try{await options.changed()}catch{/* Worker/status refresh can retry; committed intent remains durable. */}
      return entry;
    },
  };
  return editor;
}
export type OfflineDetailEditor=ReturnType<typeof createOfflineDetailEditor>;
