import {Check, Circle, ClipboardCheck, FileText, ReceiptText, ShoppingBag, Wallet, X} from 'lucide-react';
import {canInspectVehicle,canManagePersonalTasks,isCompanyManager,type CrewMember,type FireOpsUser} from '@fireops/domain';
import {useAvailability} from './useAvailability';
export type QuickAction = 'tasks'|'availability'|'inspections'|'inventory'|'payroll'|'receipts'|'invoices';
export function QuickActions({companyId,user,onOpen,onInspect}:{companyId?:string;user:FireOpsUser;onOpen:(page:QuickAction)=>void;onInspect:()=>void}) {
  const {statuses,loading,error} = useAvailability(companyId);
  const status = statuses[user.id];
  const actions = [{id:'availability',label:'Availability',Icon:Circle},...(canManagePersonalTasks(user.role)?[{id:'tasks',label:'Task List',Icon:ClipboardCheck} as const]:[]),...(isCompanyManager(user.role)?[{id:'inspections',label:'Inspections',Icon:ClipboardCheck} as const]:[]),{id:'inventory',label:'Check Out Gear',Icon:ShoppingBag},{id:'payroll',label:'Payroll',Icon:Wallet},{id:'receipts',label:'Receipts',Icon:ReceiptText},{id:'invoices',label:'Invoices',Icon:FileText}] as const;
  return <section className="quick-actions" aria-labelledby="quick-actions-title"><h2 id="quick-actions-title">Quick Actions</h2><div className="quick-actions-grid">{actions.flatMap(({id,label,Icon},index)=>[...(index===1&&canInspectVehicle(user.role)&&!isCompanyManager(user.role)?[<button key="inspect" className="quick-action quick-action-inspect" onClick={onInspect}><span className="quick-action-icon"><ClipboardCheck/></span><strong>Inspect</strong></button>]:[]),<button key={id} className={`quick-action quick-action-${id}`} onClick={()=>onOpen(id)}><span className="quick-action-icon"><Icon/></span><strong>{label}</strong>{id==='availability' && <span className="quick-action-status">{isCompanyManager(user.role) ? 'Crew readiness' : loading ? 'Loading…' : error ? 'Status unavailable' : status === undefined ? 'Not set' : status ? 'Available' : 'Unavailable'}</span>}</button>])}</div></section>;
}
export function AvailabilityPage({companyId,user,crew}:{companyId?:string;user:FireOpsUser;crew:CrewMember[]}) {
  const {statuses,loading,error,busy,save,retry} = useAvailability(companyId);
  const owner = isCompanyManager(user.role);
  const members = crew.filter(member=>member.role !== 'owner' && member.status === 'Active');
  const status = statuses[user.id];
  const label = (value:boolean|undefined)=>value===undefined?'Not set':value?'Available':'Unavailable';
  const controls = (id:string)=><div className="availability-controls">{[true,false].map(value=><button key={String(value)} className={value?'availability-yes':'availability-no'} disabled={busy || loading || !companyId} aria-pressed={statuses[id]===value} onClick={()=>void save(id,value)}>{value?<Check/>:<X/>}{`Show Me As ${value?'Available':'Unavailable'}`}</button>)}</div>;
  const ownerControl = (id:string)=>{const current=statuses[id];const next=current!==true;return <button className={current===undefined?'availability-unset':current===false?'availability-no':'availability-yes'} disabled={busy || loading || !companyId} aria-label={`${current===undefined?'Set':'Change'} status to ${label(next)}`} onClick={()=>void save(id,next)}>{current===false?<X/>:<Check/>}{current===undefined?'Set Available':label(current)}</button>};
  return <div className="page availability-page"><div className="page-heading"><div><h1>{owner?'Crew Availability':'Assignment Availability'}</h1>{!owner&&<p>Your selection is shared immediately with your company.</p>}</div></div>
    {error && <p role="alert" className="receipt-error">{error} <button className="secondary" onClick={retry}>Retry</button></p>}
    {!companyId && <p>Connect a company account to save availability.</p>}
    {loading ? <p>Loading availability…</p> : owner ? <div className="availability-roster">{members.map(member=><article key={member.id}><h2>{member.name}</h2>{ownerControl(member.id)}</article>)}{!members.length && <p>No active crew members yet.</p>}</div> : <section className="availability-self"><Circle size={64}/><h2 aria-live="polite">{status===undefined?'Your availability is not set':`You Are Currently ${label(status)}`}</h2>{controls(user.id)}</section>}
  </div>;
}
