import {useEffect, useRef, useState} from 'react';
import {taskDraftError, type PersonalTask, type TaskDraft} from '@fireops/domain';
import {supabase} from './supabase';

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
  async function save(draft:TaskDraft, id?:string) {
    const validation = taskDraftError(draft);
    if (validation) {setError(validation);return false;}
    const values={subject:draft.subject.trim(),description:draft.description.trim(),due_date:draft.dueDate};
    return mutate(()=>id
      ? supabase!.from('personal_tasks').update(values).eq('id',id).eq('company_id',companyId!).eq('user_id',userId!).select('id').single()
      : supabase!.from('personal_tasks').insert({company_id:companyId,user_id:userId,...values}), 'Task could not be saved. Please try again.');
  }
  async function remove(id:string) {
    return mutate(()=>supabase!.from('personal_tasks').delete().eq('id',id).eq('company_id',companyId!).eq('user_id',userId!), 'Task could not be removed. Please try again.');
  }
  return {tasks,loading,busy,error,save,remove,retry:()=>setRevision(value=>value+1),connected:Boolean(companyId&&userId&&supabase)};
}
