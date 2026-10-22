import {useEffect, useMemo, useRef, useState} from 'react';
import {supabase} from '@/lib/supabase';
import {latestUserSetting, pendingAvailability, scopedUserEntries} from './offline-user-sync';
import {readUserSetting} from './read-user-setting';
import {useUserDataScope} from './user-data-scope';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

type State={token:object;statuses:Record<string,boolean>;loading:boolean;error:string;busy:boolean;ack?:string};
export function useAvailability(companyId?:string|null,selfId?:string|null) {
  const {token,current}=useUserDataScope(`${companyId}:${selfId}`);
  const empty=():State=>({token,statuses:{},loading:!!companyId,error:'',busy:false});
  const [stored,setStored]=useState<State>(empty);const state=stored.token===token?stored:empty();
  const [revision,setRevision]=useState(0);
  const gate=useMemo(()=>({locked:false,load:0,write:0,stamp:'',base:null as boolean|null,failed:undefined as {available:boolean;base:boolean|null}|undefined}),[token]);
  const offlineSync=useOptionalOfflineSync();const offline=!!offlineSync?.offline;
  const liveOffline=useRef(offline);liveOffline.current=offline;
  const candidate=offlineSync?.userSync;
  const userSync=candidate&&candidate.scope.userId===selfId&&candidate.scope.companyId===companyId?candidate:null;
  const queueRequired=!!offlineSync?.available||offline||!!candidate;
  const entries=useMemo(()=>companyId&&selfId?scopedUserEntries(offlineSync?.state.entries??[],selfId,companyId):[],[offlineSync?.state.entries,companyId,selfId]);
  const ack=useMemo(()=>companyId&&selfId?latestUserSetting(entries,{companyId,userId:selfId},'availability'):undefined,[entries,companyId,selfId]);
  const ownPending=selfId?pendingAvailability(entries,selfId):undefined;
  const shown={...state.statuses};
  if(selfId&&ack&&state.ack!==ack.id){
    if(typeof ack.record?.available==='boolean')shown[selfId]=ack.record.available;
    else if(ack.record===null)delete shown[selfId];
  }
  if(selfId&&ownPending!==undefined)shown[selfId]=ownPending;
  const stamp=JSON.stringify([ack?.id,ownPending,state.ack,selfId?state.statuses[selfId]:undefined]);
  if(gate.stamp!==stamp){gate.stamp=stamp;gate.base=selfId?shown[selfId]??null:null}
  function patch(change:Partial<State>|((before:State)=>Partial<State>)){
    if(current())setStored(before=>{if(!current())return before;const base=before.token===token?before:empty();return {...base,...(typeof change==='function'?change(base):change)}});
  }
  useEffect(()=>{
    let active=true;const client=supabase;
    if(!companyId||!client){patch({loading:false});return}
    async function load(){
      if(!active||!current())return;
      const turn=++gate.load;const write=gate.write;
      const valid=()=>active&&current()&&turn===gate.load&&write===gate.write;
      patch({loading:true,error:''});
      try{
        const {data,error}=await client!.from('crew_availability').select('user_id,available').eq('company_id',companyId!);
        if(error)throw error;
        const statuses:Record<string,boolean>=Object.fromEntries((data??[]).map(row=>[row.user_id,row.available]));
        if(!valid())return;
        patch({statuses,ack:undefined});
        if(userSync&&!liveOffline.current&&selfId){
          const result=await readUserSetting(client!,userSync.scope,'availability',()=>valid()&&!liveOffline.current,ack?.revision);
          if(!valid())return;
          const confirmed={...statuses};
          if(typeof result.record?.available==='boolean')confirmed[selfId]=result.record.available;
          else if(result.record===null)delete confirmed[selfId];
          patch({statuses:confirmed,ack:ack?.id});
        }
      }catch(failure){if(valid())patch({error:`Availability could not load. ${(failure as {message?:string}).message??'Try again.'}`})}
      finally{if(valid())patch({loading:false})}
    }
    void load();
    const channel=client.channel(`availability:${companyId}:${selfId}:${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table:'crew_availability',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();
    return()=>{active=false;void client.removeChannel(channel)};
  },[token,revision,ack?.id,offline,userSync]);
  async function save(userId:string,available:boolean){
    if(!current()||gate.locked||!companyId)return;
    gate.locked=true;gate.write++;patch({busy:true,error:''});
    try{
      if(userId===selfId&&queueRequired){
        if(!userSync)throw new Error('Device saving is unavailable. Wait for account storage or retry.');
        if(gate.failed&&gate.failed.available!==available)throw new Error(`Retry the unconfirmed ${gate.failed.available?'Available':'Unavailable'} selection before changing it.`);
        const request=gate.failed??{available,base:gate.base};
        gate.failed=request;
        await userSync.setAvailability(request.available,request.base);
        gate.failed=undefined;gate.base=available;
      }else{
        if(offline)throw new Error('Changing someone else’s availability requires a connection.');
        if(!supabase||!selfId)throw new Error('Availability saving is unavailable.');
        const {data,error}=await supabase.auth.getSession();
        if(error||data.session?.user.id!==selfId||!current())throw new Error('Availability account changed.');
        const result=await supabase.from('crew_availability').upsert({company_id:companyId,user_id:userId,available,updated_at:new Date().toISOString()},{onConflict:'company_id,user_id'})
          .setHeader('Authorization',`Bearer ${data.session.access_token}`);
        if(result.error)throw result.error;
        patch(before=>({statuses:{...before.statuses,[userId]:available},loading:false}));
      }
    }catch(failure){patch({error:`Availability could not be saved. ${(failure as {message?:string}).message??'Try again.'}`})}
    finally{gate.locked=false;patch({busy:false,loading:false})}
  }
  return {statuses:shown,loading:state.loading,error:state.error,busy:state.busy,save,retry:()=>{if(current())setRevision(value=>value+1)}};
}
