import {mergeSyncUpdate,type SyncMergeResult,type SyncPatch,type SyncRecord} from './offline-sync';
import {vehicleFileSlots} from './attachment-upload';

// Client mirror of the server fleet detail adapter (validate_fleet_sync_detail_field,
// fleet_sync_merge_detail, validate_fleet_sync_record). The server stays authoritative.
export type FleetSyncEntity='vehicle'|'issue';
export const fleetSyncScalarFields:Readonly<Record<FleetSyncEntity,readonly string[]>>={vehicle:['unit','type','year','make','model','vin','plate','notes'],issue:['title','description','priority']};
export const fleetSyncFields:Readonly<Record<FleetSyncEntity,readonly string[]>>={
  vehicle:[...fleetSyncScalarFields.vehicle,...vehicleFileSlots,'status','assignedTo','assignedFire'],
  issue:[...fleetSyncScalarFields.issue,'status','resolvedAt','updates'],
};
/** Invariant groups conflict as one unit when any member changed concurrently. */
export const fleetSyncFieldGroups:Readonly<Record<FleetSyncEntity,readonly (readonly string[])[]>>={vehicle:[['status','assignedTo','assignedFire']],issue:[['status','resolvedAt']]};
export const vehicleStatuses=['Ready','Assigned','Out of service'] as const;
export const issueStatuses=['Open','Resolved'] as const;
export const isFleetSyncField=(entity:string,field:string)=>(entity==='vehicle'||entity==='issue')&&fleetSyncFields[entity].includes(field);

type UpdateEntry=Record<string,unknown>&{id:string};
const entries=(value:unknown):UpdateEntry[]=>{if(value===undefined)return [];if(!Array.isArray(value))throw new Error('Issue updates must be a list.');return value as UpdateEntry[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Entries a proposal prepended to its base list; anything else is not an append. */
export function addedIssueUpdates(baseUpdates:unknown,proposed:unknown):UpdateEntry[]{
  const base=entries(baseUpdates);const next=entries(proposed);const count=next.length-base.length;
  if(count<1||count>20||!same(next.slice(count),base))throw new Error('Issue updates can only add new entries.');
  return next.slice(0,count);
}
/** Prepends added entries to the current list, skipping ids already present. */
export function appendIssueUpdates(baseRecord:SyncRecord,currentRecord:SyncRecord,proposed:unknown):UpdateEntry[]{
  const added=addedIssueUpdates(baseRecord.updates,proposed);const current=entries(currentRecord.updates);
  return [...added.filter(entry=>!current.some(item=>item.id===entry.id)),...current];
}
export function mergeFleetSyncDetail(entity:FleetSyncEntity,base:SyncRecord,current:SyncRecord|null,patch:SyncPatch):SyncMergeResult{
  if(entity==='issue'&&Object.prototype.hasOwnProperty.call(patch,'updates')){
    if(Object.keys(patch).length!==1)throw new Error('Issue updates are saved separately from other issue changes.');
    const slot=patch.updates;if(!slot.present)throw new Error('Issue updates cannot be removed.');
    if(current===null)return mergeSyncUpdate(base,current,patch);
    return {kind:'merged',record:{...current,updates:appendIssueUpdates(base,current,slot.value) as never},changedFields:['updates']} as SyncMergeResult;
  }
  return mergeSyncUpdate(base,current,patch,{fieldGroups:fleetSyncFieldGroups[entity]});
}
/** Same invariants the server enforces on an assembled record (membership is checked only by the server). */
export function fleetSyncRecordProblem(entity:FleetSyncEntity,before:SyncRecord|null,after:SyncRecord|null):string|null{
  if(!after)return null;
  if(entity==='vehicle'){
    if(before&&same([before.status,before.assignedTo,before.assignedFire],[after.status,after.assignedTo,after.assignedFire]))return null;
    const assignee=typeof after.assignedTo==='string'&&after.assignedTo?after.assignedTo:null;
    if(!(vehicleStatuses as readonly unknown[]).includes(after.status)||(after.status==='Assigned')!==!!assignee||(after.assignedFire!==undefined&&!assignee))return 'Vehicle status and assignment are inconsistent.';
    return null;
  }
  if(before&&same([before.status,before.resolvedAt],[after.status,after.resolvedAt]))return null;
  if(!(issueStatuses as readonly unknown[]).includes(after.status)||(after.status==='Resolved')!==(after.resolvedAt!==undefined))return 'Issue status and resolution time are inconsistent.';
  return null;
}
