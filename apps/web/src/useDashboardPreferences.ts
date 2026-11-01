import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {createDashboardPreferenceTransport,createOnlineDashboardWrite,decodeDashboardPreferenceChanges,onlineDashboardWriteError,readOnlineDashboardPreferences,type DashboardItem,type DashboardPreferences,type OnlineDashboardWrite} from '@fireops/domain';
import {supabase} from './supabase';
import {useUserDataScope} from './useUserDataScope';
import { createId } from './create-id';

type State={items:DashboardPreferences;loading:boolean;saving:boolean;error:string;loadFailed?:boolean;pending?:OnlineDashboardWrite;writer?:()=>boolean};
const states=new Map<string,State>();
const listeners=new Set<()=>void>();
// Several components use this hook at once; they share one request while it is in flight.
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
const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;
export function useDashboardPreferences(userId:string|undefined,demoMode=false){
  const [attempt,setAttempt]=useState(0);
  const key=`${demoMode?'demo':'user'}:${userId??''}`;
  const {token,current}=useUserDataScope(key);const gate=useMemo(()=>({locked:false}),[token]);
  const remote=!!supabase&&!!userId&&validId(userId)&&!demoMode;
  if(!states.has(key))states.set(key,{items:{},loading:remote,saving:false,error:''});
  const stored=useSyncExternalStore(subscribe,()=>states.get(key)!,()=>states.get(key)!);
  const saving=stored.saving&&(stored.writer?.()??true);
  const state={...stored,saving,retryRequired:!!stored.pending,error:stored.error||(!saving&&stored.pending?onlineDashboardWriteError(undefined,stored.pending.acknowledged):'')};
  useEffect(()=>{
    if(!remote)return;
    let active=true;const before=states.get(key)!;
    const valid=()=>active&&current()&&states.get(key)===before;
    void (async()=>{
      try{
        const items=await readShared(key,()=>readOnlineDashboardPreferences(createDashboardPreferenceTransport(supabase!,userId!,online),userId!,current));
        if(valid())publish(key,{...before,items,loading:false,loadFailed:false,saving:before.saving&&(before.writer?.()??false),error:before.pending?before.error:''});
      }catch(error){if(valid())publish(key,{...before,loading:false,loadFailed:true,error:error instanceof Error?error.message:'Dashboard preferences could not load. Apply required setup and retry.'})}
    })();
    return()=>{active=false};
  },[token,remote,userId,attempt]);
  async function perform(write:OnlineDashboardWrite){
    const previous=states.get(key)!;
    if(!current()||gate.locked||(previous.saving&&(previous.writer?.()??true)))return;
    gate.locked=true;publish(key,{...previous,pending:write,saving:true,writer:current,error:''});
    try{
      const items=await write.run(current);
      if(current()&&states.get(key)?.pending===write&&states.get(key)?.writer===current)publish(key,{items,loading:false,saving:false,error:''});
    }catch(error){if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,error:onlineDashboardWriteError(error,write.acknowledged)})}
    finally{gate.locked=false;if(current()&&states.get(key)?.writer===current)publish(key,{...states.get(key)!,saving:false,writer:undefined})}
  }
  async function save(id:DashboardItem,enabled:boolean){
    if(!current()||gate.locked)return;
    const previous=states.get(key)!;
    if(previous.pending||previous.loading||previous.loadFailed||(previous.saving&&(previous.writer?.()??true)))return;
    if(!remote){
      if(!demoMode){publish(key,{...previous,error:'Dashboard saving is unavailable. Verify your account and connection.'});return}
      publish(key,{items:{...previous.items,...decodeDashboardPreferenceChanges({[id]:enabled})} as DashboardPreferences,loading:false,saving:false,error:''});return;
    }
    try{
      const write=createOnlineDashboardWrite({userId:userId!,id:()=>createId(),transport:createDashboardPreferenceTransport(supabase!,userId!,online),connectivity:()=>typeof navigator==='undefined'||typeof navigator.onLine!=='boolean'?'unknown':online()?'online':'offline'},{[id]:enabled});
      await perform(write);
    }catch{if(current())publish(key,{...states.get(key)!,error:'Dashboard request could not be prepared. Please retry.'})}
  }
  function reload(){if(current()&&!states.get(key)?.pending){publish(key,{...states.get(key)!,loading:true,loadFailed:false,error:''});setAttempt(value=>value+1)}}
  async function retry(){if(current()){const write=states.get(key)?.pending;if(write)await perform(write)}}
  return {...state,reload,retry,visible:(id:DashboardItem)=>state.items[id]!==false,save};
}
