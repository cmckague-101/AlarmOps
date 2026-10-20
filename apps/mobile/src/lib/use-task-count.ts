import {useCallback, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {supabase} from './supabase';

export function useTaskCount(companyId?:string,userId?:string) {
  const [result,setResult] = useState<{scope:string;count:number}|null>(null);
  const scope = `${companyId}:${userId}`;
  useFocusEffect(useCallback(()=>{
    let active=true;
    let request=0;
    const client=supabase;
    if(!client||!companyId||!userId)return;
    async function load() {
      const version=++request;
      try {
        const {count,error}=await client!.from('personal_tasks').select('id',{count:'exact',head:true}).eq('company_id',companyId!).eq('user_id',userId!);
        if(active&&version===request)setResult(!error&&count!==null?{scope,count}:null);
      } catch {if(active&&version===request)setResult(null);}
    }
    void load();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return ()=>{active=false;subscription.remove();};
  },[companyId,userId,scope]));
  return result?.scope===scope?result.count:null;
}
