import {useEffect, useMemo, useState} from 'react';
import {taskDraftError, type PersonalTask, type TaskDraft} from '@fireops/domain';
import {supabase} from './supabase';
import {createFleetId} from './fleet-store';
import {pendingTaskChanges, scopedUserEntries} from './offline-user-sync';
import {receiptsAfter} from './offline-user-snapshot';
import {useUserDataScope} from './user-data-scope';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

type State={token:object;tasks:PersonalTask[];loading:boolean;busy:boolean;error:string;through:number;edits?:{snapshot:unknown;task:PersonalTask}[]};
export function usePersonalTasks(companyId?:string, userId?:string) {
  const {token,current}=useUserDataScope(`${companyId}:${userId}`);
  const empty=():State=>({token,tasks:[],loading:!!companyId&&!!userId,busy:false,error:'',through:0});
  const [stored,setStored]=useState<State>(empty);
  const state=stored.token===token?stored:empty();
  const [revision,setRevision]=useState(0);
  const gate=useMemo(()=>({locked:false,creates:new Map<string,string>()}),[token]);
  const offlineSync=useOptionalOfflineSync();
  const candidate=offlineSync?.userSync;
  const userSync=candidate&&candidate.scope.userId===userId&&candidate.scope.companyId===companyId?candidate:null;
  const queueRequired=!!offlineSync?.available||!!offlineSync?.offline||!!candidate;
  const entries=useMemo(()=>companyId&&userId?scopedUserEntries(offlineSync?.state.entries??[],userId,companyId):[],[offlineSync?.state.entries,companyId,userId]);
  const pending=useMemo(()=>pendingTaskChanges(entries),[entries]);
  const settled=entries.filter(entry=>entry.operation.entityType==='personal_task'&&entry.status==='synced'&&entry.receipt?.kind==='applied');
  const settledKey=settled.map(entry=>entry.operation.operationId).join(':');
  const through=Math.max(0,...settled.map(entry=>entry.sequence));
  // Verified download for this exact account/company replaces the HTTP list when present.
  const saved=offlineSync?.userSnapshot?.snapshot;
  const verified=saved&&saved.companyId===companyId&&saved.userId===userId?saved:null;
  const offline=!!offlineSync?.offline;
  function patch(change:Partial<State>){if(current())setStored(before=>current()?{...(before.token===token?before:empty()),...change}:before)}
  const baseTasks=useMemo(()=>{
    if(!companyId||!userId)return [];
    if(verified){
      if(!verified.tasks)return [];
      const rows=new Map(verified.tasks.map(task=>[task.id,{id:task.id,company_id:companyId,user_id:userId,subject:task.subject,description:task.description,due_date:task.dueDate,created_at:''} as PersonalTask]));
      for(const entry of receiptsAfter(entries.filter(item=>item.operation.entityType==='personal_task'),verified)){
        const record=entry.receipt?.kind==='applied'?entry.receipt.record:null;
        if(record)rows.set(entry.operation.entityId,{id:entry.operation.entityId,company_id:companyId,user_id:userId,subject:String(record.subject??''),description:String(record.description??''),due_date:String(record.dueDate??''),created_at:''});
        else rows.delete(entry.operation.entityId);
      }
      for(const task of pending.created)if(!rows.has(task.id))rows.set(task.id,{id:task.id,company_id:companyId,user_id:userId,subject:task.subject,description:task.description,due_date:task.dueDate,created_at:''});
      return [...rows.values()].filter(task=>!pending.completed.has(task.id)).sort((a,b)=>a.due_date.localeCompare(b.due_date));
    }
    const completed=new Set(pending.completed);
    for(const entry of settled)if(entry.operation.mutation.kind==='command'&&entry.operation.mutation.command==='task.complete'&&entry.receipt?.kind==='applied'&&entry.receipt.record===null)completed.add(entry.operation.entityId);
    const rows=new Map(state.tasks.filter(task=>task.company_id===companyId&&task.user_id===userId).map(task=>[task.id,task]));
    // Keep newly reconciled creations visible while the list reload is pending.
    for(const entry of settled)if(entry.sequence>state.through&&entry.receipt?.kind==='applied'&&entry.receipt.record){
      const record=entry.receipt.record;
      rows.set(entry.operation.entityId,{id:entry.operation.entityId,company_id:companyId,user_id:userId,subject:String(record.subject??''),description:String(record.description??''),due_date:String(record.dueDate??''),created_at:''});
    }
    for(const task of pending.created)if(!rows.has(task.id))rows.set(task.id,{id:task.id,company_id:companyId,user_id:userId,subject:task.subject,description:task.description,due_date:task.dueDate,created_at:''});
    return [...rows.values()].filter(task=>!completed.has(task.id)).sort((a,b)=>a.due_date.localeCompare(b.due_date));
  },[companyId,userId,state.tasks,state.through,entries,pending,verified]);
  useEffect(()=>{
    let active=true;
    if(!companyId||!userId||!supabase){patch({loading:false});return}
    // A verified download is the source; offline, an unverified HTTP copy is never shown instead.
    if(verified){patch({loading:false,error:''});return}
    if(offline){patch({loading:false,error:'Your tasks have not been downloaded for offline use yet. Connect once to download them.'});return}
    patch({loading:true,error:''});
    void (async()=>{
      try{
        const {data,error}=await supabase!.from('personal_tasks').select('*').eq('company_id',companyId).eq('user_id',userId).order('due_date').order('created_at');
        if(error)throw error;
        if(active)patch({tasks:(data??[]) as PersonalTask[],through,error:''});
      }catch{if(active)patch({error:'Tasks could not load. Please try again.'})}
      finally{if(active)patch({loading:false})}
    })();
    return()=>{active=false};
  },[token,revision,settledKey,!!verified,offline]);
  async function mutate(action:()=>Promise<void>,message:string){
    if(!current()||gate.locked||!companyId||!userId)return false;
    gate.locked=true;patch({busy:true,error:''});
    try{await action();if(!current())return false;return true}
    catch(failure){patch({error:failure instanceof Error?failure.message:message});return false}
    finally{gate.locked=false;patch({busy:false})}
  }
  const shown=baseTasks.map(task=>state.edits?.find(edit=>edit.snapshot===verified&&edit.task.id===task.id)?.task??task).sort((a,b)=>a.due_date.localeCompare(b.due_date));
  function canEdit(id:string){
    return !offline&&!!supabase&&!entries.some(entry=>entry.operation.entityType==='personal_task'&&entry.operation.entityId===id&&entry.status!=='synced');
  }
  async function save(draft:TaskDraft,id?:string){
    if(!current())return false;
    const validation=taskDraftError(draft);if(validation){patch({error:validation});return false}
    const payload={subject:draft.subject.trim(),description:draft.description.trim(),dueDate:draft.dueDate};
    const key=JSON.stringify(payload);
    const saved=await mutate(async()=>{
      if(id){
        if(!canEdit(id))throw new Error('Connect and sync this task before editing it.');
        const {data,error}=await supabase!.from('personal_tasks').update({subject:payload.subject,description:payload.description,due_date:payload.dueDate}).eq('id',id).eq('company_id',companyId!).eq('user_id',userId!).select('*').single();
        if(error)throw error;
        if(!current())return;
        patch({edits:[...(state.edits??[]).filter(edit=>edit.task.id!==id),{snapshot:verified,task:data as PersonalTask}],tasks:state.tasks.map(task=>task.id===id?data as PersonalTask:task)});
        if(offlineSync?.userSnapshot)await offlineSync.refreshUserSnapshot();
        if(current())setRevision(value=>value+1);
      }else if(queueRequired){
        if(!userSync)throw new Error('Device saving is unavailable. Wait for account storage or retry.');
        let id=gate.creates.get(key);if(!id){id=createFleetId();gate.creates.set(key,id)}
        await userSync.createTask({id,...payload});
      }else{
        if(!supabase)throw new Error('Task saving is unavailable.');
        const {error}=await supabase.from('personal_tasks').insert({company_id:companyId,user_id:userId,subject:payload.subject,description:payload.description,due_date:payload.dueDate});
        if(error)throw error;
        if(current())setRevision(value=>value+1);
      }
    },'Task could not be saved. Please try again.');
    if(saved)gate.creates.delete(key);
    return saved;
  }
  async function remove(id:string){
    return mutate(async()=>{
      if(queueRequired){
        if(!userSync)throw new Error('Device saving is unavailable. Wait for account storage or retry.');
        await userSync.completeTask(id);
      }else{
        if(!supabase)throw new Error('Task saving is unavailable.');
        const {error}=await supabase.from('personal_tasks').delete().eq('id',id).eq('company_id',companyId!).eq('user_id',userId!);
        if(error)throw error;
        if(current())setRevision(value=>value+1);
      }
    },'Task could not be completed. Please try again.');
  }
  const snapshotError=verified&&verified.tasks===null?'Tasks are not available for your current role.':verified?offlineSync?.userSnapshot?.error??'':'';
  return {tasks:shown,pendingCount:pending.created.length+pending.completed.size,loading:state.loading,busy:state.busy,error:state.error||snapshotError,save,remove,canEdit,
    retry:()=>{if(!current())return;if(offlineSync?.userSnapshot)void offlineSync.refreshUserSnapshot();setRevision(value=>value+1)},
    /** Server time of the verified download shown, if any. */
    downloadedAt:verified?.serverRequestAt??null,connected:Boolean(companyId&&userId&&supabase)};
}
