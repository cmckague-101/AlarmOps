import type {SupabaseClient} from '@supabase/supabase-js';
import type {SyncOperation} from '@fireops/domain';
import type {OutboxScope} from './offline-outbox';
import type {OfflineSyncTransport} from './offline-sync-worker';

/** Bind each request to the verified local session token; never use a service key. */
export function createNativeSyncTransport(client:SupabaseClient,scope:OutboxScope,canRun:()=>boolean):OfflineSyncTransport & Required<Pick<OfflineSyncTransport,'readRecord'>>{
  const identity={...scope};
  async function invoke(name:string,args:Record<string,unknown>,signal:AbortSignal){
    if(signal.aborted||!canRun())throw Object.assign(new Error('Sync paused'),{code:'SYNC_PAUSED'});
    const {data,error}=await client.auth.getSession();
    if(error||!data.session||data.session.user.id!==identity.userId)throw Object.assign(new Error('Session must be verified before syncing'),{code:'401'});
    if(signal.aborted||!canRun())throw Object.assign(new Error('Sync paused'),{code:'SYNC_PAUSED'});
    const result=await client.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal);
    if(result.error)throw result.error;return result.data;
  }
  const recordArgs=(operation:SyncOperation)=>{
    if(operation.provenance.userId!==identity.userId)throw Object.assign(new Error('Sync account changed'),{code:'42501'});
    if(operation.companyId!==identity.companyId)throw Object.assign(new Error('Sync company changed'),{code:'42501'});
    return {target_company_id:identity.companyId,entity_type:operation.entityType,record_id:operation.entityId};
  };
  return {
    deliver(operation,signal,history=[]){
      recordArgs(operation);
      return history.length?invoke('sync_fleet_update_with_history',{operation,device_history:history},signal):invoke('sync_fleet_update',{operation},signal);
    },
    backfillHistory(operation,signal,history){
      recordArgs(operation);
      return invoke('backfill_fleet_sync_device_history',{operation,device_history:history},signal);
    },
    canonical(operation,signal){return invoke('get_fleet_sync_record',recordArgs(operation),signal)},
    downloadPage(progress,signal){return invoke('download_fleet_sync_page',{target_company_id:identity.companyId,expected_snapshot:progress.snapshotToken,record_cursor:progress.cursor},signal)},
    readRecord(target,signal){return invoke('get_fleet_sync_record',{target_company_id:identity.companyId,entity_type:target.entityType,record_id:target.entityId},signal)},
    outcome(operation,signal){
      recordArgs(operation);
      return invoke('get_fleet_sync_outcome',{target_company_id:identity.companyId,operation_id:operation.operationId},signal);
    },
  };
}
