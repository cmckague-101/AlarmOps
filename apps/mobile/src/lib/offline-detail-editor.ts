import {createSyncPatch,type SyncOperation,type SyncRecord} from '@fireops/domain';
import type {OfflineOutboxSession,OutboxEntry} from './offline-outbox';
import {decodeCanonicalSyncRecord} from './offline-sync-protocol';

export type DetailTarget={readonly entityType:'vehicle'|'issue';readonly entityId:string};
export type OfflineDetailDraft=DetailTarget & {readonly revision:string;readonly record:SyncRecord;readonly verifiedAt:string};
const fields={vehicle:['unit','type','year','make','model','vin','plate','notes'],issue:['title','description','priority']};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const active=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
export function validateOfflineDetailValues(entityType:DetailTarget['entityType'],values:SyncRecord){
  createSyncPatch({},values);
  for(const [field,value] of Object.entries(values)){
    if(!fields[entityType].includes(field))throw new Error('This field is not enabled for offline editing.');
    if(field==='year'){
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
  const drafts=new WeakMap<OfflineDetailDraft,{base:OfflineDetailDraft;deviceId:string;operation?:SyncOperation;values?:SyncRecord}>();
  function guard(){if(disposed||!options.canEdit())throw new Error('This offline editor is no longer available for the current account or permissions.')}
  async function available(target:DetailTarget){
    if((await options.session.list()).some(entry=>entry.operation.entityType===target.entityType&&entry.operation.entityId===target.entityId&&active(entry)))throw new Error('This record already has a pending change. Sync or resolve it before editing again.');
  }
  return {
    dispose(){disposed=true;for(const request of requests)request.abort();requests.clear()},
    async prepare(target:DetailTarget,mode?:{downloadedOnly?:boolean}):Promise<OfflineDetailDraft>{
      const downloadedOnly=mode?.downloadedOnly===true;
      guard();if(!['vehicle','issue'].includes(target.entityType))throw new Error('Unsupported detail editor.');
      const identity={...target};await available(identity);guard();
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
      const draft:OfflineDetailDraft={...identity,revision:cached.revision,record:clone(cached.record),verifiedAt:cached.verifiedAt};
      const deviceId=await options.session.getDeviceId(options.id);guard();
      drafts.set(draft,{base:clone(draft),deviceId});
      try{await options.downloaded?.()}catch{/* Download remains durable if publication needs retry. */}
      guard();return draft;
    },
    async save(draft:OfflineDetailDraft,values:SyncRecord):Promise<OutboxEntry>{
      guard();const owned=drafts.get(draft);if(!owned)throw new Error('Reload verified details before saving.');
      validateOfflineDetailValues(owned.base.entityType,values);
      if(owned.operation){
        if(Object.keys(createSyncPatch(owned.values!,values)).length)throw new Error('Retry the original values or reopen this editor before changing a failed save.');
      }else{
        const base=owned.base;const projected={...base.record,...clone(values)};
        const patch=createSyncPatch(base.record,projected);
        if(!Object.keys(patch).length)throw new Error('No detail changes to save.');
        owned.values=clone(values);
        owned.operation={schemaVersion:1,operationId:options.id(),companyId:options.session.scope.companyId,entityType:base.entityType,entityId:base.entityId,
          provenance:{userId:options.session.scope.userId,deviceId:owned.deviceId,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.offline()?'offline':'online'},
          dependsOn:[],mutation:{kind:'update',baseRevision:base.revision,base:clone(base.record),patch}};
      }
      guard();const operation=clone(owned.operation!);
      const base=owned.base;
      const release=options.reserve?.(base,operation.operationId)??(()=>{});
      let entry:OutboxEntry;
      try{entry=await options.session.enqueue(operation,{...base.record,...owned.values},{exclusiveRecord:true})}finally{release()}
      // Durable commit succeeded. A notice refresh failure must never report the save itself failed.
      try{await options.changed()}catch{/* Worker/status refresh can retry; committed intent remains durable. */}
      return entry;
    },
  };
}
export type OfflineDetailEditor=ReturnType<typeof createOfflineDetailEditor>;
