import {fleetSyncFields,isVehicleFileSlot,mergeFleetSyncDetail,mergeSyncUpdate,type SyncRecord} from '@fireops/domain';
import type {CachedOfflineRecord,OfflineOutboxSession,OutboxEntry,OutboxScope} from './offline-outbox';
import type {DetailTarget} from './offline-detail-editor';
import {offlineSyncEntryLabel} from './offline-sync-worker';

export const fleetDetailKey=(target:DetailTarget)=>`${target.entityType}:${target.entityId}`;
export const unresolvedDetail=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
export type FleetModelRecord=DetailTarget & {revision:string;record:SyncRecord|null};
export type OfflineFleetModel={scope:OutboxScope;records:readonly CachedOfflineRecord[];entries:readonly OutboxEntry[];offline:boolean;loaded:boolean};

/** Display only. Never feed these merged/normalized records back into a verified edit base. */
export function projectOfflineFleet(remote:readonly FleetModelRecord[],local:OfflineFleetModel,deleted:ReadonlyMap<string,string>=new Map()){
  const records=new Map(remote.map(row=>[fleetDetailKey(row),row]));
  const pending:Record<string,string>={};
  for(const cached of local.records){
    const key=fleetDetailKey(cached);const current=records.get(key);const removed=deleted.get(key);
    if(removed&&BigInt(cached.revision)<=BigInt(removed))continue;
    if(!current||BigInt(cached.revision)>=BigInt(current.revision))records.set(key,cached);
  }
  const entries=[...local.entries].sort((a,b)=>a.sequence-b.sequence);
  for(const entry of entries){
    const op=entry.operation;
    if(op.companyId!==local.scope.companyId||op.provenance.userId!==local.scope.userId||!['vehicle','issue'].includes(op.entityType)||!unresolvedDetail(entry))continue;
    const target={entityType:op.entityType as DetailTarget['entityType'],entityId:op.entityId};const key=fleetDetailKey(target);
    pending[key]=offlineSyncEntryLabel(entry);
    // A locally reported issue is previewed only until a verified record exists.
    if(op.mutation.kind==='create'){if(op.entityType==='issue'&&!records.has(key)){records.set(key,{...target,revision:'0',record:op.mutation.record});pending[key]=`Local proposal · ${pending[key]}`}continue}
    if(op.mutation.kind!=='update'||entry.reviewOutcome&&entry.reviewOutcome.outcome!=='kept')continue;
    // File slots are not overlaid: their copy may not exist until the change syncs.
    // Inspections are not overlaid either: their photos may not be copied yet.
    if(Object.keys(op.mutation.patch).some(field=>!fleetSyncFields[op.entityType as 'vehicle'|'issue'].includes(field)||isVehicleFileSlot(field)||field==='inspections'))continue;
    const confirmed=records.get(key);
    const current=confirmed?.record??op.mutation.base;
    let merged;try{merged=op.mutation.patch.updates?mergeFleetSyncDetail('issue',op.mutation.base,current,op.mutation.patch):mergeSyncUpdate(current,current,op.mutation.patch)}catch{continue}
    if(merged.kind!=='merged')continue;
    records.set(key,{...target,revision:confirmed?.revision??op.mutation.baseRevision,record:merged.record});
    pending[key]=`Local proposal · ${pending[key]}`;
    if(confirmed?.record===null||!confirmed&&deleted.has(key))pending[key]='Local proposal · shared record deleted; review required';
  }
  return {records:[...records.values()],pending};
}

const pendingWriteMessage='Saved changes for this record must sync or finish review before other actions. Open Saved changes & sync.';
function blocksLegacy(entry:OutboxEntry,targets:readonly DetailTarget[]){
  if(!unresolvedDetail(entry))return false;
  const keys=new Set(targets.map(fleetDetailKey));
  if(keys.has(`${entry.operation.entityType}:${entry.operation.entityId}`))return true;
  const mutation=entry.operation.mutation;
  return entry.operation.entityType==='issue'&&mutation.kind==='update'&&typeof mutation.base.vehicleId==='string'&&keys.has(`vehicle:${mutation.base.vehicleId}`);
}

/** Short-lived reservations close the race between legacy online requests and local enqueue. */
export function createFleetEditGate(session:OfflineOutboxSession,canAccess:()=>boolean){
  const held=new Map<string,{owner:string;count:number}>();
  function acquire(targets:readonly DetailTarget[],owner:string){
    if(!canAccess())throw new Error('Fleet account changed. Reopen this screen.');
    const keys=[...new Set(targets.map(fleetDetailKey))];
    if(keys.some(key=>held.has(key)&&held.get(key)!.owner!==owner))throw new Error('Another save is in progress for this record. Wait before retrying.');
    for(const key of keys){const value=held.get(key);held.set(key,{owner,count:(value?.count??0)+1})}
    let released=false;
    return ()=>{if(released)return;released=true;for(const key of keys){const value=held.get(key);if(value?.owner===owner){if(value.count===1)held.delete(key);else value.count--}}};
  }
  return {
    acquire,
    async legacy(targets:readonly DetailTarget[],owner:string){
      const release=acquire(targets,owner);
      try{
        const entries=await session.list();if(!canAccess())throw new Error('Fleet account changed. Reopen this screen.');
        if(entries.some(entry=>blocksLegacy(entry,targets)))throw new Error(pendingWriteMessage);
        return release;
      }catch(error){release();throw error}
    },
  };
}

// Provider owns this binding. Late cleanup/publication cannot replace another account's model.
type Binding={model:OfflineFleetModel;current:()=>boolean;visible:()=>boolean;legacy:(targets:readonly DetailTarget[],owner:string)=>Promise<()=>void>;refresh:()=>void};
let binding:Binding|null=null;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(listener=>listener());
export const subscribeOfflineFleet=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export function getOfflineFleet(scope:OutboxScope):OfflineFleetModel|null{
  return binding?.current()&&binding.visible()&&binding.model.scope.userId===scope.userId&&binding.model.scope.companyId===scope.companyId?binding.model:null;
}
export function bindOfflineFleet(value:Binding){
  binding=value;emit();
  return {publish(model:OfflineFleetModel){if(binding===value){value.model=model;emit()}},dispose(){if(binding===value){binding=null;emit()}}};
}
export async function guardOfflineFleetWrite(scope:OutboxScope,targets:readonly DetailTarget[],owner:string){
  if(!targets.length)return ()=>{};
  const current=binding;
  if(!current)return ()=>{};
  if(!current.current()||current.model.scope.userId!==scope.userId||current.model.scope.companyId!==scope.companyId)throw new Error('Fleet account changed. Reopen this screen.');
  if(current.model.entries.some(entry=>blocksLegacy(entry,targets)))throw new Error(pendingWriteMessage);
  return current.legacy(targets,owner);
}
export function refreshOfflineFleet(){if(binding?.current())binding.refresh()}
