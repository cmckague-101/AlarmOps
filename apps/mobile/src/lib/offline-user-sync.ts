import type {SyncOperation,SyncRecord} from '@fireops/domain';
import type {OfflineOutboxSession,OutboxEntry} from './offline-outbox';

// User-owned offline commands (server: sync_user_command). No manager review:
// tasks are private, availability/dashboard target the caller only.
export const userSyncCommands:Readonly<Record<string,readonly string[]>>={personal_task:['task.create','task.complete'],availability:['availability.set'],dashboard:['dashboard.set']};
export const isUserSyncOperation=(operation:SyncOperation)=>operation.mutation.kind==='command'&&!!userSyncCommands[operation.entityType]?.includes(operation.mutation.command);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unresolved=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
export type OfflineTask={id:string;subject:string;description:string;dueDate:string};
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
export function createOfflineUserSync(options:{session:OfflineOutboxSession;id:()=>string;now?:()=>string;offline:()=>boolean;canEdit:()=>boolean;changed:()=>Promise<void>}){
  const {session}=options;const scope={...session.scope};
  const guard=()=>{if(!options.canEdit())throw new Error('Offline saving is unavailable for the current account.')};
  async function enqueue(entityType:string,entityId:string,command:string,payload:SyncRecord,projection:SyncRecord|null,dependsOn:string[]=[]):Promise<OutboxEntry>{
    guard();const deviceId=await session.getDeviceId(options.id);guard();
    const operation:SyncOperation={schemaVersion:1,operationId:options.id(),companyId:scope.companyId,entityType,entityId,
      provenance:{userId:scope.userId,deviceId,savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.offline()?'offline':'online'},dependsOn,mutation:{kind:'command',command,payload}};
    const entry=await session.enqueue(operation,projection);
    try{await options.changed()}catch{/* Committed command remains durable. */}
    return entry;
  }
  return {
    createTask(task:OfflineTask){
      const subject=task.subject.trim();const description=task.description.trim();
      if(!uuid.test(task.id)||!subject||subject.length>200||description.length>5000||!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))return Promise.reject(new Error('Check the task subject, description and due date.'));
      const payload={subject,description,dueDate:task.dueDate};return enqueue('personal_task',task.id,'task.create',payload,{id:task.id,...payload});
    },
    /** Completing a task created on this device waits for its create to sync. */
    async completeTask(id:string){
      if(!uuid.test(id))throw new Error('Invalid task.');
      const create=(await session.list()).find(entry=>entry.operation.entityId===id&&entry.operation.mutation.kind==='command'&&entry.operation.mutation.command==='task.create');
      return enqueue('personal_task',id,'task.complete',{},null,create?[create.operation.operationId]:[]);
    },
    /** `base` is the value shown on this device; if someone changed it since, the server keeps theirs. */
    setAvailability(available:boolean,base:boolean|null){return enqueue('availability',scope.userId,'availability.set',{available,base},{id:scope.userId,available})},
    setDashboard(changes:Record<string,boolean>){
      if(!Object.keys(changes).length)return Promise.reject(new Error('No dashboard changes.'));
      return enqueue('dashboard',scope.userId,'dashboard.set',{changes},null);
    },
  };
}
export type OfflineUserSync=ReturnType<typeof createOfflineUserSync>;
