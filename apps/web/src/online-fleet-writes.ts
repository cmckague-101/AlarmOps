import type {SupabaseClient} from '@supabase/supabase-js';
import type {FleetSnapshot} from '@fireops/domain';

type Collection=keyof FleetSnapshot;
type RecordId={id:string};
export type OnlineFleetChange={readonly collection:Collection;readonly event:'insert'|'update'|'delete';readonly recordId:string;readonly data?:unknown;readonly expectedVersion?:number};
export type OnlineFleetResult={collection:Collection;event:'insert'|'update'|'delete';recordId:string;version:number};
export type PreparedFleetWrite={readonly operationId:string;readonly companyId:string;readonly userId:string;readonly changes:readonly OnlineFleetChange[];readonly before:FleetSnapshot;readonly after:FleetSnapshot};
export const fleetCollections:Collection[]=['vehicles','issues','crew','activities'];
const empty=():FleetSnapshot=>({vehicles:[],issues:[],crew:[],activities:[]});
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]));
  return value;
}
export const fleetRecordsEqual=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
const stale=()=>new Error('Record changed by another user or this view is stale. Reopen the editor before saving; your entered values have not been submitted.');

/** Online-only read provenance and immutable batches. Never substitute a mutable latest revision map. */
export function createOnlineFleetWrites(options:{companyId:string;userId:string;wire:(snapshot:FleetSnapshot)=>FleetSnapshot;id:()=>string}){
  const scope={companyId:options.companyId,userId:options.userId};
  const reads=new WeakMap<object,{collection:Collection;id:string;version:number;value:unknown}>();
  const pending=new WeakMap<FleetSnapshot,{base:FleetSnapshot;request:PreparedFleetWrite}>();
  const owners=new WeakMap<PreparedFleetWrite,{after:FleetSnapshot}>();
  function wireRecord(collection:Collection,record:RecordId){const shell=empty();(shell[collection] as RecordId[]).push(record);return json(options.wire(shell)[collection][0])}
  return {
    issue<T extends RecordId>(collection:Collection,record:T,version:number):T{
      if(!Number.isSafeInteger(version)||version<1)throw stale();
      reads.set(record,{collection,id:record.id,version,value:wireRecord(collection,record)});return record;
    },
    prepare(after:FleetSnapshot,before:FleetSnapshot):PreparedFleetWrite{
      const previous=pending.get(after);
      if(previous){if(previous.base!==before)throw new Error('A pending save cannot be reused with a different base.');return previous.request}
      const base=json(options.wire(before));const next=json(options.wire(after));const changes:OnlineFleetChange[]=[];
      for(const collection of fleetCollections){
        const originals=new Map((before[collection] as RecordId[]).map(record=>[record.id,record]));
        const old=new Map((base[collection] as RecordId[]).map(record=>[record.id,record]));
        const current=new Map((next[collection] as RecordId[]).map(record=>[record.id,record]));
        const views=new Map((after[collection] as RecordId[]).map(record=>[record.id,record]));
        for(const [id,record] of current){
          const confirmed=reads.get(views.get(id)!);
          // Separate privileged RPCs can return already-persisted records while another action renders.
          if(confirmed&&confirmed.collection===collection&&confirmed.id===id&&fleetRecordsEqual(confirmed.value,record))continue;
          const initial=old.get(id);if(initial&&fleetRecordsEqual(initial,record))continue;
          if(!initial){changes.push({collection,event:'insert',recordId:id,data:record});continue}
          const captured=reads.get(originals.get(id)!);
          if(!captured||captured.collection!==collection||captured.id!==id||!fleetRecordsEqual(captured.value,initial))throw stale();
          changes.push({collection,event:'update',recordId:id,data:record,expectedVersion:captured.version});
        }
        for(const [id,record] of old){
          if(current.has(id))continue;const captured=reads.get(originals.get(id)!);
          if(!captured||captured.collection!==collection||captured.id!==id||!fleetRecordsEqual(captured.value,record))throw stale();
          changes.push({collection,event:'delete',recordId:id,expectedVersion:captured.version});
        }
      }
      const request=freeze({...scope,operationId:options.id(),changes,before:base,after:next});
      pending.set(after,{base:before,request});owners.set(request,{after});return request;
    },
    acknowledge(request:PreparedFleetWrite,value:unknown):OnlineFleetResult[]{
      const owned=owners.get(request);if(!owned)throw new Error('Save belongs to another workspace.');
      if(!Array.isArray(value)||value.length!==request.changes.length)throw new Error('Incomplete fleet save acknowledgment. Retry the original save.');
      const remaining=new Map(request.changes.map(change=>[`${change.collection}:${change.recordId}`,change]));
      const results:OnlineFleetResult[]=[];
      for(const row of value as OnlineFleetResult[]){
        const change=row&&remaining.get(`${row.collection}:${row.recordId}`);
        if(!change||row.event!==change.event||!Number.isSafeInteger(row.version)||row.version<1||(change.expectedVersion!==undefined&&(row.event==='delete'?row.version<change.expectedVersion:row.version<=change.expectedVersion)))throw new Error('Invalid fleet save acknowledgment. Retry the original save.');
        remaining.delete(`${row.collection}:${row.recordId}`);results.push({...row});
      }
      // Reject unsent mutations before promoting any UI read. The server may already have committed.
      for(const row of results){
        if(row.event==='delete')continue;
        const view=(owned.after[row.collection] as RecordId[]).find(record=>record.id===row.recordId);
        const change=request.changes.find(change=>change.collection===row.collection&&change.recordId===row.recordId)!;
        if(!view||!fleetRecordsEqual(wireRecord(row.collection,view),change.data))throw new Error('Displayed values changed during save. The original request may have completed; keep your values and review before retrying.');
      }
      // Only stamp values actually sent. Never authorize unsent mutations of an issued UI object.
      for(const row of results){
        if(row.event==='delete')continue;
        const view=(owned.after[row.collection] as RecordId[]).find(record=>record.id===row.recordId);
        const change=request.changes.find(change=>change.collection===row.collection&&change.recordId===row.recordId)!;
        if(view&&fleetRecordsEqual(wireRecord(row.collection,view),change.data))reads.set(view,{collection:row.collection,id:view.id,version:row.version,value:json(change.data)});
      }
      return results;
    },
  };
}

