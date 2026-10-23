import type {OutboxEntry} from './offline-outbox';

// Verified download of the caller's own tasks/settings (server:
// get_user_sync_snapshot). Displayed as: snapshot, then this device's receipts
// newer than its watermark, then pending commands. Never an HTTP read cache.
export type UserSnapshotTask={id:string;subject:string;description:string;dueDate:string};
export type UserSnapshot={
  schemaVersion:1;companyId:string;userId:string;serverRequestAt:string;receiptWatermark:string;
  /** null: the current role cannot read tasks (not "no tasks"). */
  tasks:UserSnapshotTask[]|null;
  availability:boolean|null;
  dashboard:Record<string,boolean>;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid user snapshot');return value as Record<string,unknown>};
const keys=(value:Record<string,unknown>,expected:string[])=>{if(Object.keys(value).sort().join()!==[...expected].sort().join())throw new Error('Invalid user snapshot shape')};

export function decodeUserSnapshot(value:unknown,scope:{userId:string;companyId:string}):UserSnapshot{
  const data=object(value);keys(data,['schemaVersion','companyId','userId','serverRequestAt','receiptWatermark','tasks','availability','dashboard']);
  if(data.schemaVersion!==1||data.companyId!==scope.companyId||data.userId!==scope.userId)throw new Error('User snapshot account or company changed');
  if(typeof data.serverRequestAt!=='string'||!Number.isFinite(Date.parse(data.serverRequestAt)))throw new Error('Invalid user snapshot time');
  if(typeof data.receiptWatermark!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(data.receiptWatermark))throw new Error('Invalid user snapshot watermark');
  if(data.availability!==null&&typeof data.availability!=='boolean')throw new Error('Invalid user snapshot availability');
  const dashboard=object(data.dashboard);
  if(Object.keys(dashboard).length>100||Object.entries(dashboard).some(([key,item])=>!key||key.length>100||typeof item!=='boolean'))throw new Error('Invalid user snapshot layout');
  let tasks:UserSnapshotTask[]|null=null;
  if(data.tasks!==null){
    if(!Array.isArray(data.tasks)||data.tasks.length>1000)throw new Error('Invalid user snapshot tasks');
    const seen=new Set<string>();
    tasks=data.tasks.map(raw=>{
      const task=object(raw);keys(task,['id','subject','description','dueDate']);
      if(typeof task.id!=='string'||!uuid.test(task.id)||seen.has(task.id)||typeof task.subject!=='string'||typeof task.description!=='string'||typeof task.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))throw new Error('Invalid user snapshot task');
      seen.add(task.id);return {id:task.id,subject:task.subject,description:task.description,dueDate:task.dueDate};
    });
  }
  return {schemaVersion:1,companyId:scope.companyId,userId:scope.userId,serverRequestAt:data.serverRequestAt,receiptWatermark:data.receiptWatermark,tasks,availability:data.availability as boolean|null,dashboard:{...dashboard} as Record<string,boolean>};
}

/** A stored snapshot is replaced only by one that is not older in server time or receipts. */
export function newerUserSnapshot(saved:UserSnapshot|null,next:UserSnapshot){
  return !saved||(Date.parse(next.serverRequestAt)>=Date.parse(saved.serverRequestAt)&&BigInt(next.receiptWatermark)>=BigInt(saved.receiptWatermark));
}

/** This device's applied user commands the snapshot does not include yet (receipt revision above its watermark). */
export function receiptsAfter(entries:readonly OutboxEntry[],snapshot:Pick<UserSnapshot,'receiptWatermark'>){
  const watermark=BigInt(snapshot.receiptWatermark);
  return entries.filter(entry=>entry.status==='synced'&&entry.receipt?.kind==='applied'&&/^\d+$/.test(entry.receipt.revision)&&BigInt(entry.receipt.revision)>watermark)
    .sort((a,b)=>{const left=BigInt((a.receipt as {revision:string}).revision),right=BigInt((b.receipt as {revision:string}).revision);return left<right?-1:left>right?1:a.sequence-b.sequence});
}

export type UserSnapshotState=Readonly<{snapshot:UserSnapshot|null;verifiedAt:string|null;loaded:boolean;refreshing:boolean;error:string}>;
type SnapshotStore={getUserSnapshot():Promise<{snapshot:UserSnapshot;verifiedAt:string}|null>;putUserSnapshot(value:unknown,verifiedAt:string):Promise<{snapshot:UserSnapshot;verifiedAt:string}>};
export function userSnapshotError(error:unknown){
  const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
  if(code==='54000')return 'Too many personal tasks to download for offline use.';
  if(code==='42501')return 'Current access does not allow downloading your data.';
  if(['PGRST202','42883'].includes(code))return 'Offline downloads need a server update.';
  if(code==='SYNC_PAUSED')return '';
  return 'Your tasks and settings could not be downloaded. The last download is kept.';
}
/** Single-flight, account-scoped download of the verified user snapshot into device storage. */
export function createUserSnapshotSync(options:{session:SnapshotStore;download:(signal:AbortSignal)=>Promise<unknown>;canRun:()=>boolean;now?:()=>string;timeoutMs?:number}){
  let state:UserSnapshotState={snapshot:null,verifiedAt:null,loaded:false,refreshing:false,error:''};
  const listeners=new Set<()=>void>();let stopped=false;let flight:Promise<void>|null=null;const abort=new AbortController();
  const publish=(change:Partial<UserSnapshotState>)=>{if(stopped)return;state=Object.freeze({...state,...change});listeners.forEach(listener=>listener())};
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    async load(){try{const saved=await options.session.getUserSnapshot();publish({snapshot:saved?.snapshot??null,verifiedAt:saved?.verifiedAt??null,loaded:true})}catch{publish({loaded:true,error:'Saved tasks and settings could not be read on this device.'})}},
    refresh(){
      if(stopped||!options.canRun())return Promise.resolve();
      flight??=(async()=>{
        publish({refreshing:true});const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??15_000);
        const stop=()=>controller.abort();abort.signal.addEventListener('abort',stop,{once:true});
        try{
          const value=await options.download(controller.signal);if(stopped)return;
          const saved=await options.session.putUserSnapshot(value,(options.now??(()=>new Date().toISOString()))());
          publish({snapshot:saved.snapshot,verifiedAt:saved.verifiedAt,loaded:true,error:''});
        }catch(error){publish({error:userSnapshotError(error)})}
        finally{clearTimeout(timer);abort.signal.removeEventListener('abort',stop);publish({refreshing:false});flight=null}
      })();
      return flight;
    },
    stop(){stopped=true;abort.abort();listeners.clear()},
  };
}
export type UserSnapshotSync=ReturnType<typeof createUserSnapshotSync>;
