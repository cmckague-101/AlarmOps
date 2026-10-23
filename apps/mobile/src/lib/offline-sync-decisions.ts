import {addedListEntries,fleetSyncAppendFields,mergeSyncUpdate,type SyncRecord} from '@fireops/domain';
import type {OfflineDetailEditor} from './offline-detail-editor';
import type {OfflineSyncDecision,OfflineSyncWorker} from './offline-sync-worker';
import type {OfflineUserSync} from './offline-user-sync';

/**
 * Carries out the user's decision on one conflicted or refused change.
 * - Cancel: a fleet conflict is withdrawn (nothing changes on the server); a refused command's notice is cleared.
 * - Submit again: a fleet conflict is withdrawn, then the same field values are saved as a new change from
 *   the current verified version (append-only notes/inspections are re-appended onto the current list);
 *   a refused command is re-sent against the version the server reported.
 */
export async function resolveOfflineDecision(decision:OfflineSyncDecision,action:'resubmit'|'cancel',deps:{worker:OfflineSyncWorker;editor:OfflineDetailEditor|null;userSync:OfflineUserSync|null}){
  const {entry}=decision;const op=entry.operation;
  if(decision.kind==='refused'){
    if(!deps.userSync)throw new Error('Saved changes are unavailable for this account.');
    if(action==='cancel')return deps.userSync.cancelRefused(op.operationId);
    if(!decision.canResubmit)throw new Error('This change cannot succeed if sent again. Cancel it instead.');
    await deps.userSync.resubmit(entry);return;
  }
  if(action==='resubmit'&&(!deps.editor||op.mutation.kind!=='update'||(op.entityType!=='vehicle'&&op.entityType!=='issue')))throw new Error('This change cannot be sent again from this device.');
  await deps.worker.withdrawConflict(op.operationId);
  if(action==='cancel'||op.mutation.kind!=='update'||!deps.editor||(op.entityType!=='vehicle'&&op.entityType!=='issue'))return;
  const {base,patch}=op.mutation;const proposed=mergeSyncUpdate(base,base,patch);if(proposed.kind!=='merged')throw new Error('The saved change is invalid.');
  const draft=await deps.editor.prepare({entityType:op.entityType,entityId:op.entityId});
  const append=fleetSyncAppendFields[op.entityType];const values:Record<string,SyncRecord[string]>={};const remove:string[]=[];
  for(const [field,slot] of Object.entries(patch)){
    if(field===append.field&&slot.present){
      const added=addedListEntries(base[field],slot.value,append.max);const current=(draft.record[field] as SyncRecord[]|undefined)??[];
      values[field]=[...added.filter(item=>!current.some(existing=>existing.id===item.id)),...current] as SyncRecord[string];
    }else if(slot.present)values[field]=proposed.record[field];
    else remove.push(field);
  }
  await deps.editor.save(draft,values,{remove,attachmentIds:entry.attachmentIds??[]});
}
