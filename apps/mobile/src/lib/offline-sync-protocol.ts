import {createSyncPatch,mergeSyncUpdate,type SyncOperation,type SyncRecord,type SyncReviewOutcome,type SyncServerReceipt} from '@fireops/domain';

export type CanonicalSyncRecord={readonly revision:string;readonly record:SyncRecord|null};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid sync response');return value as Record<string,unknown>}
function text(value:unknown):asserts value is string{if(typeof value!=='string'||!value.trim())throw new Error('Invalid sync response text')}
function date(value:unknown){text(value);if(!Number.isFinite(Date.parse(value)))throw new Error('Invalid sync response time')}
export function syncRevision(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[1-9][0-9]{0,17}$/.test(value))throw new Error('Invalid sync revision')}
function record(value:unknown,id:string){if(value===null)return;createSyncPatch({},value as SyncRecord);if(object(value).id!==id)throw new Error('Sync record identity changed')}
function copy<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T}
export function decodeSyncReceipt(operation:SyncOperation,value:unknown):SyncServerReceipt{
  createSyncPatch({},value as SyncRecord);const data=object(value);date(data.receivedAt);
  if(data.kind==='applied'){syncRevision(data.revision);record(data.record,operation.entityId)}
  else if(data.kind==='awaiting_review')text(data.conflictId);
  else throw new Error('Invalid sync acknowledgment');
  return copy(value as SyncServerReceipt);
}
export function decodeCanonicalSyncRecord(operation:Pick<SyncOperation,'entityId'>,value:unknown,minimumRevision:string):CanonicalSyncRecord{
  createSyncPatch({},value as SyncRecord);const data=object(value);syncRevision(data.revision);syncRevision(minimumRevision);record(data.record,operation.entityId);
  if(BigInt(data.revision)<BigInt(minimumRevision))throw new Error('Shared record is older than the acknowledged change');
  return copy({revision:data.revision,record:data.record as SyncRecord|null});
}
export function decodeSyncOutcome(operation:SyncOperation,conflictId:string,value:unknown):SyncReviewOutcome|null{
  if(value===null)return null;
  createSyncPatch({},value as SyncRecord);const data=object(value);
  if(data.kind!=='reviewed'||data.operationId!==operation.operationId||data.conflictId!==conflictId)throw new Error('Review outcome does not match this change');
  text(data.decisionId);date(data.decidedAt);syncRevision(data.revision);
  if(!['kept','partially_kept','not_selected'].includes(String(data.outcome))||!Array.isArray(data.keptFields)||!Array.isArray(data.discardedFields))throw new Error('Invalid review outcome');
  const fields=[...data.keptFields,...data.discardedFields];fields.forEach(text);
  if(new Set(fields).size!==fields.length)throw new Error('Duplicate review outcome field');
  if(operation.mutation.kind==='update'){
    const proposed=mergeSyncUpdate(operation.mutation.base,operation.mutation.base,operation.mutation.patch);
    if(proposed.kind!=='merged')throw new Error('Invalid pending update');
    const changed=Object.keys(createSyncPatch(operation.mutation.base,proposed.record));
    if(fields.length!==changed.length||fields.some(field=>!changed.includes(field)))throw new Error('Review outcome omitted or added fields');
  }
  if((data.outcome==='kept'&&data.discardedFields.length!==0)||(data.outcome==='not_selected'&&data.keptFields.length!==0)
    ||(data.outcome==='partially_kept'&&(!data.keptFields.length||!data.discardedFields.length)))throw new Error('Inconsistent review outcome');
  return copy(value as SyncReviewOutcome);
}

/** No implicit replay of commands, attachments, or edits that need dependency rebasing. */
export function offlineSyncAdapterBlock(operation:SyncOperation):string|null{
  if(operation.schemaVersion!==1||operation.mutation.kind!=='update'||!['vehicle','issue'].includes(operation.entityType))return 'This workflow is not enabled for offline sync yet. Work remains on this device.';
  if(operation.dependsOn.length)return 'This edit depends on earlier work and needs an explicit rebase before syncing.';
  const allowed=operation.entityType==='vehicle'?['unit','type','year','make','model','vin','plate','notes']:['title','description','priority'];
  if(Object.keys(operation.mutation.patch).some(key=>!allowed.includes(key)))return 'This field needs a dedicated offline adapter. Work remains on this device.';
  return null;
}
