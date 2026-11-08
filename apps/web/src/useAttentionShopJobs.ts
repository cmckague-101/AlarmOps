import {useCallback, useEffect, useState} from 'react';
import {SHOP_JOB_COLUMNS, attentionShopPriorities, openShopStatuses, shopJobFromRow, type ShopJob, type ShopJobRow} from '@fireops/domain';
import {supabase} from './supabase';

/** Open critical/high shop jobs for the owner Needs Attention card, kept live with Realtime. */
export function useAttentionShopJobs(companyId?:string) {
  const [jobs,setJobs]=useState<ShopJob[]>([]);
  const load=useCallback(async()=>{
    if(!supabase||!companyId){setJobs([]);return}
    const {data,error}=await supabase.from('shop_jobs').select(SHOP_JOB_COLUMNS).eq('company_id',companyId)
      .in('status',[...openShopStatuses]).in('priority',[...attentionShopPriorities]).order('updated_at',{ascending:false});
    if(error)return;
    setJobs(((data??[]) as ShopJobRow[]).map(shopJobFromRow));
  },[companyId]);
  useEffect(()=>{
    void load();
    if(!supabase||!companyId)return;
    const client=supabase;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const channel=client.channel(`command-shop:${companyId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'shop_jobs',filter:`company_id=eq.${companyId}`},()=>{clearTimeout(timer);timer=setTimeout(()=>void load(),250)})
      .subscribe();
    return()=>{clearTimeout(timer);void client.removeChannel(channel)};
  },[companyId,load]);
  return jobs;
}
