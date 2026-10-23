import type {SupabaseClient} from '@supabase/supabase-js';
import type {SyncOperation} from '@fireops/domain';
import type {OutboxScope} from './offline-outbox';
import type {OfflineSyncTransport} from './offline-sync-worker';
import type {OfflineReceiptFiles} from './offline-receipt-files';
import {isUserSyncOperation,offlineFileUploads,userSyncCommands} from './offline-user-sync';

/** Bind each request to the verified local session token; never use a service key. */
export function createNativeSyncTransport(client:SupabaseClient,scope:OutboxScope,canRun:()=>boolean,receiptFiles?:OfflineReceiptFiles):OfflineSyncTransport & Required<Pick<OfflineSyncTransport,'readRecord'>> & {userSnapshot(signal:AbortSignal):Promise<unknown>;companySnapshot(section:string,signal:AbortSignal):Promise<unknown>}{
  const identity={...scope};
  async function verifiedSession(signal:AbortSignal){
    if(signal.aborted||!canRun())throw Object.assign(new Error('Sync paused'),{code:'SYNC_PAUSED'});
    const {data,error}=await client.auth.getSession();
    if(error||!data.session||data.session.user.id!==identity.userId)throw Object.assign(new Error('Session must be verified before syncing'),{code:'401'});
    if(signal.aborted||!canRun())throw Object.assign(new Error('Sync paused'),{code:'SYNC_PAUSED'});
    return data.session;
  }
  async function invoke(name:string,args:Record<string,unknown>,signal:AbortSignal){
    const session=await verifiedSession(signal);
    const result=await client.rpc(name,args).setHeader('Authorization',`Bearer ${session.access_token}`).abortSignal(signal);
    if(result.error)throw result.error;return result.data;
  }
  const recordArgs=(operation:SyncOperation)=>{
    if(operation.provenance.userId!==identity.userId)throw Object.assign(new Error('Sync account changed'),{code:'42501'});
    if(operation.companyId!==identity.companyId)throw Object.assign(new Error('Sync company changed'),{code:'42501'});
    return {target_company_id:identity.companyId,entity_type:operation.entityType,record_id:operation.entityId};
  };
  // Offline receipts and company documents: upload the kept file into the caller's
  // own folder (same policies as the online flow, never overwriting) before the
  // command creates the record for that path. A lost upload response retries as "already exists".
  async function deliverWithFile(operation:SyncOperation,signal:AbortSignal,target:{bucket:string;path:(scope:OutboxScope,id:string)=>string}){
    const bytes=receiptFiles?await receiptFiles.read(operation.entityId):null;
    if(bytes){
      await verifiedSession(signal);
      const mimeType=operation.mutation.kind==='command'?String(operation.mutation.payload.mimeType):'';
      const {error}=await client.storage.from(target.bucket).upload(target.path(identity,operation.entityId),bytes,{contentType:mimeType,upsert:false});
      if(error&&!/already exists|duplicate/i.test(error.message)&&String((error as {statusCode?:unknown}).statusCode??'')!=='409')throw error;
    }
    const result=await invoke('sync_user_command',{operation},signal) as {kind?:string;notApplied?:unknown}|null;
    if(result?.kind==='applied'&&result.notApplied===undefined)try{receiptFiles?.remove(operation.entityId)}catch{/* Removed on a later delivery or kept; never blocks the receipt. */}
    // A deleted receipt's stored file is removed afterwards, as online (owners may remove company receipt files).
    const base=operation.mutation.kind==='command'&&operation.mutation.command==='receipt.delete'?(operation.mutation.payload.base as {storagePath?:unknown}|undefined):undefined;
    if(result?.kind==='applied'&&result.notApplied===undefined&&typeof base?.storagePath==='string')try{await client.storage.from('receipt-files').remove([base.storagePath])}catch{/* An orphan file is safer than failing an applied delete. */}
    return result;
  }
  return {
    deliver(operation,signal,history=[]){
      recordArgs(operation);
      if(isUserSyncOperation(operation)&&offlineFileUploads[operation.entityType])return deliverWithFile(operation,signal,offlineFileUploads[operation.entityType]) as never;
      if(isUserSyncOperation(operation))return invoke('sync_user_command',{operation},signal);
      if(operation.mutation.kind==='create')return invoke('sync_fleet_create',{operation},signal);
      return history.length?invoke('sync_fleet_update_with_history',{operation,device_history:history},signal):invoke('sync_fleet_update',{operation},signal);
    },
    backfillHistory(operation,signal,history){
      recordArgs(operation);
      return invoke('backfill_fleet_sync_device_history',{operation,device_history:history},signal);
    },
    canonical(operation,signal){const args=recordArgs(operation);return userSyncCommands[operation.entityType]?invoke('get_user_sync_state',args,signal):invoke('get_fleet_sync_record',args,signal)},
    /** Verified own tasks/settings for this account and company. */
    userSnapshot(signal:AbortSignal){return invoke('get_user_sync_snapshot',{target_company_id:identity.companyId},signal)},
    /** Verified company list section (inventory, training, payroll, invoices, receipts) for this account and company. */
    companySnapshot(section:string,signal:AbortSignal){return invoke('get_company_sync_snapshot',{target_company_id:identity.companyId,section},signal)},
    downloadPage(progress,signal){return invoke('download_fleet_sync_page',{target_company_id:identity.companyId,expected_snapshot:progress.snapshotToken,record_cursor:progress.cursor},signal)},
    readRecord(target,signal){return invoke('get_fleet_sync_record',{target_company_id:identity.companyId,entity_type:target.entityType,record_id:target.entityId},signal)},
    withdrawConflict(operation,signal){
      recordArgs(operation);
      return invoke('withdraw_my_fleet_sync_conflict',{target_company_id:identity.companyId,operation_id:operation.operationId},signal);
    },
    outcome(operation,signal){
      recordArgs(operation);
      return invoke('get_fleet_sync_outcome',{target_company_id:identity.companyId,operation_id:operation.operationId},signal);
    },
  };
}
