import {useEffect, useState, useSyncExternalStore} from 'react';
import {parseDashboardPreferences, type DashboardItem, type DashboardPreferences} from '@fireops/domain';
import {supabase} from './supabase';

type State={items:DashboardPreferences;loading:boolean;saving:boolean;error:string;loadFailed?:boolean};
const states=new Map<string,State>();
const listeners=new Set<()=>void>();
function publish(key:string,state:State){states.set(key,state);listeners.forEach(listener=>listener())}
function subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
export function useDashboardPreferences(userId:string|undefined,demoMode=false){
  const [attempt,setAttempt]=useState(0);
  const key=`${demoMode?'demo':'user'}:${userId??''}`;
  const remote=!!supabase&&!!userId&&validId(userId)&&!demoMode;
  if(!states.has(key))states.set(key,{items:{},loading:remote,saving:false,error:''});
  const state=useSyncExternalStore(subscribe,()=>states.get(key)!,()=>states.get(key)!);
  useEffect(()=>{
    if(!remote)return;
    let active=true;
    const before=states.get(key)!;
    void (async()=>{
      try{
        const {data,error}=await supabase!.from('dashboard_preferences').select('items').eq('user_id',userId!).maybeSingle();
        if(error)throw error;
        if(active&&states.get(key)===before)publish(key,{items:parseDashboardPreferences(data?.items),loading:false,saving:false,error:''});
      }catch(error){if(active&&states.get(key)===before)publish(key,{...states.get(key)!,loading:false,loadFailed:true,error:error instanceof Error?error.message:'Dashboard preferences could not be loaded.'})}
    })();
    return()=>{active=false};
  },[key,remote,userId,attempt]);
  async function save(id:DashboardItem,enabled:boolean){
    const previous=states.get(key)!;
    if(previous.saving||previous.loading||previous.loadFailed)return;
    const items={...previous.items,[id]:enabled};
    publish(key,{...previous,saving:true,error:''});
    try{
      if(remote){const {error}=await supabase!.from('dashboard_preferences').upsert({user_id:userId,items});if(error)throw error}
      publish(key,{items,loading:false,saving:false,error:''});
    }catch(error){publish(key,{...previous,saving:false,error:error instanceof Error?error.message:'Dashboard preferences could not be saved. Please try again.'})}
  }
  function reload(){publish(key,{...states.get(key)!,loading:true,loadFailed:false,error:''});setAttempt(value=>value+1)}
  return {...state,reload,visible:(id:DashboardItem)=>state.items[id]!==false,save};
}
