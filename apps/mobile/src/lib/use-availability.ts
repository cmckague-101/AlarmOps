import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {createAvailabilityController,createAvailabilityTransport,emptyAvailabilityState,onlineAvailabilityError,validAvailabilityScope,type AvailabilityController} from '@fireops/domain';
import {supabase} from '@/lib/supabase';
import {createFleetId} from './fleet-store';
import {latestUserSetting,pendingAvailability,scopedUserEntries} from './offline-user-sync';
import {receiptsAfter} from './offline-user-snapshot';
import {useUserDataScope} from './user-data-scope';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';
import {isOffline} from '@/providers/network-provider';

const controllers=new Map<string,AvailabilityController>();
const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
function changed(){if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  if([...controllers.values()].some(controller=>!!controller.getSnapshot().pending))window.addEventListener('beforeunload',leaving);else window.removeEventListener('beforeunload',leaving);
}}
const emptySubscribe=()=>()=>{};
const emptySnapshot=()=>emptyAvailabilityState;
type Local={token:object;busy:boolean;error:string;ack?:string};
export function useAvailability(companyId?:string|null,selfId?:string|null){
  const key=`${companyId}:${selfId}`;const {token,current}=useUserDataScope(key);
  const [stored,setStored]=useState<Local>(()=>({token,busy:false,error:''}));const local=stored.token===token?stored:{token,busy:false,error:''};
  const offlineSync=useOptionalOfflineSync();const offline=!!offlineSync?.offline;
  const candidate=offlineSync?.userSync;const userSync=candidate&&candidate.scope.userId===selfId&&candidate.scope.companyId===companyId?candidate:null;
  const queueRequired=!!offlineSync?.available||offline||!!candidate;
  const gate=useMemo(()=>({locked:false,read:0,stamp:'',base:null as boolean|null,failed:undefined as {available:boolean;base:boolean|null}|undefined}),[token]);
  const controller=useMemo(()=>{
    if(!supabase||!validAvailabilityScope(companyId,selfId))return null;
    let value=controllers.get(key);if(!value){value=createAvailabilityController({scope:{companyId:companyId!,actorId:selfId!},id:createFleetId,transport:createAvailabilityTransport(supabase,selfId!,()=>!isOffline()),connectivity:()=>isOffline()?'offline':'online',changed});controllers.set(key,value)}return value;
  },[key]);
  const state=useSyncExternalStore(controller?.subscribe??emptySubscribe,controller?.getSnapshot??emptySnapshot,emptySnapshot);
  const entries=useMemo(()=>companyId&&selfId?scopedUserEntries(offlineSync?.state.entries??[],selfId,companyId):[],[offlineSync?.state.entries,companyId,selfId]);
  const ack=useMemo(()=>companyId&&selfId?latestUserSetting(entries,{companyId,userId:selfId},'availability'):undefined,[entries,companyId,selfId]);
  const ownPending=selfId?pendingAvailability(entries,selfId):undefined;
  const shown={...state.statuses};
  // Offline, own status comes from the verified download plus own receipts newer than it,
  // never from the cached roster; receipts it already covers cannot override later web changes.
  const saved=offlineSync?.userSnapshot?.snapshot;
  const downloaded=offline&&saved&&saved.companyId===companyId&&saved.userId===selfId?saved:null;
  if(selfId&&downloaded){
    const newer=receiptsAfter(entries.filter(entry=>entry.operation.entityType==='availability'&&entry.operation.entityId===selfId),downloaded).at(-1);
    const value=newer?.receipt?.kind==='applied'?newer.receipt.record?.available:downloaded.availability;
    if(typeof value==='boolean')shown[selfId]=value;else delete shown[selfId];
  }
  else if(selfId&&ack&&local.ack!==ack.id){if(typeof ack.record?.available==='boolean')shown[selfId]=ack.record.available;else if(ack.record===null)delete shown[selfId]}
  if(selfId&&ownPending!==undefined)shown[selfId]=ownPending;
  const stamp=JSON.stringify([ack?.id,ownPending,local.ack,selfId?state.statuses[selfId]:undefined,downloaded?.serverRequestAt,downloaded?.receiptWatermark]);
  if(gate.stamp!==stamp){gate.stamp=stamp;gate.base=selfId?shown[selfId]??null:null}
  const busy=local.busy||(state.busy&&(state.owner?.()??false));
  function patch(change:Partial<Local>){if(current())setStored(before=>current()?{...(before.token===token?before:{token,busy:false,error:''}),...change}:before)}
  useEffect(()=>{
    if(!controller||!supabase)return;
    let active=true;const valid=()=>active&&current();
    async function load(){
      if(!valid())return;const number=++gate.read;
      // Preserve the old account-bound GET read cache for offline native display,
      // never as a verified base for online crew edits.
      const cached=Promise.resolve(supabase!.from('crew_availability').select('user_id,available').eq('company_id',companyId!)).then(({data,error})=>{if(error)throw error;return Object.fromEntries((data??[]).map(row=>[row.user_id,row.available]))});
      if(offline){try{const statuses=await cached;if(valid()&&number===gate.read)controller!.showCached(statuses,valid)}catch{if(valid()&&number===gate.read)controller!.offlineReadFailed(valid)}}
      else{void cached.catch(()=>{});if(await controller!.load(valid)&&valid()&&number===gate.read)patch({ack:ack?.id})}
    }
    void load();
    const channel=supabase.channel(`availability:${key}:${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table:'crew_availability',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();
    return()=>{active=false;void supabase!.removeChannel(channel)};
  },[token,controller,offline,ack?.id,state.writeVersion]);
  async function save(userId:string,available:boolean){
    if(!current()||gate.locked||!companyId||state.pending||busy)return false;
    if(userId===selfId&&queueRequired){
      gate.locked=true;patch({busy:true,error:''});
      try{
        if(!userSync||controller?.accessDenied)throw new Error('Device saving or current availability access is unavailable. Refresh access and retry.');
        if(gate.failed&&gate.failed.available!==available)throw new Error(`Retry the unconfirmed ${gate.failed.available?'Available':'Unavailable'} selection before changing it.`);
        const request=gate.failed??{available,base:gate.base};gate.failed=request;await userSync.setAvailability(request.available,request.base);gate.failed=undefined;gate.base=available;return current();
      }catch(error){patch({error:error instanceof Error?error.message:'Availability could not be saved on this device.'});return false}
      finally{gate.locked=false;patch({busy:false})}
    }
    if(gate.failed){patch({error:'Retry your unconfirmed own selection before changing another status.'});return false}
    if(offline){patch({error:'Changing someone else’s availability requires a connection.'});return false}
    if(!controller)return false;
    patch({error:''});return controller.save(userId,available,current);
  }
  async function retry(){
    if(!current())return;
    patch({error:''});
    if(controller?.getSnapshot().pending){if(await controller.retry(current)&&current())patch({ack:ack?.id});return}
    if(gate.failed&&selfId){await save(selfId,gate.failed.available);return}
    if(offline&&controller){controller.offlineReadFailed(current);return}
    if(controller&&await controller.retry(current)&&current())patch({ack:ack?.id});
  }
  const canSave=(userId:string)=>current()&&!busy&&!state.loading&&!state.pending&&(userId===selfId&&queueRequired?!!userSync&&!controller?.accessDenied:!offline&&state.verified&&!gate.failed);
  return {statuses:shown,verified:state.verified,ownPending,ownDownloadedAt:downloaded?.serverRequestAt??null,loading:state.loading,busy,error:local.error||state.error||(!busy&&state.pending?onlineAvailabilityError(undefined,state.pending.acknowledged):''),note:state.note,pending:state.pending,save,retry,canSave};
}
