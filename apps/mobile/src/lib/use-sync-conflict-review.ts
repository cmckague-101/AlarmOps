import {useCallback,useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {createSyncReviewClient,isCompanyManager,type SyncReviewTransport} from '@fireops/domain';
import {supabase} from './supabase';
import {createFleetId} from './fleet-store';
import {useSession} from '../providers/session-provider';
import {isOffline,useNetworkStatus} from '../providers/network-provider';

export function useSyncConflictReview(){
  const {access,session,demoMode}=useSession();
  const {isOffline:offline}=useNetworkStatus();
  const previousOffline=useRef(offline);
  const member=access.status==='ready'&&access.value?.kind==='member'?access.value:null;
  const allowed=!!member&&isCompanyManager(member.user.role)&&session?.user.id===member.user.id&&!demoMode;
  const companyId=allowed?member?.company.id:undefined;
  const userId=allowed?member?.user.id:undefined;
  const controller=useMemo(()=>{
    const client=supabase;
    const online=()=>{if(isOffline())throw Object.assign(new Error('Connect to review conflicts'),{code:'OFFLINE'})};
    async function historyRpc(name:string,args:Record<string,unknown>){
      online();if(!client)throw new Error('Database unavailable');
      const {data:auth,error:authError}=await client.auth.getSession();
      if(authError||!auth.session||auth.session.user.id!==userId)throw new Error('Verify your current account before inspecting history.');
      online();const {data,error}=await client.rpc(name,args).setHeader('Authorization',`Bearer ${auth.session.access_token}`);
      if(error)throw error;return data;
    }
    const transport:SyncReviewTransport={
      history:{
        list:(company,target,cursor)=>historyRpc('list_fleet_sync_device_history',{target_company_id:company,target_entity_type:target.entityType,target_record_id:target.entityId,history_cursor:cursor}),
        report:(company,target,item)=>historyRpc('get_fleet_sync_device_history_report',{target_company_id:company,target_entity_type:target.entityType,target_record_id:target.entityId,submitter_id:item.actorUserId,submitted_operation_id:item.operationId}),
      },
      async list(company,offset,limit){
        online();if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.from('fleet_sync_conflicts').select('id,company_id,entity_type,record_id,received_at')
          .eq('company_id',company).eq('state','pending').order('received_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+limit-1);
        if(error)throw error;return data??[];
      },
      async review(company,target){
        online();if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.rpc('get_fleet_sync_review',{target_company_id:company,entity_type:target.entityType,record_id:target.entityId});
        if(error)throw error;return data;
      },
      async approve(request){
        online();if(!client)throw new Error('Database unavailable');
        const {data,error}=await client.rpc('approve_fleet_sync_review',{request});
        if(error)throw error;return data;
      },
    };
    return createSyncReviewClient(companyId&&userId?{companyId,userId}:null,transport,createFleetId);
  },[companyId,userId,demoMode]);
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{
    controller.start();
    if(controller.getSnapshot().status==='disabled')return()=>controller.stop();
    const subscription=AppState.addEventListener('change',value=>{if(value==='active'&&!isOffline())void controller.refreshGroups()});
    const timer=setInterval(()=>{if(AppState.currentState==='active'&&!isOffline()&&controller.getSnapshot().status!=='unavailable')void controller.refreshGroups()},30_000);
    return()=>{controller.stop();subscription.remove();clearInterval(timer)};
  },[controller]);
  useFocusEffect(useCallback(()=>{if(!isOffline())void controller.refreshGroups()},[controller]));
  useEffect(()=>{if(previousOffline.current&&!offline)void controller.refreshGroups();previousOffline.current=offline},[offline,controller]);
  return {controller,state,allowed,offline,demoMode};
}
