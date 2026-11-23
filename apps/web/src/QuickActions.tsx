import {useState} from 'react';
import {Check, Circle, ClipboardCheck, FileText, Search, ShieldCheck, ShoppingBag, Wallet, X} from 'lucide-react';
import {canInspectVehicle,canManagePersonalTasks,isCompanyManager,keepsInventoryInMainNav,type CrewMember,type FireOpsUser} from '@fireops/domain';
import {useAvailability} from './useAvailability';
import {useTaskCount} from './useTaskCount';
import {useDashboardPreferences} from './useDashboardPreferences';
export type QuickAction = 'tasks'|'availability'|'inventory'|'payroll'|'invoices';
export function QuickActions({demoMode=false,companyId,user,onOpen,onInspect}:{demoMode?:boolean;companyId?:string;user:FireOpsUser;onOpen:(page:QuickAction)=>void;onInspect:()=>void}) {
  const {visible}=useDashboardPreferences(user.id,demoMode);
  const {statuses,loading,error,verified} = useAvailability(companyId,user.id);
  const taskCount = useTaskCount(canManagePersonalTasks(user.role)?companyId:undefined,canManagePersonalTasks(user.role)?user.id:undefined);
  const status = statuses[user.id];
  // Same set and order for everyone: Inventory and Failed Inspections moved to More and Receipts lives on More.
  // Resource Bosses and shop techs keep Inventory.
  const actions = [{id:'availability',label:'Availability',Icon:Circle},...(canManagePersonalTasks(user.role)?[{id:'tasks',label:'Task List',Icon:ClipboardCheck} as const]:[]),...(keepsInventoryInMainNav(user.role)?[{id:'inventory',label:'Inventory',Icon:ShoppingBag} as const]:[]),{id:'payroll',label:'Payroll',Icon:Wallet},{id:'invoices',label:'Invoices',Icon:FileText}] as const;
  if(!actions.some(action=>visible(action.id))&&!(canInspectVehicle(user.role)&&visible('inspections')))return null;
  return <section className="quick-actions" aria-labelledby="quick-actions-title"><h2 id="quick-actions-title">Quick Actions</h2><div className="quick-actions-grid">{actions.flatMap(({id,label,Icon},index)=>[...(index===1&&visible('inspections')&&canInspectVehicle(user.role)&&!isCompanyManager(user.role)?[<button key="inspect" className="quick-action quick-action-inspect" onClick={onInspect}><span className="quick-action-icon"><ShieldCheck/></span><strong>Inspect</strong></button>]:[]),...(visible(id)?[<button key={id} className={`quick-action quick-action-${id}${id==='tasks'&&taskCount?.overdue?' urgent':''}`} onClick={()=>onOpen(id)}><span className="quick-action-icon"><Icon/>{id==='tasks'&&taskCount!==null&&<span className="quick-action-count" aria-label={`${taskCount.count} open tasks`}>{taskCount.count}</span>}</span><strong>{label}</strong>{id==='tasks'&&!!taskCount?.overdue&&<span className="sr-only">{taskCount.overdue} overdue</span>}{id==='availability' && <span className="quick-action-status">{isCompanyManager(user.role) ? 'Crew readiness' : loading ? 'Loading…' : error||!verified ? 'Status unavailable' : status === undefined ? 'Not set' : status ? 'Available' : 'Unavailable'}</span>}</button>]:[])])}</div></section>;
}
export function AvailabilityPage({companyId,user,crew}:{companyId?:string;user:FireOpsUser;crew:CrewMember[]}) {
  const {statuses,loading,error,busy,save,retry,canSave,pending,note,verified} = useAvailability(companyId,user.id);
  const [query,setQuery] = useState('');
  const owner = isCompanyManager(user.role);
  const members = crew.filter(member=>member.role !== 'owner' && member.status === 'Active').sort((a,b)=>a.name.localeCompare(b.name));
  const shown = members.filter(member=>member.name.toLowerCase().includes(query.trim().toLowerCase()));
  const availableCount = members.filter(member=>statuses[member.id]===true).length;
  const unsetCount = members.filter(member=>statuses[member.id]===undefined).length;
  const status = statuses[user.id];
  const label = (value:boolean|undefined)=>value===undefined?'Not set':value?'Available':'Unavailable';
  const controls = (id:string)=><div className="availability-controls">{[true,false].map(value=><button key={String(value)} className={value?'availability-yes':'availability-no'} disabled={!canSave(id)} aria-pressed={statuses[id]===value} onClick={()=>void save(id,value)}>{value?<Check/>:<X/>}{`Show Me As ${value?'Available':'Unavailable'}`}</button>)}</div>;
  // Managers see each person's status and an action that says what clicking does; changes are confirmed.
  const ownerControl = (member:CrewMember)=>{const current=statuses[member.id];const next=current!==true;return <><span className={`availability-badge ${current===undefined?'unset':current?'yes':'no'}`}>{!verified?(current===undefined?'Status unavailable':`Last known: ${label(current)}`):label(current)}</span><button className="secondary availability-action" disabled={!canSave(member.id)} onClick={()=>{if(window.confirm(`Mark ${member.name} ${label(next).toLowerCase()}? Their availability changes for the whole company.`))void save(member.id,next)}}>{`Mark ${label(next).toLowerCase()}`}</button></>};
  return <div className="page availability-page"><div className="page-heading hero-heading"><div><h1>{owner?'Crew Availability':'Assignment Availability'}</h1>{!owner&&<p>Your selection is shared immediately with your company.</p>}</div></div>
    {pending&&<p role="status">Submitted availability for {crew.find(member=>member.id===pending.request.userId)?.name??'the selected member'}: {label(pending.request.available)}. {pending.acknowledged?(pending.keptCurrent?'Server kept a different value; refresh pending.':'Server accepted this choice; refresh pending.'):'Not yet confirmed. Keep this page open.'}</p>}
    {note&&<p role="status">{note}</p>}
    {error && <p role="alert" className="receipt-error">{error} <button className="secondary" disabled={busy} onClick={()=>void retry()}>{pending?.acknowledged?'Retry refresh':pending?'Retry original choice':'Retry'}</button></p>}
    {!companyId && <p>Connect a company account to save availability.</p>}
    {loading ? <p>Loading availability…</p> : owner ? <div className="availability-roster">{members.length>0&&<div className="availability-tools"><p>{availableCount} of {members.length} available{unsetCount?` · ${unsetCount} not set`:''}</p><label className="stock-search"><Search/><span className="sr-only">Search crew</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search crew"/>{query&&<button type="button" onClick={()=>setQuery('')} aria-label="Clear crew search"><X/></button>}</label></div>}{shown.map(member=><article key={member.id} className="availability-row"><h2>{member.name}</h2>{ownerControl(member)}</article>)}{!members.length ? <p>No active crew members yet.</p> : !shown.length && <p>No crew match “{query.trim()}”.</p>}</div> : <section className="availability-self"><Circle size={64}/><h2 aria-live="polite">{!verified?'Your availability is not verified':status===undefined?'Your availability is not set':`You Are Currently ${label(status)}`}</h2>{controls(user.id)}</section>}
  </div>;
}
