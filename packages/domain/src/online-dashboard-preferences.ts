import {dashboardItems,parseDashboardPreferences,type DashboardItem,type DashboardPreferences} from './dashboard-preferences';
import {createSyncPatch,type SyncConnectivity,type SyncRecord} from './offline-sync';
import {createAccountRpcTransport,createOnlineWrite,readOnlineValue,type AccountRpcClient} from './online-write';

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
/** Each POST binds the expected account's JWT; SDK replacement cannot retarget it. */
export function createDashboardPreferenceTransport(client:AccountRpcClient,userId:string,online:()=>boolean=()=>true):DashboardPreferenceTransport{
  return createAccountRpcTransport(client,userId,online);
}
export function readOnlineDashboardPreferences(transport:DashboardPreferenceTransport,userId:string,current:()=>boolean){
  return readOnlineValue('Dashboard',current,async signal=>snapshot(await transport.invoke('get_dashboard_preferences',{},signal,current),userId).items);
}

/** Memory-only online request. Explicit retry only; no storage or reconnect replay. */
export function createOnlineDashboardWrite(options:{userId:string;id:()=>string;transport:DashboardPreferenceTransport;now?:()=>string;connectivity?:()=>SyncConnectivity;timeoutMs?:number},changes:unknown){
  const patch=decodeDashboardPreferenceChanges(changes);
  const request:OnlineDashboardRequest=Object.freeze({schemaVersion:1,userId:options.userId,requestId:options.id(),changes:patch,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.connectivity?.()??'unknown'});
  if(!uuid.test(request.userId)||!uuid.test(request.requestId)||!date(request.savedAt)||!['online','offline','unknown'].includes(request.connectivity))throw new Error('Invalid dashboard request identity or provenance.');
  const requestArgs=Object.freeze({request});
  const write=createOnlineWrite({label:'Dashboard',timeoutMs:options.timeoutMs,
    send:(signal,current)=>options.transport.invoke('set_dashboard_preferences_once',requestArgs,signal,current),
    accept:raw=>{acknowledgment(raw,request);return true},
    read:async(_receipt,signal,current)=>snapshot(await options.transport.invoke('get_dashboard_preferences',{},signal,current),request.userId).items,
  });
  return {request,run:write.run,get acknowledged(){return write.acknowledged}};
}
export type OnlineDashboardWrite=ReturnType<typeof createOnlineDashboardWrite>;
export function onlineDashboardWriteError(error:unknown,acknowledged=false){
  if(acknowledged)return 'Saved on server, but current layout could not refresh. Retry refresh; the write will not repeat.';
  const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
  if(['PGRST202','42883','42P01','PGRST205'].includes(code))return 'Dashboard saving needs database setup. Original choice retained on this page; retry after setup.';
  return 'Dashboard save is unconfirmed. Retry the original choice before leaving this page.';
}
