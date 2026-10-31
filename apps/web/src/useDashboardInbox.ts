import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {DashboardNotification, FireOpsUser} from '@fireops/domain';
import {canProcessFinance,isCompanyManager} from '@fireops/domain';
import {supabase} from './supabase';

type NotificationRow = {
  id:string;
  event_type:'communication_reply'|'training_created'|'qualification_approved'|'payroll_rejected'|'invoice_paid'|'task_due'|'system';
  path:string|null;
  title:string;
  body:string;
  read_at:string|null;
  created_at:string;
};

const visibleEvents:NotificationRow['event_type'][]=['communication_reply','training_created','qualification_approved','payroll_rejected','invoice_paid'];
// Accounting also receives payroll and invoice submissions as system notifications.
const financeEvents:NotificationRow['event_type'][]=[...visibleEvents,'system'];

function source(event:NotificationRow['event_type'],path:string|null):DashboardNotification['source'] {
  if(event==='task_due')return 'tasks';
  if(event==='payroll_rejected')return 'payroll';
  if(event==='invoice_paid')return 'invoices';
  if(event==='system')return path==='/invoices'?'invoices':'payroll';
  if(event==='communication_reply')return 'communications';
  if(event==='training_created')return 'training';
  return 'qualifications';
}

export function useDashboardInbox(companyId:string|undefined,user:FireOpsUser) {
  const token=useMemo(()=>({}),[companyId,user.id,user.role]);
  const currentToken=useRef(token);currentToken.current=token;
  const [stored,setStored]=useState<{token:object;items:DashboardNotification[]|null}>({token,items:null});
  const notifications=stored.token===token?stored.items:null;
  const load=useCallback(async()=>{
    if(currentToken.current!==token)return;
    if(!supabase||!companyId){setStored({token,items:null});return}
    const {data,error}=await supabase.from('user_notifications')
      .select('id,event_type,title,body,path,read_at,created_at')
      .eq('company_id',companyId).eq('user_id',user.id)
      .in('event_type',isCompanyManager(user.role)?['task_due']:user.role==='shop_tech'?[...visibleEvents,'task_due']:canProcessFinance(user.role)?financeEvents:visibleEvents)
      .order('created_at',{ascending:false}).limit(5);
    if(error||currentToken.current!==token)return;
    setStored({token,items:((data??[]) as NotificationRow[]).map(row=>({
      id:row.id,source:source(row.event_type,row.path),title:row.title,detail:row.body,
      createdAt:row.created_at,unread:!row.read_at,
    }))});
  },[companyId,user.id,user.role,token]);

  useEffect(()=>{
    void load();
    if(!supabase||!companyId)return;
    const client=supabase;
    const channel=client.channel(`web-dashboard-notifications:${companyId}:${user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'user_notifications',filter:`user_id=eq.${user.id}`},()=>void load())
      .subscribe();
    return()=>{void client.removeChannel(channel)};
  },[companyId,user.id,user.role,load]);

  const markRead=useCallback(async(id:string)=>{
    if(!supabase||!companyId||currentToken.current!==token)return;
    setStored(before=>before.token===token?{token,items:before.items?.map(item=>item.id===id?{...item,unread:false}:item)??null}:before);
    await supabase.from('user_notifications').update({read_at:new Date().toISOString()})
      .eq('company_id',companyId).eq('user_id',user.id).eq('id',id);
  },[companyId,user.id,token]);

  return {notifications,markRead};
}
