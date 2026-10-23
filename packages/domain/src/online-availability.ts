import {createSyncPatch,type SyncConnectivity,type SyncRecord} from './offline-sync';
import {createAccountRpcTransport,createOnlineWrite,readOnlineValue,type AccountRpcClient,type AccountRpcTransport} from './online-write';
export type AvailabilityScope=Readonly<{actorId:string;companyId:string}>;
export type AvailabilitySnapshot=Readonly<{actorId:string;companyId:string;statuses:Readonly<Record<string,boolean>>}>;
export type OnlineAvailabilityRequest=Readonly<AvailabilityScope&{schemaVersion:1;requestId:string;userId:string;available:boolean;base:boolean|null;savedAt:string;connectivity:SyncConnectivity}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid availability response.');return value as Record<string,unknown>}
export function validAvailabilityScope(companyId?:string|null,actorId?:string|null){return !!companyId&&!!actorId&&uuid.test(companyId)&&uuid.test(actorId)}
export function decodeAvailabilityStatuses(value:unknown):Readonly<Record<string,boolean>>{
  const data=object(value);createSyncPatch({},data as SyncRecord);
  if(Object.entries(data).some(([key,value])=>!uuid.test(key)||typeof value!=='boolean'))throw new Error('Invalid availability statuses.');
  return Object.freeze({...data}) as Readonly<Record<string,boolean>>;
}
function snapshot(value:unknown,scope:AvailabilityScope):AvailabilitySnapshot{
  const data=object(value);if(data.actorId!==scope.actorId||data.companyId!==scope.companyId)throw new Error('Availability account or company changed.');
  return Object.freeze({...scope,statuses:decodeAvailabilityStatuses(data.statuses)});
}
export function createAvailabilityTransport(client:AccountRpcClient,actorId:string,online:()=>boolean=()=>true){return createAccountRpcTransport(client,actorId,online)}
export function readOnlineAvailability(transport:AccountRpcTransport,scope:AvailabilityScope,current:()=>boolean){
  return readOnlineValue('Availability',current,async signal=>snapshot(await transport.invoke('get_crew_availability',{target_company_id:scope.companyId},signal,current),scope));
}
export function createOnlineAvailabilityWrite(options:{scope:AvailabilityScope;id:()=>string;transport:AccountRpcTransport;now?:()=>string;connectivity?:()=>SyncConnectivity;timeoutMs?:number},choice:{userId:string;available:boolean;base:boolean|null}){
  const request:OnlineAvailabilityRequest=Object.freeze({...options.scope,schemaVersion:1,requestId:options.id(),userId:choice.userId,available:choice.available,base:choice.base,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.connectivity?.()??'unknown'});
  if(!validAvailabilityScope(request.companyId,request.actorId)||!uuid.test(request.requestId)||!uuid.test(request.userId)||typeof request.available!=='boolean'||(request.base!==null&&typeof request.base!=='boolean')||!date(request.savedAt)||!['online','offline','unknown'].includes(request.connectivity))throw new Error('Invalid availability request.');
  const args=Object.freeze({request});let kept=false;
  const write=createOnlineWrite({label:'Availability',timeoutMs:options.timeoutMs,
    send:(signal,current)=>options.transport.invoke('set_crew_availability_once',args,signal,current),
    accept:raw=>{
      const data=object(raw);
      if(data.actorId!==request.actorId||data.companyId!==request.companyId||data.userId!==request.userId||data.requestId!==request.requestId||!date(data.receivedAt)||(data.available!==null&&typeof data.available!=='boolean')||!['applied','kept_current'].includes(String(data.kind)))throw new Error('Invalid availability acknowledgment.');
      kept=data.kind==='kept_current';if(kept?data.available===request.available:data.available!==request.available)throw new Error('Availability acknowledgment contradicts its outcome.');
      return true;
    },
    read:async(_receipt,signal,current)=>({snapshot:snapshot(await options.transport.invoke('get_crew_availability',{target_company_id:request.companyId},signal,current),request),keptCurrent:kept}),
  });
  return {request,run:write.run,get acknowledged(){return write.acknowledged},get keptCurrent(){return write.acknowledged&&kept}};
}
export type OnlineAvailabilityWrite=ReturnType<typeof createOnlineAvailabilityWrite>;
export type AvailabilityState=Readonly<{statuses:Readonly<Record<string,boolean>>;verified:boolean;loading:boolean;busy:boolean;owner:(()=>boolean)|null;pending:OnlineAvailabilityWrite|null;error:string;note:string;writeVersion:number}>;
export const emptyAvailabilityState:AvailabilityState=Object.freeze({statuses:Object.freeze({}),verified:false,loading:false,busy:false,owner:null,pending:null,error:'',note:'',writeVersion:0});
export function onlineAvailabilityError(error:unknown,acknowledged=false){
  if(acknowledged)return 'Outcome recorded on server, but current availability could not refresh. Retry refresh; the write will not repeat.';
  const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
  if(code==='42501')return 'Current permissions cannot confirm this availability change. Original choice is retained; refresh account access before retrying.';
  if(['PGRST202','42883','42P01','PGRST205'].includes(code))return 'Availability needs database setup. Original choice retained in memory; retry after setup.';
  return 'Availability change is unconfirmed. Retry the original choice before closing this page or app.';
}

