import {SHOP_JOB_COLUMNS, attentionShopPriorities, openShopStatuses, shopJobFromRow, type ShopJob, type ShopJobRow} from '@fireops/domain';
import {useCallback, useEffect, useRef, useState} from 'react';

import {supabase} from '@/lib/supabase';
import {onAppResume, refreshOnRejoin} from './app-resume';

/** Open critical/high shop jobs for the owner Needs Attention card, kept live with Realtime. */
export function useAttentionShopJobs(companyId:string|null) {
  const [jobs,setJobs]=useState<ShopJob[]>([]);
  const active=useRef(companyId);
  active.current=companyId;
  const refresh=useCallback(async()=>{
    const client=supabase;
    if(!client||!companyId){setJobs([]);return}
    const {data,error}=await client.from('shop_jobs').select(SHOP_JOB_COLUMNS).eq('company_id',companyId)
      .in('status',[...openShopStatuses]).in('priority',[...attentionShopPriorities]).order('updated_at',{ascending:false});
    if(error||active.current!==companyId)return;
    setJobs(((data??[]) as ShopJobRow[]).map(shopJobFromRow));
  },[companyId]);
  useEffect(()=>{
    setJobs([]);
    void refresh().catch(()=>undefined);
    const client=supabase;
    if(!client||!companyId)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const channel=client.channel(`mobile-command-shop:${companyId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'shop_jobs',filter:`company_id=eq.${companyId}`},()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(()=>undefined),250)})
      .subscribe(refreshOnRejoin(refresh));
    const stopResume=onAppResume(refresh);
    return()=>{clearTimeout(timer);stopResume();void client.removeChannel(channel)};
  },[companyId,refresh]);
  return {jobs,refresh};
}
