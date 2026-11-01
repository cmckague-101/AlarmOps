import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {createDashboardPreferenceTransport,createOnlineDashboardWrite,onlineDashboardWriteError,parseDashboardPreferences,readOnlineDashboardPreferences,type DashboardItem,type DashboardPreferences,type OnlineDashboardWrite} from '@fireops/domain';
import {supabase} from './supabase';
import {createFleetId} from './fleet-store';
import {latestUserSetting, pendingDashboard, scopedUserEntries} from './offline-user-sync';
import {receiptsAfter} from './offline-user-snapshot';
import {readUserSetting} from './read-user-setting';
import {useUserDataScope} from './user-data-scope';
import {isOffline} from '@/providers/network-provider';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

type State={items:DashboardPreferences;loading:boolean;saving:boolean;error:string;loadFailed?:boolean;ack?:string;writer?:()=>boolean;pending?:OnlineDashboardWrite};
const states=new Map<string,State>();
const listeners=new Set<()=>void>();
// Several components use this hook at once; they share one online read while it is in flight.
const reads=new Map<string,Promise<DashboardPreferences>>();
function readShared(key:string,read:()=>Promise<DashboardPreferences>){
  const existing=reads.get(key);if(existing)return existing;
  const request=read().finally(()=>{if(reads.get(key)===request)reads.delete(key)});
  reads.set(key,request);return request;
}
const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
function publish(key:string,state:State){
  states.set(key,state);listeners.forEach(listener=>listener());
  if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
    if([...states.values()].some(value=>!!value.pending))window.addEventListener('beforeunload',leaving);
    else window.removeEventListener('beforeunload',leaving);
  }
}
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
  // Offline: the verified download plus own receipts newer than it (receipts it covers are already in it).
  const saved=userSync?offlineSync?.userSnapshot?.snapshot:undefined;
  const downloaded=offline&&saved&&userSync&&saved.userId===userSync.scope.userId&&saved.companyId===userSync.scope.companyId?saved:null;
  const downloadedItems=useMemo(()=>{
    if(!downloaded)return null;
    const newer=receiptsAfter(entries.filter(entry=>entry.operation.entityType==='dashboard'),downloaded).at(-1);
    return parseDashboardPreferences(newer?.receipt?.kind==='applied'?newer.receipt.record?.items:downloaded.dashboard);
  },[downloaded,entries]);
  const confirmed=ack&&stored.ack!==ack.id?parseDashboardPreferences(ack.record?.items):stored.items;
  const saving=stored.saving&&(stored.writer?.()??true);
  const state={...stored,saving,retryRequired:!!stored.pending,error:stored.error||(!saving&&stored.pending?onlineDashboardWriteError(undefined,stored.pending.acknowledged):''),items:{...confirmed,...pendingItems}};
  useEffect(()=>{
    if(!remote)return;
    let active=true;const before=states.get(key)!;
    const valid=()=>active&&current()&&states.get(key)===before;
    void (async()=>{
      try{
        let items:DashboardPreferences;
        let acknowledged:string|undefined;
        if(userSync||liveOffline.current){
          // Keep the existing account-bound read cache warm for native restart
          // reads. It is not canonical proof and cannot override a verified ack.
          const cached=Promise.resolve(supabase!.from('dashboard_preferences').select('items').eq('user_id',userId!).maybeSingle()).then(({data,error})=>{if(error)throw error;return parseDashboardPreferences(data?.items)});
          if(userSync&&!liveOffline.current){
            void cached.catch(()=>{});
            const result=await readUserSetting(supabase!,userSync.scope,'dashboard',()=>valid()&&!liveOffline.current,ack?.revision);
            items=parseDashboardPreferences(result.record?.items);acknowledged=ack?.id;
          }else if(downloadedItems){void cached.catch(()=>{});items=downloadedItems;acknowledged=ack?.id}
          else items=await cached.catch(error=>{if(!ack)throw error;return parseDashboardPreferences(ack.record?.items)});
        }else{
          items=await readShared(key,()=>readOnlineDashboardPreferences(createDashboardPreferenceTransport(supabase!,userId!,()=>!isOffline()),userId!,current));
        }
        if(valid())publish(key,{...before,items,ack:acknowledged,loading:false,loadFailed:false,saving:before.saving&&(before.writer?.()??false),writer:before.writer,error:before.pending?before.error:''});
      }catch(error){if(valid())publish(key,{...before,loading:false,loadFailed:true,error:error instanceof Error?error.message:'Dashboard preferences could not be loaded.'})}
    })();
    return()=>{active=false};
  },[key,token,remote,userId,attempt,ack?.id,offline,userSync,downloadedItems]);
  async function perform(write:OnlineDashboardWrite){
    const previous=states.get(key)!;
    if(!current()||gate.locked||(previous.saving&&(previous.writer?.()??true)))return;
    gate.locked=true;publish(key,{...previous,pending:write,saving:true,writer:current,error:''});
    try{
      const items=await write.run(current);
      if(current()&&states.get(key)?.pending===write&&states.get(key)?.writer===current)publish(key,{items,ack:ack?.id,loading:false,saving:false,error:''});
    }catch(error){if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,error:onlineDashboardWriteError(error,write.acknowledged)})}
    finally{gate.locked=false;if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,writer:undefined})}
  }
  async function save(id:DashboardItem,enabled:boolean){
    if(!current()||gate.locked)return;
    const previous=states.get(key)!;
    if(previous.pending||(previous.saving&&(previous.writer?.()??true)))return;
    if(!queueRequired&&(previous.loading||previous.loadFailed))return;
    if(remote&&!queueRequired){
      try{
        const write=createOnlineDashboardWrite({userId:userId!,id:createFleetId,transport:createDashboardPreferenceTransport(supabase!,userId!,()=>!isOffline()),connectivity:()=>isOffline()?'offline':'online'},{[id]:enabled});
        await perform(write);
      }catch{if(current())publish(key,{...states.get(key)!,error:'Dashboard request could not be prepared. Please retry.'})}
      return;
    }
    gate.locked=true;publish(key,{...previous,saving:true,writer:current,error:''});
    try{
      if(queueRequired){
        if(!userSync)throw new Error('Device saving is unavailable. Wait for account storage or retry.');
        await userSync.setDashboard({[id]:enabled});
      }else{
        if(!demoMode)throw new Error('Dashboard saving is unavailable. Verify your account and connection.');
        const items={...previous.items,[id]:enabled};
        if(current())publish(key,{items,loading:false,saving:false,error:''});
      }
    }catch(error){
      if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,error:error instanceof Error?error.message:'Dashboard preferences could not be saved. Please try again.'});
    }finally{
      gate.locked=false;
      if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,writer:undefined});
    }
  }
  function reload(){if(current()&&!states.get(key)?.pending){publish(key,{...states.get(key)!,loading:true,loadFailed:false,error:''});setAttempt(value=>value+1)}}
  async function retry(){if(current()){const write=states.get(key)?.pending;if(write)await perform(write)}}
  return {...state,reload,retry,visible:(id:DashboardItem)=>state.items[id]!==false,save};
}
