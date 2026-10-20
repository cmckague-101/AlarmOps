import {useEffect, useState} from 'react';
import {supabase} from './supabase';

export function useTaskCount(companyId?:string,userId?:string) {
  const [result,setResult] = useState<{scope:string;count:number}|null>(null);
  const scope = `${companyId}:${userId}`;
  useEffect(()=>{
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
    window.addEventListener('focus',load);
    return ()=>{active=false;window.removeEventListener('focus',load);};
  },[companyId,userId,scope]);
  return result?.scope===scope?result.count:null;
}
