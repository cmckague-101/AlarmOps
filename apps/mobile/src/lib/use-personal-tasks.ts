import {useEffect, useMemo, useRef, useState} from 'react';
import {taskDraftError, type PersonalTask, type TaskDraft} from '@fireops/domain';
import {supabase} from './supabase';
import {createFleetId} from './fleet-store';
import {pendingTaskChanges} from './offline-user-sync';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

export function usePersonalTasks(companyId?:string, userId?:string) {
  const [tasks,setTasks] = useState<PersonalTask[]>([]);
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [revision,setRevision] = useState(0);
  const scope = `${companyId}:${userId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const locked = useRef(false);
  // Offline (installed app): saves become durable device commands, overlaid until synced.
  const offlineSync = useOptionalOfflineSync();
  const userSync = offlineSync?.userSync ?? null;
  const offline = !!offlineSync?.offline;
  const entries = offlineSync?.state.entries;
  const pending = useMemo(()=>pendingTaskChanges(entries ?? []),[entries]);
  const pendingCount = pending.created.length + pending.completed.size;
  const previousPending = useRef(pendingCount);
  useEffect(()=>{if(pendingCount<previousPending.current)setRevision(value=>value+1);previousPending.current=pendingCount;},[pendingCount]);
  const shown = useMemo(()=>{
    if(!companyId||!userId)return tasks;
    const local=pending.created.filter(task=>!tasks.some(item=>item.id===task.id)).map(task=>({id:task.id,company_id:companyId,user_id:userId,subject:task.subject,description:task.description,due_date:task.dueDate,created_at:''}));
    return [...tasks.filter(task=>!pending.completed.has(task.id)),...local].sort((a,b)=>a.due_date.localeCompare(b.due_date));
  },[tasks,pending,companyId,userId]);
  useEffect(()=>{
    let active = true;
    setTasks([]);setError('');
    if (!companyId || !userId || !supabase) {setLoading(false);return;}
    setLoading(true);
    void (async()=>{
      try {
        const {data,error:failure} = await supabase!.from('personal_tasks').select('*').eq('company_id',companyId).eq('user_id',userId).order('due_date').order('created_at');
        if (failure) throw failure;
        if (active) setTasks(data as PersonalTask[]);
      } catch {if(active)setError('Tasks could not load. Please try again.');}
      finally {if(active)setLoading(false);}
    })();
    return ()=>{active=false;};
  },[companyId,userId,revision]);
  async function mutate(action:()=>PromiseLike<{error:unknown}>, message:string) {
    if (locked.current || !companyId || !userId || !supabase) return false;
    locked.current=true;setBusy(true);setError('');
    try {
      const {error:failure} = await action();
      if (failure) throw failure;
      if(currentScope.current!==scope)return false;
      setRevision(value=>value+1);
      return true;
    } catch {if(currentScope.current===scope)setError(message);return false;}
    finally {locked.current=false;setBusy(false);}
  }
  async function offlineMutate(action:()=>Promise<unknown>, message:string) {
    if (locked.current) return false;
    locked.current=true;setBusy(true);setError('');
    try {await action();return currentScope.current===scope;}
    catch (failure) {if(currentScope.current===scope)setError(failure instanceof Error?failure.message:message);return false;}
    finally {locked.current=false;setBusy(false);}
  }
  async function save(draft:TaskDraft) {
    const validation = taskDraftError(draft);
    if (validation) {setError(validation);return false;}
    if (offline && userSync) return offlineMutate(()=>userSync.createTask({id:createFleetId(),subject:draft.subject,description:draft.description,dueDate:draft.dueDate}), 'Task could not be saved on this device.');
    return mutate(()=>supabase!.from('personal_tasks').insert({company_id:companyId,user_id:userId,subject:draft.subject.trim(),description:draft.description.trim(),due_date:draft.dueDate}), 'Task could not be saved. Please try again.');
  }
  async function remove(id:string) {
    if (offline && userSync) return offlineMutate(()=>userSync.completeTask(id), 'Task could not be completed on this device.');
    return mutate(()=>supabase!.from('personal_tasks').delete().eq('id',id).eq('company_id',companyId!).eq('user_id',userId!), 'Task could not be removed. Please try again.');
  }
  return {tasks:shown,pendingCount,loading,busy,error,save,remove,retry:()=>setRevision(value=>value+1),connected:Boolean(companyId&&userId&&supabase)};
}
