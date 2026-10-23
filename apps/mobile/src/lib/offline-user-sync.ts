import {createSyncPatch,decodeDashboardPreferenceChanges,type SyncOperation,type SyncRecord} from '@fireops/domain';
import type {OfflineOutboxSession,OutboxEntry,OutboxScope} from './offline-outbox';

// User-owned offline commands (server: sync_user_command). No manager review:
// tasks are private, availability/dashboard target the caller only, and read
// markers touch only the caller's own notification/thread state.
export const userSyncCommands:Readonly<Record<string,readonly string[]>>={personal_task:['task.create','task.complete'],availability:['availability.set'],dashboard:['dashboard.set'],
  notification:['notification.read'],communication_read:['communication.seen'],communication_reply:['reply.create'],vehicle_note:['note.create']};
export const isUserSyncOperation=(operation:SyncOperation)=>operation.mutation.kind==='command'&&!!userSyncCommands[operation.entityType]?.includes(operation.mutation.command);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unresolved=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
export type OfflineTask={id:string;subject:string;description:string;dueDate:string};
export function scopedUserEntries(entries:readonly OutboxEntry[],userId?:string|null,companyId?:string|null){
  return userId?entries.filter(entry=>entry.operation.provenance.userId===userId&&(!companyId||entry.operation.companyId===companyId)):[];
}
/** Verified reconciliation result, never the proposed value or upload receipt. */
export function latestUserSetting(entries:readonly OutboxEntry[],scope:OutboxScope,entity:'availability'|'dashboard'){
  let latest:{id:string;revision:string;record:SyncRecord|null;sequence:number}|undefined;
  for(const entry of scopedUserEntries(entries,scope.userId,scope.companyId)){
    const op=entry.operation;const receipt=entry.receipt;
    if(op.entityType!==entity||op.entityId!==scope.userId||!isUserSyncOperation(op)||entry.status!=='synced'||receipt?.kind!=='applied'||!/^\d+$/.test(receipt.revision))continue;
    if(!latest||BigInt(receipt.revision)>BigInt(latest.revision)||(receipt.revision===latest.revision&&entry.sequence>latest.sequence))latest={id:op.operationId,revision:receipt.revision,record:receipt.record,sequence:entry.sequence};
  }
  return latest;
}
/** Pending local task changes to overlay on the last downloaded list. */
export function pendingTaskChanges(entries:readonly OutboxEntry[]):{created:OfflineTask[];completed:Set<string>}{
  const created:OfflineTask[]=[];const completed=new Set<string>();
  for(const entry of entries){
    const op=entry.operation;if(op.entityType!=='personal_task'||op.mutation.kind!=='command'||!unresolved(entry))continue;
    if(op.mutation.command==='task.create')created.push({id:op.entityId,...(op.mutation.payload as Omit<OfflineTask,'id'>)});else completed.add(op.entityId);
  }
  return {created:created.filter(task=>!completed.has(task.id)),completed};
}
/** Latest pending value of the caller's own availability / dashboard items. */
export function pendingAvailability(entries:readonly OutboxEntry[],userId:string):boolean|undefined{
  let value:boolean|undefined;for(const entry of entries){const op=entry.operation;if(op.entityType==='availability'&&op.entityId===userId&&op.mutation.kind==='command'&&unresolved(entry))value=(op.mutation.payload as {available:boolean}).available}return value;
}
export function pendingDashboard(entries:readonly OutboxEntry[]):Record<string,SyncRecord[string]>{
  const changes:Record<string,SyncRecord[string]>={};for(const entry of entries){const op=entry.operation;if(op.entityType==='dashboard'&&op.mutation.kind==='command'&&unresolved(entry))Object.assign(changes,(op.mutation.payload as {changes:Record<string,SyncRecord[string]>}).changes)}return changes;
}
// Read markers only move forward, so synced ones may keep overlaying a stale
// downloaded list until it refreshes. Refused ones never overlay.
const marking=(entry:OutboxEntry)=>unresolved(entry)||(entry.status==='synced'&&entry.receipt?.kind==='applied');
/** Notifications this user marked read on the device (pending or confirmed), with the device time. */
export function pendingNotificationReads(entries:readonly OutboxEntry[]):Map<string,string>{
  const reads=new Map<string,string>();for(const entry of entries){const op=entry.operation;if(op.entityType==='notification'&&op.mutation.kind==='command'&&marking(entry)&&!reads.has(op.entityId))reads.set(op.entityId,op.provenance.savedAt)}return reads;
}
/** Newer server timestamp of two; ties keep the longer (more precise) string. */
export function laterTimestamp(left:string|undefined,right:string){
  if(left===undefined)return right;const a=Date.parse(left),b=Date.parse(right);return b>a||(b===a&&right.length>left.length)?right:left;
}
/** Highest seen marker per thread this user saved on the device (pending or confirmed). */
export function pendingThreadSeen(entries:readonly OutboxEntry[]):Map<string,string>{
  const seen=new Map<string,string>();
  for(const entry of entries){const op=entry.operation;if(op.entityType!=='communication_read'||op.mutation.kind!=='command'||!marking(entry))continue;seen.set(op.entityId,laterTimestamp(seen.get(op.entityId),(op.mutation.payload as {seenThrough:string}).seenThrough))}
  return seen;
}
type DeviceCreate<Payload>={id:string;savedAt:string;state:'saved'|'action_needed'|'posted';createdAt?:string}&Payload;
/** Records this device created through a user command: waiting, needing action, or confirmed (until downloaded lists have them). */
function deviceCreates<Payload>(entries:readonly OutboxEntry[],entityType:string):DeviceCreate<Payload>[]{
  const created:DeviceCreate<Payload>[]=[];
  for(const entry of entries){
    const op=entry.operation;if(op.entityType!==entityType||op.mutation.kind!=='command')continue;
    const base={...(op.mutation.payload as Payload),id:op.entityId,savedAt:op.provenance.savedAt};
    if(unresolved(entry)){created.push({...base,state:entry.status==='blocked'?'action_needed':'saved'});continue}
    const delivery=entry.delivery as {notApplied?:unknown;record?:{createdAt?:unknown}|null}|null;
    const createdAt=(entry.receipt?.kind==='applied'?entry.receipt.record?.createdAt:undefined)??delivery?.record?.createdAt;
    if(entry.status==='synced'&&delivery?.notApplied===undefined&&typeof createdAt==='string')created.push({...base,state:'posted',createdAt});
  }
  return created;
}
export type DeviceReply=DeviceCreate<{threadId:string;body:string}>;
/** Crew Chat replies saved on this device. */
export const deviceReplies=(entries:readonly OutboxEntry[])=>deviceCreates<{threadId:string;body:string}>(entries,'communication_reply');
export type DeviceVehicleNote=DeviceCreate<{vehicleId:string;subject:string;body:string}>;
/** Vehicle notes created on this device for one vehicle. */
export const deviceVehicleNotes=(entries:readonly OutboxEntry[],vehicleId:string)=>deviceCreates<{vehicleId:string;subject:string;body:string}>(entries,'vehicle_note').filter(note=>note.vehicleId===vehicleId);
const serverTime=/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/;
export function createOfflineUserSync(options:{session:OfflineOutboxSession;id:()=>string;now?:()=>string;offline:()=>boolean;canEdit:()=>boolean;changed:()=>Promise<void>}){
  const {session}=options;const scope={...session.scope};
  const guard=()=>{if(!options.canEdit())throw new Error('Offline saving is unavailable for the current account.')};
  type Save={operationId:string;savedAt:string;connectivity:'offline'|'online';operation?:SyncOperation;promise?:Promise<OutboxEntry>};
  // Retain failed/uncertain local saves only. A later intentional save gets a new ID.
  const saves=new Map<string,Save>();
  async function enqueue(entityType:string,entityId:string,command:string,payload:SyncRecord,projection:SyncRecord|null,dependsOn:string[]=[]):Promise<OutboxEntry>{
    guard();createSyncPatch({},payload);if(projection!==null)createSyncPatch({},projection);
    const captured=JSON.parse(JSON.stringify({payload,projection,dependsOn})) as {payload:SyncRecord;projection:SyncRecord|null;dependsOn:string[]};
    const key=JSON.stringify([entityType,entityId,command,captured],(_key,value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
    let save=saves.get(key);
    if(!save){save={operationId:options.id(),savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.offline()?'offline':'online'};saves.set(key,save)}
    if(save.promise)return save.promise;
    const request=save;
    request.promise=(async()=>{
      if(!request.operation){
        const deviceId=await session.getDeviceId(options.id);guard();
        request.operation={schemaVersion:1,operationId:request.operationId,companyId:scope.companyId,entityType,entityId,
          provenance:{userId:scope.userId,deviceId,savedAt:request.savedAt,connectivity:request.connectivity},dependsOn:captured.dependsOn,mutation:{kind:'command',command,payload:captured.payload}};
      }
      guard();const entry=await session.enqueue(request.operation,captured.projection,{sequenceCommand:true});
      saves.delete(key);
      try{await options.changed()}catch{/* Committed command remains durable. */}
      return entry;
    })();
    try{return await request.promise}finally{request.promise=undefined}
  }
  return {
    scope:Object.freeze({...scope}),
    createTask(task:OfflineTask){
      const subject=task.subject.trim();const description=task.description.trim();
      if(!uuid.test(task.id)||!subject||subject.length>200||description.length>5000||!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))return Promise.reject(new Error('Check the task subject, description and due date.'));
      const payload={subject,description,dueDate:task.dueDate};return enqueue('personal_task',task.id,'task.create',payload,{id:task.id,...payload});
    },
    /** Completing a task created on this device waits for its create to sync. */
    async completeTask(id:string){
      if(!uuid.test(id))throw new Error('Invalid task.');
      const create=(await session.list()).find(entry=>entry.operation.entityType==='personal_task'&&entry.operation.entityId===id&&entry.operation.mutation.kind==='command'&&entry.operation.mutation.command==='task.create');
      return enqueue('personal_task',id,'task.complete',{},null,create?[create.operation.operationId]:[]);
    },
    /** `base` is the value shown on this device; if someone changed it since, the server keeps theirs. */
    setAvailability(available:boolean,base:boolean|null){return enqueue('availability',scope.userId,'availability.set',{available,base},{id:scope.userId,available})},
    async setDashboard(changes:Record<string,boolean>){
      const patch=decodeDashboardPreferenceChanges(changes);
      return enqueue('dashboard',scope.userId,'dashboard.set',{changes:patch},null);
    },
    /** `id` is chosen once per intended reply and reused for retries of the same save. */
    postReply(reply:{id:string;threadId:string;body:string}){
      const body=reply.body.trim();
      if(!uuid.test(reply.id)||!uuid.test(reply.threadId)||!body||body.length>5000)return Promise.reject(new Error('Check the reply text.'));
      return enqueue('communication_reply',reply.id,'reply.create',{threadId:reply.threadId,body},null);
    },
    /** `id` is chosen once per intended note and reused for retries of the same save. */
    createVehicleNote(note:{id:string;vehicleId:string;subject:string;body:string}){
      const subject=note.subject.trim();const body=note.body.trim();
      if(!uuid.test(note.id)||!uuid.test(note.vehicleId)||!subject||subject.length>160||!body||body.length>5000)return Promise.reject(new Error('Check the note subject and details.'));
      return enqueue('vehicle_note',note.id,'note.create',{vehicleId:note.vehicleId,subject,body},null);
    },
    markNotificationRead(id:string){
      if(!uuid.test(id))return Promise.reject(new Error('Invalid notification.'));
      return enqueue('notification',id,'notification.read',{},null);
    },
    /** `seenThrough` is the newest server timestamp displayed for the thread, verbatim. */
    markThreadSeen(threadId:string,seenThrough:string){
      if(!uuid.test(threadId)||!serverTime.test(seenThrough)||!Number.isFinite(Date.parse(seenThrough)))return Promise.reject(new Error('Invalid thread seen marker.'));
      return enqueue('communication_read',threadId,'communication.seen',{seenThrough},null);
    },
  };
}
export type OfflineUserSync=ReturnType<typeof createOfflineUserSync>;
