import {dashboardItems,parseDashboardPreferences,type DashboardItem,type DashboardPreferences} from './dashboard-preferences';
import {createSyncPatch,type SyncConnectivity,type SyncRecord} from './offline-sync';

export type DashboardPreferenceChanges=Readonly<Partial<Record<DashboardItem,boolean|null>>>;
export type OnlineDashboardRequest=Readonly<{schemaVersion:1;requestId:string;userId:string;changes:DashboardPreferenceChanges;savedAt:string;connectivity:SyncConnectivity}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid dashboard response.');return value as Record<string,unknown>}
export function decodeDashboardPreferenceChanges(value:unknown):DashboardPreferenceChanges{
  const source=object(value);createSyncPatch({},source as SyncRecord);const keys=Object.keys(source);
  if(!keys.length||keys.length>dashboardItems.length||keys.some(key=>!dashboardItems.includes(key as DashboardItem)||(source[key]!==null&&typeof source[key]!=='boolean')))throw new Error('Invalid dashboard changes.');
  return Object.freeze({...source}) as DashboardPreferenceChanges;
}
function snapshot(value:unknown,userId:string):{raw:Record<string,unknown>;items:DashboardPreferences}{
  const data=object(value);if(data.userId!==userId)throw new Error('Dashboard account changed.');
  const raw=object(data.items);createSyncPatch({},raw as SyncRecord);return {raw,items:parseDashboardPreferences(raw)};
}
function acknowledgment(value:unknown,request:OnlineDashboardRequest){
  const data=object(value);const {raw}=snapshot(value,request.userId);
  if(data.kind!=='applied'||data.requestId!==request.requestId||!date(data.receivedAt))throw new Error('Invalid dashboard acknowledgment.');
  for(const [key,expected] of Object.entries(request.changes))if(expected===null?Object.prototype.hasOwnProperty.call(raw,key):raw[key]!==expected)throw new Error('Dashboard acknowledgment omitted the saved choice.');
}
export type DashboardPreferenceTransport={invoke(name:'set_dashboard_preferences_once'|'get_dashboard_preferences',args:Record<string,unknown>,signal:AbortSignal,current:()=>boolean):Promise<unknown>};
type RpcClient={auth:{getSession():PromiseLike<{data:{session:{user:{id:string};access_token:string}|null};error:unknown}>};rpc(name:string,args:Record<string,unknown>):{setHeader(key:string,value:string):{abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>}}};
/** Each POST binds the expected account's JWT; SDK replacement cannot retarget it. */
export function createDashboardPreferenceTransport(client:RpcClient,userId:string,online:()=>boolean=()=>true):DashboardPreferenceTransport{
  return {async invoke(name,args,signal,current){
    const guard=()=>{if(!current()||signal.aborted)throw new Error('Dashboard account changed.');if(!online())throw new Error('A connection is required. This choice remains only on this page.');};
    guard();const {data,error}=await client.auth.getSession();guard();
    if(error||!data.session||data.session.user.id!==userId)throw new Error('Verify the current dashboard account before retrying.');
    const result=await client.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal);
    if(!current()||signal.aborted)throw new Error('Dashboard account changed.');
    if(result.error)throw result.error;return result.data;
  }};
}

export async function readOnlineDashboardPreferences(transport:DashboardPreferenceTransport,userId:string,current:()=>boolean){
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([
    transport.invoke('get_dashboard_preferences',{},abort.signal,current).then(value=>{if(!current()||abort.signal.aborted)throw new Error('Dashboard account changed.');return snapshot(value,userId).items}),
    new Promise<never>((_yes,no)=>{timer=setTimeout(()=>{abort.abort();no(new Error('Dashboard refresh timed out.'))},15_000)}),
  ])}finally{if(timer)clearTimeout(timer);abort.abort()}
}

/** Memory-only online request. Explicit retry only; no storage or reconnect replay. */
export function createOnlineDashboardWrite(options:{userId:string;id:()=>string;transport:DashboardPreferenceTransport;now?:()=>string;connectivity?:()=>SyncConnectivity;timeoutMs?:number},changes:unknown){
  const patch=decodeDashboardPreferenceChanges(changes);
  const request:OnlineDashboardRequest=Object.freeze({schemaVersion:1,userId:options.userId,requestId:options.id(),changes:patch,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.connectivity?.()??'unknown'});
  if(!uuid.test(request.userId)||!uuid.test(request.requestId)||!date(request.savedAt)||!['online','offline','unknown'].includes(request.connectivity))throw new Error('Invalid dashboard request identity or provenance.');
  const requestArgs=Object.freeze({request});
  let delivered=false;
  let flight:{current:()=>boolean;abort:AbortController;promise:Promise<DashboardPreferences>}|undefined;
  function run(current:()=>boolean):Promise<DashboardPreferences>{
    if(!current())return Promise.reject(new Error('Dashboard account changed.'));
    if(flight?.current())return flight.promise;
    flight?.abort.abort();
    const abort=new AbortController();let timedOut=false;let timer:ReturnType<typeof setTimeout>|undefined;let cancel:()=>void=()=>{};
    const attempt={current,abort,promise:undefined as unknown as Promise<DashboardPreferences>};flight=attempt;
    const guard=()=>{if(!current()||abort.signal.aborted)throw new Error('Dashboard account changed.');};
    attempt.promise=(async()=>{
      try{
        return await Promise.race([
          (async()=>{
            guard();
            if(!delivered){const result=await options.transport.invoke('set_dashboard_preferences_once',requestArgs,abort.signal,current);guard();acknowledgment(result,request);delivered=true;}
            const result=await options.transport.invoke('get_dashboard_preferences',{},abort.signal,current);guard();return snapshot(result,request.userId).items;
          })(),
          new Promise<never>((_yes,no)=>{cancel=()=>no(new Error(timedOut?'Dashboard request timed out. Retry the original choice.':'Dashboard account changed.'));abort.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{timedOut=true;abort.abort()},options.timeoutMs??15_000)}),
        ]);
      }finally{if(timer)clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);abort.abort();if(flight===attempt)flight=undefined}
    })();
    return attempt.promise;
  }
  return {request,run,get acknowledged(){return delivered}};
}
export type OnlineDashboardWrite=ReturnType<typeof createOnlineDashboardWrite>;
export function onlineDashboardWriteError(error:unknown,acknowledged=false){
  if(acknowledged)return 'Saved on server, but current layout could not refresh. Retry refresh; the write will not repeat.';
  const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
  if(['PGRST202','42883','42P01','PGRST205'].includes(code))return 'Dashboard saving needs database setup. Original choice retained on this page; retry after setup.';
  return 'Dashboard save is unconfirmed. Retry the original choice before leaving this page.';
}
