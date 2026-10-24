import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createSyncReviewClient,type SyncReviewTransport} from '@fireops/domain';
import {supabase} from './supabase';
import { createId } from './create-id';

export function useSyncConflictReview(companyId?:string,userId?:string,demoMode=false){
  const controller=useMemo(()=>{
    const client=supabase;
    async function historyRpc(name:string,args:Record<string,unknown>){
      if(!client)throw new Error('Database unavailable');
      const {data:auth,error:authError}=await client.auth.getSession();
      if(authError||!auth.session||auth.session.user.id!==userId)throw new Error('Verify your current account before inspecting history.');
      const {data,error}=await client.rpc(name,args).setHeader('Authorization',`Bearer ${auth.session.access_token}`);
      if(error)throw error;return data;
    }
    const transport:SyncReviewTransport={
      history:{
        list:(company,target,cursor)=>historyRpc('list_fleet_sync_device_history',{target_company_id:company,target_entity_type:target.entityType,target_record_id:target.entityId,history_cursor:cursor}),
        report:(company,target,item)=>historyRpc('get_fleet_sync_device_history_report',{target_company_id:company,target_entity_type:target.entityType,target_record_id:target.entityId,submitter_id:item.actorUserId,submitted_operation_id:item.operationId}),
      },
      async list(company,offset,limit){
        if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.from('fleet_sync_conflicts').select('id,company_id,entity_type,record_id,received_at')
          .eq('company_id',company).eq('state','pending').order('received_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+limit-1);
        if(error)throw error;return data??[];
      },
      async review(company,target){
        if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.rpc('get_fleet_sync_review',{target_company_id:company,entity_type:target.entityType,record_id:target.entityId});
        if(error)throw error;return data;
      },
      async approve(request){
        if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.rpc('approve_fleet_sync_review',{request});
        if(error)throw error;return data;
      },
    };
    return createSyncReviewClient(client&&companyId&&userId&&!demoMode?{companyId,userId}:null,transport,()=>createId());
  },[companyId,userId,demoMode]);
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{
    controller.start();
    if(controller.getSnapshot().status==='disabled')return()=>controller.stop();
    // Conflicts are not yet published to Realtime. Poll + focus/reconnect + explicit refresh.
    const refresh=()=>{if(!document.hidden)void controller.refreshGroups()};
    const timer=window.setInterval(()=>{if(controller.getSnapshot().status!=='unavailable')refresh()},30_000);
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
    return()=>{controller.stop();window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh)};
  },[controller]);
  return {controller,state};
}