/** Shared per-actor/company page-memory state. Native own commands stay in SQLite. */
export function createAvailabilityController(options:{scope:AvailabilityScope;id:()=>string;transport:AccountRpcTransport;now?:()=>string;connectivity?:()=>SyncConnectivity;changed?:()=>void}){
  const scope=Object.freeze({...options.scope});let state:AvailabilityState={...emptyAvailabilityState,loading:true};
  const listeners=new Set<()=>void>();let generation=0;let readNumber=0;let lastSuccess=0;let reading=0;let denied=false;
  function publish(change:Partial<AvailabilityState>){state=Object.freeze({...state,...change});options.changed?.();listeners.forEach(fn=>fn())}
  const busy=()=>state.busy&&(state.owner?.()??false);
  async function load(current:()=>boolean){
    if(!current())return false;const number=++readNumber;const version=generation;reading=number;publish({loading:true});
    try{
      const value=await readOnlineAvailability(options.transport,scope,current);
      if(!current()||version!==generation||number<lastSuccess)return false;
      lastSuccess=number;denied=false;publish({statuses:value.statuses,verified:true,error:state.pending?state.error:''});return true;
    }catch(error){
      if(current()&&version===generation){
        const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
        if(['42501','ONLINE_ACCOUNT_CHANGED'].includes(code)){denied=true;generation++;publish({statuses:Object.freeze({}),verified:false,loading:false,error:'Current access does not allow availability reads.'})}
        else publish({verified:false,error:'Availability could not load. Check connection/setup and retry.'});
      }
      return false;
    }finally{if(current()&&reading===number)publish({loading:false})}
  }
  async function perform(write:OnlineAvailabilityWrite,current:()=>boolean){
    if(!current()||busy())return false;generation++;publish({pending:write,busy:true,owner:current,loading:false,error:'',note:''});
    try{
      const value=await write.run(current);
      if(!current()||state.pending!==write||state.owner!==current)return false;
      denied=false;publish({statuses:value.snapshot.statuses,verified:true,pending:null,busy:false,owner:null,error:'',note:value.keptCurrent?'Another change was kept. Review the current status before choosing again.':'',writeVersion:state.writeVersion+1});return true;
    }catch(error){
      if(current()&&state.pending===write&&state.owner===current){
        const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
        if(['42501','ONLINE_ACCOUNT_CHANGED'].includes(code)){denied=true;generation++;publish({statuses:Object.freeze({}),verified:false})}
        publish({busy:false,error:onlineAvailabilityError(error,write.acknowledged)});
      }
      return false;
    }
    finally{if(current()&&state.pending===write&&state.owner===current)publish({busy:false,owner:null})}
  }
  return {
    getSnapshot:()=>state,get accessDenied(){return denied},subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},load,
    async save(userId:string,available:boolean,current:()=>boolean){
      if(!current()||busy()||state.pending||!state.verified)return false;
      try{const write=createOnlineAvailabilityWrite({...options,scope},{userId,available,base:state.statuses[userId]??null});return perform(write,current)}
      catch{publish({error:'Availability request could not be prepared. Please retry.'});return false}
    },
    async retry(current:()=>boolean){return state.pending?perform(state.pending,current):load(current)},
    showCached(statuses:unknown,current:()=>boolean){if(current()&&!denied){const parsed=decodeAvailabilityStatuses(statuses);publish({...(state.verified?{}:{statuses:parsed}),loading:false})}},
    offlineReadFailed(current:()=>boolean){if(current())publish({loading:false,error:state.verified?'':'No downloaded availability roster is available.'})},
  };
}
export type AvailabilityController=ReturnType<typeof createAvailabilityController>;
