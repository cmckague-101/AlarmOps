import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {parseDashboardPreferences, type DashboardItem, type DashboardPreferences} from '@fireops/domain';
import {supabase} from './supabase';
import {latestUserSetting, pendingDashboard, scopedUserEntries} from './offline-user-sync';
import {readUserSetting} from './read-user-setting';
import {useUserDataScope} from './user-data-scope';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

type State={items:DashboardPreferences;loading:boolean;saving:boolean;error:string;loadFailed?:boolean;ack?:string;writer?:()=>boolean};
const states=new Map<string,State>();
const listeners=new Set<()=>void>();
function publish(key:string,state:State){states.set(key,state);listeners.forEach(listener=>listener())}
function subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
export function useDashboardPreferences(userId:string|undefined,demoMode=false){
  const [attempt,setAttempt]=useState(0);
  const key=`${demoMode?'demo':'user'}:${userId??''}`;
  const offlineSync=useOptionalOfflineSync();const offline=!!offlineSync?.offline;
  const candidate=demoMode?null:offlineSync?.userSync;
  const userSync=candidate&&candidate.scope.userId===userId?candidate:null;
  const {token,current}=useUserDataScope(`${key}:${userSync?.scope.companyId??''}`);
  const gate=useMemo(()=>({locked:false}),[token]);
  const liveOffline=useRef(offline);liveOffline.current=offline;
  const remote=!!supabase&&!!userId&&validId(userId)&&!demoMode;
  const queueRequired=!demoMode&&(!!offlineSync?.available||offline||!!candidate);
  if(!states.has(key))states.set(key,{items:{},loading:remote,saving:false,error:''});
  const stored=useSyncExternalStore(subscribe,()=>states.get(key)!,()=>states.get(key)!);
  const entries=useMemo(()=>demoMode?[]:scopedUserEntries(offlineSync?.state.entries??[],userId,userSync?.scope.companyId),[demoMode,offlineSync?.state.entries,userId,userSync]);
  const ack=useMemo(()=>userSync?latestUserSetting(entries,userSync.scope,'dashboard'):undefined,[entries,userSync]);
  const pendingItems=parseDashboardPreferences(pendingDashboard(entries));
  const confirmed=ack&&stored.ack!==ack.id?parseDashboardPreferences(ack.record?.items):stored.items;
  const state={...stored,saving:stored.saving&&(stored.writer?.()??true),items:{...confirmed,...pendingItems}};
  useEffect(()=>{
    if(!remote)return;
    let active=true;const before=states.get(key)!;
    const valid=()=>active&&current()&&states.get(key)===before;
    void (async()=>{
      try{
        let items:DashboardPreferences;
        let acknowledged:string|undefined;
        if(userSync&&!liveOffline.current){
          const result=await readUserSetting(supabase!,userSync.scope,'dashboard',()=>valid()&&!liveOffline.current,ack?.revision);
          items=parseDashboardPreferences(result.record?.items);acknowledged=ack?.id;
        }else{
          const {data,error}=await supabase!.from('dashboard_preferences').select('items').eq('user_id',userId!).maybeSingle();
          if(error)throw error;items=parseDashboardPreferences(data?.items);
        }
        if(valid())publish(key,{items,ack:acknowledged,loading:false,saving:before.saving&&(before.writer?.()??false),writer:before.writer,error:''});
      }catch(error){if(valid())publish(key,{...before,loading:false,loadFailed:true,error:error instanceof Error?error.message:'Dashboard preferences could not be loaded.'})}
    })();
    return()=>{active=false};
  },[key,token,remote,userId,attempt,ack?.id,offline,userSync]);
  async function save(id:DashboardItem,enabled:boolean){
    if(!current()||gate.locked)return;
    const previous=states.get(key)!;
    if(previous.saving&&(previous.writer?.()??true))return;
    if(!queueRequired&&(previous.loading||previous.loadFailed))return;
    gate.locked=true;publish(key,{...previous,saving:true,writer:current,error:''});
    try{
      if(queueRequired){
        if(!userSync)throw new Error('Device saving is unavailable. Wait for account storage or retry.');
        await userSync.setDashboard({[id]:enabled});
      }else{
        const items={...previous.items,[id]:enabled};
        if(remote){const {error}=await supabase!.from('dashboard_preferences').upsert({user_id:userId,items});if(error)throw error}
        if(current())publish(key,{items,loading:false,saving:false,error:''});
      }
    }catch(error){
      if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,error:error instanceof Error?error.message:'Dashboard preferences could not be saved. Please try again.'});
    }finally{
      gate.locked=false;
      if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,writer:undefined});
    }
  }
  function reload(){if(current()){publish(key,{...states.get(key)!,loading:true,loadFailed:false,error:''});setAttempt(value=>value+1)}}
  return {...state,reload,visible:(id:DashboardItem)=>state.items[id]!==false,save};
}
