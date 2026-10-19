import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, BellRing, ChevronRight, CircleDollarSign, Flame, Truck, Users} from 'lucide-react';
import {commandAlerts, commandCenter, type CommandPayroll, type CommandRow, type CrewMember, type FleetIssue, type Vehicle} from '@fireops/domain';
import {supabase} from './supabase';

type PayrollAlertRow={id:string;created_by_name:string;engine_number:string;incidents:string;status:string};

function usePayrollAlerts(companyId?:string) {
  const [payrolls,setPayrolls]=useState<CommandPayroll[]>([]);
  const load=useCallback(async()=>{
    if(!supabase||!companyId){setPayrolls([]);return}
    const {data,error}=await supabase.from('payroll_forms').select('id,created_by_name,engine_number,incidents,status').eq('company_id',companyId).eq('status','pending').order('submitted_at',{ascending:true});
    if(error)return;
    setPayrolls(((data??[]) as PayrollAlertRow[]).map(row=>({id:row.id,createdByName:row.created_by_name,engineNumber:row.engine_number,incidents:row.incidents,status:row.status})));
  },[companyId]);
  useEffect(()=>{void load();if(!supabase||!companyId)return;const client=supabase;const channel=client.channel(`command-payroll:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'payroll_forms',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();return()=>{void client.removeChannel(channel)}},[companyId,load]);
  return payrolls;
}

export function OwnerDashboard({quickActions,nationalFireActivity,companyId,name,vehicles,crew,issues,onSelect}:{quickActions?:React.ReactNode;nationalFireActivity?:React.ReactNode;companyId?:string;name:string;vehicles:Vehicle[];crew:CrewMember[];issues:FleetIssue[];onSelect:(target:NonNullable<CommandRow['target']>)=>void}) {
  const [selected,setSelected]=useState<string|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const payrolls=usePayrollAlerts(companyId);
  const cards=commandCenter(vehicles,crew,issues);
  const alerts=commandAlerts(vehicles,issues,payrolls);
  const detail=cards.find(card=>card.id===selected);
  const icons=[Flame,Users,Truck,AlertTriangle];
  function navigate(id:string|null){setSelected(id);requestAnimationFrame(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:'start'})})}
  return <div className="page owner-command">
    {detail?<><button className="command-back" onClick={()=>navigate(null)}><ArrowLeft/> Command Center</button><header><h1 ref={heading} tabIndex={-1}>{detail.title}</h1><p>{detail.description}</p></header><div className="command-list">{detail.rows.map(row=><article className="command-record" key={row.id}><div className="command-record-heading"><h2>{row.target?<button onClick={()=>onSelect(row.target!)}>{row.title}<ChevronRight/></button>:row.title}</h2><span className={`command-badge ${row.urgent?'urgent':''}`}>{row.badge}</span></div>{row.detail&&<p>{row.detail}</p>}{row.lines.map((line,index)=><div className="command-line" key={index}>{line}</div>)}</article>)}{!detail.rows.length&&<p className="command-empty">{detail.id==='attention'?'No open issues need attention.':`No ${detail.title.toLowerCase()} yet.`}</p>}</div></>:<><div className="command-greeting"><span>Hello,</span><strong>{name.trim().split(/\s+/)[0]||'there'}!</strong></div><header><h1 ref={heading} tabIndex={-1}>Command Center</h1><p>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})} · Current Operational Status</p></header>{alerts.length>0&&<section className="command-alerts" aria-labelledby="command-alerts-heading"><div className="command-alerts-heading"><span><BellRing/></span><div><h2 id="command-alerts-heading">Alerts</h2><p>{alerts.length} {alerts.length===1?'item needs':'items need'} your attention</p></div></div><div className="command-alert-list">{alerts.map(alert=><button key={alert.id} className="command-alert" onClick={()=>alert.target&&onSelect(alert.target)}><span className={`command-alert-icon ${alert.kind}`}>{alert.kind==='vehicle'?<AlertTriangle/>:<CircleDollarSign/>}</span><span className="command-alert-copy"><strong>{alert.title}</strong><small>{alert.detail}</small></span><span className={`command-badge ${alert.urgent?'urgent':''}`}>{alert.badge}</span><ChevronRight/></button>)}</div></section>}<div className="command-grid">{cards.map((card,index)=>{const Icon=icons[index];return <button className={`command-card command-${card.id}`} key={card.id} onClick={()=>navigate(card.id)}><span className="command-card-top"><Icon/><strong>{card.rows.length}</strong></span><h2>{card.title}</h2><p>{card.summary}</p><span className="command-link">View Details <ChevronRight/></span></button>})}</div>{quickActions}{nationalFireActivity}</>}
  </div>;
}
