import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createAvailabilityController,createAvailabilityTransport,emptyAvailabilityState,onlineAvailabilityError,validAvailabilityScope,type AvailabilityController} from '@fireops/domain';
import {supabase} from './supabase';
import {useUserDataScope} from './useUserDataScope';
import { createId } from './create-id';
const controllers=new Map<string,AvailabilityController>();
const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
function changed(){if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  if([...controllers.values()].some(controller=>!!controller.getSnapshot().pending))window.addEventListener('beforeunload',leaving);else window.removeEventListener('beforeunload',leaving);
}}
const emptySubscribe=()=>()=>{};
const emptySnapshot=()=>emptyAvailabilityState;
const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;
export function useAvailability(companyId?:string|null,actorId?:string|null){
  const key=`${companyId}:${actorId}`;const {token,current}=useUserDataScope(key);
  const controller=useMemo(()=>{
    if(!supabase||!validAvailabilityScope(companyId,actorId))return null;
    let value=controllers.get(key);if(!value){value=createAvailabilityController({scope:{companyId:companyId!,actorId:actorId!},id:()=>createId(),transport:createAvailabilityTransport(supabase,actorId!,online),connectivity:()=>typeof navigator==='undefined'||typeof navigator.onLine!=='boolean'?'unknown':online()?'online':'offline',changed});controllers.set(key,value)}return value;
  },[key]);
  const state=useSyncExternalStore(controller?.subscribe??emptySubscribe,controller?.getSnapshot??emptySnapshot,emptySnapshot);
  const busy=state.busy&&(state.owner?.()??false);
  useEffect(()=>{
    if(!controller||!supabase)return;
    let active=true;const valid=()=>active&&current();void controller.load(valid);
    const channel=supabase.channel(`availability:${key}:${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table:'crew_availability',filter:`company_id=eq.${companyId}`},()=>void controller.load(valid)).subscribe();
    return()=>{active=false;void supabase!.removeChannel(channel)};
  },[token,controller]);
  async function save(userId:string,available:boolean){
    if(!current()||!controller)return false;
    try{return await controller.save(userId,available,current)}catch{return false}
  }
  async function retry(){if(current()&&controller)await controller.retry(current)}
  return {statuses:state.statuses,verified:state.verified,loading:state.loading,busy,pending:state.pending,note:state.note,error:state.error||(!busy&&state.pending?onlineAvailabilityError(undefined,state.pending.acknowledged):''),save,retry,canSave:(userId:string)=>current()&&validAvailabilityScope(companyId,userId)&&!!controller&&state.verified&&!state.loading&&!busy&&!state.pending};
}