/** Definitively missing bridge RPC may use legacy CAS; uncertain delivery never changes endpoints. */
export function createOnlineFleetTransport(client:Pick<SupabaseClient,'auth'|'rpc'>,scope:{companyId:string;userId:string},current:()=>boolean,timeoutMs=30_000){
  const identity={...scope};const modes=new WeakMap<PreparedFleetWrite,'once'|'legacy'>();
  return async(request:PreparedFleetWrite):Promise<unknown>=>{
    if(request.companyId!==identity.companyId||request.userId!==identity.userId||!current())throw new Error('Fleet workspace changed. Check the original account before retrying.');
    const controller=new AbortController();let onAbort=()=>{};
    const interrupted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('Fleet save was interrupted; it may have completed. Retry only the original save.'));controller.signal.addEventListener('abort',onAbort,{once:true})});
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const guard=()=>{if(controller.signal.aborted||!current())throw new Error('Fleet workspace changed or save timed out. Check the original account before retrying.')};
    const run=async()=>{
      const {data,error}=await client.auth.getSession();guard();
      if(error||!data.session||data.session.user.id!==identity.userId)throw new Error('Sign in to the original account before saving fleet changes.');
      const invoke=async(mode:'once'|'legacy')=>{
        guard();modes.set(request,mode);
        const args={target_company_id:identity.companyId,changes:request.changes,...(mode==='once'?{operation_id:request.operationId}:{})};
        const result=await client.rpc(mode==='once'?'apply_fleet_changes_once':'apply_fleet_changes',args).setHeader('Authorization',`Bearer ${data.session!.access_token}`).abortSignal(controller.signal);
        guard();return result;
      };
      let result=await invoke(modes.get(request)??'once');
      if(result.error?.code==='PGRST202'&&modes.get(request)==='once')result=await invoke('legacy');
      if(result.error)throw new Error(result.error.code==='40001'||result.error.code==='PT409'?'Record changed by another user. Original save was not confirmed; keep your values and refresh/review before retrying.':result.error.message);
      return result.data;
    };
    try{return await Promise.race([run(),interrupted])}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort)}
  };
}
