import type {SyncRecord} from '@fireops/domain';
import type {DetailSaveExtras} from './offline-detail-editor';
import {createFleetId} from './fleet-store';

type Author={id:string;name:string};
/** Issue notes and resolve/reopen changes an issue can take while saved on this device. */
export type OfflineIssueChange=
  |{kind:'note';text:string}
  |{kind:'status';status:'Open'|'Resolved';note?:string};

/** Stable per-change key so a retried save is recognised as the same change. */
export function offlineIssueChangeKey(change:OfflineIssueChange){
  return change.kind==='note'?'note':change.note?'status-note':'status';
}

/**
 * Builds the device change from the verified draft record. Notes are prepended to the draft's
 * list (never replacing others); entry identity and time are fixed here, so a retry resends the same note.
 */
export function offlineIssueChange(change:OfflineIssueChange,record:SyncRecord,author:Author,now=new Date()):{values:SyncRecord;extras:DetailSaveExtras}{
  const note=change.kind==='note'?change.text:change.note;
  const updates:SyncRecord=note?{updates:[{id:createFleetId(),text:note,createdBy:author.name,createdById:author.id,createdAt:now.toISOString()},...((record.updates as SyncRecord[]|undefined)??[])]}:{};
  if(change.kind==='note')return {values:updates,extras:{}};
  return change.status==='Resolved'
    ?{values:{status:'Resolved',resolvedAt:now.toISOString(),...updates},extras:{}}
    :{values:{status:'Open',...updates},extras:{remove:['resolvedAt']}};
}
