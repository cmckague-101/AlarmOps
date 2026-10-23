import {mergeSyncUpdate,type SyncMergeResult,type SyncPatch,type SyncRecord} from './offline-sync';
import {vehicleFileSlots} from './attachment-upload';

// Client mirror of the server fleet detail adapter (validate_fleet_sync_detail_field,
// fleet_sync_merge_detail, validate_fleet_sync_record). The server stays authoritative.
export type FleetSyncEntity='vehicle'|'issue';
export const fleetSyncScalarFields:Readonly<Record<FleetSyncEntity,readonly string[]>>={vehicle:['unit','type','year','make','model','vin','plate','notes'],issue:['title','description','priority']};
export const fleetSyncFields:Readonly<Record<FleetSyncEntity,readonly string[]>>={
  vehicle:[...fleetSyncScalarFields.vehicle,...vehicleFileSlots,'status','assignedTo','assignedFire','inspections'],
  issue:[...fleetSyncScalarFields.issue,'status','resolvedAt','updates'],
};
/** Invariant groups conflict as one unit when any member changed concurrently. */
export const fleetSyncFieldGroups:Readonly<Record<FleetSyncEntity,readonly (readonly string[])[]>>={vehicle:[['status','assignedTo','assignedFire']],issue:[['status','resolvedAt']]};
export const vehicleStatuses=['Ready','Assigned','Out of service'] as const;
export const issueStatuses=['Open','Resolved'] as const;
export const isFleetSyncField=(entity:string,field:string)=>(entity==='vehicle'||entity==='issue')&&fleetSyncFields[entity].includes(field);

type ListEntry=Record<string,unknown>&{id:string};
/** Append-only list fields: entries are only ever prepended (server merges onto the current list). */
export const fleetSyncAppendFields:Readonly<Record<FleetSyncEntity,{field:string;max:number}>>={vehicle:{field:'inspections',max:1},issue:{field:'updates',max:20}};
const entries=(value:unknown):ListEntry[]=>{if(value===undefined)return [];if(!Array.isArray(value))throw new Error('Expected a list.');return value as ListEntry[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Entries a proposal prepended to its base list; anything else is not an append. */
export function addedListEntries(baseList:unknown,proposed:unknown,max:number):ListEntry[]{
  const base=entries(baseList);const next=entries(proposed);const count=next.length-base.length;
  if(count<1||count>max||!same(next.slice(count),base))throw new Error('Only new entries can be added.');
  return next.slice(0,count);
}
export const addedIssueUpdates=(baseUpdates:unknown,proposed:unknown)=>addedListEntries(baseUpdates,proposed,fleetSyncAppendFields.issue.max);
/** Prepends added entries to the current list, skipping ids already present. */
export function appendListEntries(entity:FleetSyncEntity,baseRecord:SyncRecord,currentRecord:SyncRecord,proposed:unknown):ListEntry[]{
  const {field,max}=fleetSyncAppendFields[entity];const added=addedListEntries(baseRecord[field],proposed,max);const current=entries(currentRecord[field]);
  return [...added.filter(entry=>!current.some(item=>item.id===entry.id)),...current];
}
export const appendIssueUpdates=(baseRecord:SyncRecord,currentRecord:SyncRecord,proposed:unknown)=>appendListEntries('issue',baseRecord,currentRecord,proposed);
export function mergeFleetSyncDetail(entity:FleetSyncEntity,base:SyncRecord,current:SyncRecord|null,patch:SyncPatch):SyncMergeResult{
  const {field}=fleetSyncAppendFields[entity];
  // Resolve/reopen with one note (server 20261213000100): if the issue already has
  // the proposed status, the current status/resolution is kept and only the note is added.
  if(entity==='issue'&&patch.updates&&patch.status){
    if(Object.keys(patch).some(key=>!['status','resolvedAt','updates'].includes(key)))throw new Error('A status change can only carry a note.');
    if(!patch.updates.present||addedIssueUpdates(base.updates,patch.updates.value).length!==1)throw new Error('A status change carries exactly one new note.');
    if(current===null)return mergeSyncUpdate(base,current,patch);
    const {updates,...statusPatch}=patch;
    const status=patch.status.present&&same(current.status,patch.status.value)?{kind:'merged',record:current,changedFields:[]} as SyncMergeResult:mergeSyncUpdate(base,current,statusPatch,{fieldGroups:fleetSyncFieldGroups.issue});
    if(status.kind!=='merged')return status;
    return {kind:'merged',record:{...status.record,updates:appendListEntries('issue',base,status.record,updates.value) as never},changedFields:[...status.changedFields,'updates']} as SyncMergeResult;
  }
  if(Object.prototype.hasOwnProperty.call(patch,field)){
    if(Object.keys(patch).length!==1)throw new Error(`${entity==='issue'?'Issue updates':'Inspections'} are saved separately from other changes.`);
    const slot=patch[field];if(!slot.present)throw new Error('Append-only lists cannot be removed.');
    if(current===null)return mergeSyncUpdate(base,current,patch);
    return {kind:'merged',record:{...current,[field]:appendListEntries(entity,base,current,slot.value) as never},changedFields:[field]} as SyncMergeResult;
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
