import type {SupabaseClient} from '@supabase/supabase-js';
import type {OutboxScope} from './offline-outbox';
import {decodeCanonicalSyncRecord} from './offline-sync-protocol';

/** Uncached, account-bound settings reconciliation; GET fallback is not proof. */
export async function readUserSetting(client:SupabaseClient,scope:OutboxScope,entity:'availability'|'dashboard',current:()=>boolean,minimumRevision='1') {
  const identity={...scope};const abort=new AbortController();
  const paused=()=>new Error('Settings account or connection changed.');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      (async()=>{
        if(!current())throw paused();
        const {data,error}=await client.auth.getSession();
        if(error||!data.session||data.session.user.id!==identity.userId||!current()||abort.signal.aborted)throw paused();
        const result=await client.rpc('get_user_sync_state',{target_company_id:identity.companyId,entity_type:entity,record_id:identity.userId})
          .setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(abort.signal);
        if(result.error)throw result.error;
        if(!current()||abort.signal.aborted)throw paused();
        return decodeCanonicalSyncRecord({entityId:identity.userId},result.data,minimumRevision);
      })(),
      new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('Settings refresh timed out. Please retry.'))},15_000)}),
    ]);
  }finally{if(timer)clearTimeout(timer);abort.abort()}
}
