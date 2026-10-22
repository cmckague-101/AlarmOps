import {createSyncPatch,mergeSyncUpdate,type SyncOperation,type SyncRecord,type SyncFieldValue} from './offline-sync';
import {syncReviewFileText,type SyncReviewTarget} from './sync-review-client';
export type DeviceHistoryCursor={receivedAt:string;actorUserId:string;operationId:string};
export type DeviceHistorySummary=DeviceHistoryCursor & SyncReviewTarget & {companyId:string;actorName:string|null};
export type DeviceHistoryEntry={before:SyncOperation;after:SyncOperation;reason:string;createdAt:string};
export type DeviceHistoryReport=DeviceHistorySummary & {deviceHistory:DeviceHistoryEntry[]};
export interface DeviceHistoryTransport{
  list(companyId:string,target:SyncReviewTarget,cursor:DeviceHistoryCursor|null):Promise<unknown>;
  report(companyId:string,target:SyncReviewTarget,summary:DeviceHistorySummary):Promise<unknown>;
}
const obj=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid device history.');return value as Record<string,unknown>};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const date=(value:unknown)=>text(value)&&Number.isFinite(Date.parse(value));
const same=(a:unknown,b:unknown)=>Object.keys(createSyncPatch({value:a as never},{value:b as never})).length===0;
export const deviceHistoryKey=(value:DeviceHistoryCursor)=>`${value.actorUserId}:${value.operationId}`;
function summary(value:unknown,companyId:string,target:SyncReviewTarget):DeviceHistorySummary{
  const data=obj(value);createSyncPatch({},data as SyncRecord);
  if(data.companyId!==companyId||data.entityType!==target.entityType||data.entityId!==target.entityId||!text(data.actorUserId)||!text(data.operationId)||!date(data.receivedAt)||(data.actorName!==null&&typeof data.actorName!=='string'))throw new Error('Device history scope changed.');
  return data as DeviceHistorySummary;
}
function proposed(operation:SyncOperation):SyncRecord{
  if(operation.mutation.kind!=='update')throw new Error('Unsupported device history.');
  const merged=mergeSyncUpdate(operation.mutation.base,operation.mutation.base,operation.mutation.patch);
  if(merged.kind!=='merged')throw new Error('Invalid saved version.');return merged.record;
}
export function decodeDeviceHistoryReport(value:unknown,companyId:string,target:SyncReviewTarget,expected:DeviceHistorySummary):DeviceHistoryReport{
  const data=summary(value,companyId,target) as DeviceHistoryReport;
  if(deviceHistoryKey(data)!==deviceHistoryKey(expected)||data.receivedAt!==expected.receivedAt||data.actorName!==expected.actorName||!Array.isArray(data.deviceHistory)||!data.deviceHistory.length||data.deviceHistory.length>100)throw new Error('Device history report changed.');
  let prior:SyncOperation|undefined;
  for(const entry of data.deviceHistory){
    obj(entry);if(!date(entry.createdAt)||!text(entry.reason))throw new Error('Invalid rebase metadata.');
    for(const operation of [entry.before,entry.after]){
      obj(operation);const provenance=obj(operation.provenance);const mutation=obj(operation.mutation);
      if(operation.schemaVersion!==1||operation.companyId!==companyId||operation.entityType!==target.entityType||operation.entityId!==target.entityId||operation.operationId!==data.operationId
        ||provenance.userId!==data.actorUserId||!text(provenance.deviceId)||!date(provenance.savedAt)||!['online','offline','unknown'].includes(String(provenance.connectivity))
        ||!Array.isArray(operation.dependsOn)||operation.dependsOn.length>1||!operation.dependsOn.every(text)||mutation.kind!=='update'||!text(mutation.baseRevision)||!/^[1-9][0-9]*$/.test(mutation.baseRevision)||obj(mutation.base).id!==target.entityId)throw new Error('Invalid device snapshot scope.');
      proposed(operation);
    }
    if(!same(entry.before.provenance,entry.after.provenance)||(prior&&!same(prior,entry.before)))throw new Error('Broken device history chain.');
    const fields=Object.keys(entry.before.mutation.kind==='update'?entry.before.mutation.patch:{});
    if(entry.reason!=='automatic_independent'){
      if(!entry.reason.startsWith('explicit:'))throw new Error('Unknown local decision.');const choices=obj(JSON.parse(entry.reason.slice(9)));
      if(Object.keys(choices).length!==fields.length||fields.some(key=>!['saved','current'].includes(String(choices[key]))))throw new Error('Incomplete local decisions.');
    }
    prior=entry.after;
  }
  return JSON.parse(JSON.stringify(data)) as DeviceHistoryReport;
}
export function deviceHistoryFields(entry:DeviceHistoryEntry){
  if(entry.before.mutation.kind!=='update'||entry.after.mutation.kind!=='update')throw new Error('Unsupported device history.');
  const saved=proposed(entry.before);const submitted=proposed(entry.after);const choices=entry.reason.startsWith('explicit:')?obj(JSON.parse(entry.reason.slice(9))):null;
  const slot=(record:SyncRecord,key:string):SyncFieldValue=>Object.prototype.hasOwnProperty.call(record,key)?{present:true,value:record[key]}:{present:false};
  return Object.keys(entry.before.mutation.patch).map(field=>({field,before:slot(entry.before.mutation.kind==='update'?entry.before.mutation.base:{},field),saved:slot(saved,field),downloaded:slot(entry.after.mutation.kind==='update'?entry.after.mutation.base:{},field),submitted:slot(submitted,field),choice:choices?String(choices[field]):'automatic independent merge'}));
}
export function deviceHistoryValueText(value:SyncFieldValue){return !value.present?'Not present':value.value===null?'Null':value.value===''?'Empty text':syncReviewFileText(value.value)??JSON.stringify(value.value,null,2)}
export type DeviceHistoryState={target:SyncReviewTarget|null;items:DeviceHistorySummary[];nextCursor:DeviceHistoryCursor|null;loaded:boolean;loading:boolean;error:string;report:DeviceHistoryReport|null;reportLoading:boolean;reportError:string};
const initial=():DeviceHistoryState=>({target:null,items:[],nextCursor:null,loaded:false,loading:false,error:'',report:null,reportLoading:false,reportError:''});
/** Online-only, memory-only inspection; never supplies drafts or approval choices. */
export function createDeviceHistoryClient(scope:{companyId:string;userId:string}|null,transport?:DeviceHistoryTransport){
  const identity=scope?{...scope}:null;let active=false;let epoch=0;let listing=0;let reading=0;let state=initial();const listeners=new Set<()=>void>();
  const emit=(patch:Partial<DeviceHistoryState>)=>{state={...state,...patch};listeners.forEach(listener=>listener())};
  const valid=(version:number)=>active&&identity!==null&&version===epoch;
  const failure=(error:unknown)=>['42P01','42883','PGRST202','PGRST205'].includes(String((error as {code?:unknown})?.code))?'History inspection needs pending database migrations.':'History could not be loaded. Check your connection and current manager access.';
  return {
    getSnapshot:()=>state,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    start(){active=true;epoch++},stop(){active=false;epoch++;emit({...initial(),target:state.target})},
    target(target:SyncReviewTarget|null){epoch++;listing++;reading++;emit({...initial(),target:target?{...target}:null})},
    async list(more=false){
      if(!active||!identity||!state.target||state.loading||!transport||(more&&!state.nextCursor))return;
      const version=epoch;const request=++listing;const target={...state.target};const cursor=more?state.nextCursor:null;reading++;
      emit({loading:true,error:'',report:null,reportLoading:false,reportError:'',...(!more?{items:[],nextCursor:null,loaded:false}:{})});
      try{
        const raw=obj(await transport.list(identity.companyId,target,cursor));if(!valid(version)||request!==listing)return;
        if(!Array.isArray(raw.items)||raw.items.length>20)throw new Error('Invalid history page.');
        const items=raw.items.map(item=>summary(item,identity.companyId,target));const seen=new Set(state.items.map(deviceHistoryKey));
        if(items.some(item=>{const key=deviceHistoryKey(item);if(seen.has(key))return true;seen.add(key);return false}))throw new Error('Repeated history page.');
        let next:DeviceHistoryCursor|null=null;
        if(raw.nextCursor!==null){const value=obj(raw.nextCursor);if(!date(value.receivedAt)||!text(value.actorUserId)||!text(value.operationId)||items.length!==20||!same(value,{receivedAt:items[19].receivedAt,actorUserId:items[19].actorUserId,operationId:items[19].operationId}))throw new Error('Invalid history cursor.');next=value as DeviceHistoryCursor}
        emit({items:[...(more?state.items:[]),...items],nextCursor:next,loaded:true,loading:false});
      }catch(error){if(valid(version)&&request===listing)emit({items:[],nextCursor:null,loaded:false,loading:false,error:failure(error),report:null})}
    },
    async inspect(item:DeviceHistorySummary){
      if(!active||!identity||!state.target||state.loading||!transport||!state.items.some(value=>same(value,item)))return;
      const version=epoch;const request=++reading;const target={...state.target};const expected={...item};emit({report:null,reportLoading:true,reportError:''});
      try{const raw=await transport.report(identity.companyId,target,expected);if(!valid(version)||request!==reading)return;if(raw===null)throw new Error('History unavailable');emit({report:decodeDeviceHistoryReport(raw,identity.companyId,target,expected),reportLoading:false})}
      catch(error){if(valid(version)&&request===reading)emit({items:[],nextCursor:null,loaded:false,report:null,reportLoading:false,reportError:failure(error)})}
    },
  };
}
export type DeviceHistoryClient=ReturnType<typeof createDeviceHistoryClient>;
