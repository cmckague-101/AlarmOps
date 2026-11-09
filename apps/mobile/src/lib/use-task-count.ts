import {useCallback, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {supabase} from './supabase';
import {overdueTaskCount} from '@fireops/domain';

export type TaskCount={count:number;overdue:number};

export function useTaskCount(companyId?:string,userId?:string) {
  const [result,setResult] = useState<{scope:string;value:TaskCount}|null>(null);
  const scope = `${companyId}:${userId}`;
  useFocusEffect(useCallback(()=>{
    let active=true;
    let request=0;
    const client=supabase;
    if(!client||!companyId||!userId)return;
    async function load() {
      const version=++request;
      try {
        const {data,count,error}=await client!.from('personal_tasks').select('due_date',{count:'exact'}).eq('company_id',companyId!).eq('user_id',userId!);
        if(active&&version===request)setResult(!error&&count!==null?{scope,value:{count,overdue:overdueTaskCount(((data??[]) as {due_date:string}[]).map(row=>row.due_date))}}:null);
      } catch {if(active&&version===request)setResult(null);}
    }
    void load();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return ()=>{active=false;subscription.remove();};
  },[companyId,userId,scope]));
  return result?.scope===scope?result.value:null;
}
