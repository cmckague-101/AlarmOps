import type {NifcIncident,SyncRecord} from '@fireops/domain';
import type {DetailSaveExtras} from './offline-detail-editor';

/** Status, assignment and fire changes a vehicle can take while saved on this device. */
export type OfflineVehicleChange=
  |{kind:'status';status:'Ready'|'Out of service'}
  |{kind:'assign';memberId:string}
  |{kind:'unassign'}
  |{kind:'fire';fire:Pick<NifcIncident,'id'|'name'|'state'>}
  |{kind:'clearFire'};

const present=(record:SyncRecord,field:string)=>Object.prototype.hasOwnProperty.call(record,field);
// A status change or release clears whichever assignment fields the draft actually has.
const clearing=(record:SyncRecord)=>['assignedTo','assignedFire'].filter(field=>present(record,field));

/** Stable per-change key so a retried save is recognised as the same change. */
export function offlineVehicleChangeKey(change:OfflineVehicleChange){
  switch(change.kind){
    case 'status':return change.status;
    case 'assign':return `assign:${change.memberId}`;
    case 'unassign':return 'unassign';
    case 'fire':return `fire:${change.fire.id}`;
    case 'clearFire':return 'fire';
  }
}

/** Builds the device change from the verified draft record, matching the online status/assignment rules. */
export function offlineVehicleChange(change:OfflineVehicleChange,record:SyncRecord):{values:SyncRecord;extras:DetailSaveExtras}{
  switch(change.kind){
    case 'status':return {values:{status:change.status},extras:{remove:clearing(record)}};
    case 'assign':return {values:{status:'Assigned',assignedTo:change.memberId},extras:{}};
    case 'unassign':return {values:{status:record.status==='Assigned'?'Ready':record.status as string},extras:{remove:clearing(record)}};
    case 'fire':return {values:{assignedFire:{id:change.fire.id,name:change.fire.name,state:change.fire.state}},extras:{}};
    case 'clearFire':return {values:{},extras:{remove:['assignedFire']}};
  }
}
