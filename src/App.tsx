import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarDays, CarFront, Check, ChevronRight,
  CircleAlert, CircleUserRound, Clock3, FileImage, FileText, Hash, LayoutDashboard, Mail, Menu, MessageSquare, MoreHorizontal, Pencil, Phone, Plus,
  Search, ShieldCheck, SlidersHorizontal, Truck, Upload, UserPlus, Users, Wrench, X
} from 'lucide-react';

type Status = 'Ready' | 'Assigned' | 'Maintenance' | 'Out of service';
type Page = 'overview' | 'vehicles' | 'issues' | 'crew' | 'company';
type UserRole = 'owner' | 'member';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type IssueStatus = 'Open' | 'Resolved';
type VehicleFile = {name: string; type: string; dataUrl: string};
type CrewStatus = 'Active' | 'Invited';
type CrewMember = {
  id: string; name: string; email: string; phone: string; role: UserRole; status: CrewStatus;
  credential?: VehicleFile; credentialName?: string; joinedAt?: string;
};
type Vehicle = {
  id: string; unit: string; type: string; year: number; make: string; model: string;
  vin: string; plate: string; status: Status; photo?: VehicleFile; contract?: VehicleFile;
  viprChecklist?: VehicleFile; registration?: VehicleFile; insurance?: VehicleFile;
  dotInspection?: VehicleFile; notes?: string; createdAt: string; assignedTo?: string;
};
type IssueUpdate = {id: string; text: string; createdBy: string; createdAt: string};
type FleetIssue = {
  id: string; vehicleId: string; title: string; description: string; priority: Priority;
  status: IssueStatus; resolvedAt?: string; updates: IssueUpdate[]; createdBy: string; createdAt: string;
};
type Activity = {
  id: string; action: string; detail: string; createdBy: string; createdAt: string;
  targetType?: 'vehicle' | 'issue' | 'crew'; targetId?: string; tone?: 'urgent' | 'complete';
};

const seed: Vehicle[] = [
  {id:'v1',unit:'Engine 701',type:'Type 3 Engine',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',status:'Ready',createdAt:'2025-02-04'},
  {id:'v2',unit:'Tender 12',type:'Water Tender',year:2017,make:'Peterbilt',model:'367',vin:'1XPTD4EX8HD397122',plate:'CA 8T012',status:'Assigned',createdAt:'2025-01-18'},
  {id:'v3',unit:'Dozer 4',type:'Dozer',year:2014,make:'Caterpillar',model:'D7R',vin:'CAT00D7RJLGP01234',plate:'',status:'Maintenance',createdAt:'2024-12-11'}
];
const types = ['Type 3 Engine','Type 4 Engine','Type 6 Engine','Water Tender','Crew Carrier','Dozer','Transport','Support Vehicle','Other'];
const statuses: Status[] = ['Ready','Assigned','Maintenance','Out of service'];
const priorities: Priority[] = ['Low','Medium','High','Critical'];
const currentUser: {id: string; name: string; role: UserRole} = {id: 'u1', name: 'Ryan Mitchell', role: 'owner'};
const seedCrew: CrewMember[] = [
  {id:'u1',name:'Ryan Mitchell',email:'ryan@northridgewildfire.com',phone:'(530) 555-0142',role:'owner',status:'Active',joinedAt:'2024-11-08'},
  {id:'u2',name:'Maya Torres',email:'maya@northridgewildfire.com',phone:'(530) 555-0198',role:'member',status:'Active',credentialName:'Red Card',joinedAt:'2025-01-16'},
  {id:'u3',name:'Cole Bennett',email:'cole@northridgewildfire.com',phone:'(530) 555-0117',role:'member',status:'Active',joinedAt:'2025-02-02'}
];

function loadVehicles() {
  try { const stored = localStorage.getItem('fireops-vehicles'); return stored ? JSON.parse(stored) as Vehicle[] : seed; }
  catch { return seed; }
}
function loadCrew() {
  try { const stored = localStorage.getItem('fireops-crew'); return stored ? JSON.parse(stored) as CrewMember[] : seedCrew; }
  catch { return seedCrew; }
}
function loadActivities() {
  try {
    const stored = localStorage.getItem('fireops-activities');
    if (stored) return JSON.parse(stored) as Activity[];
    const vehicles = localStorage.getItem('fireops-vehicles') ? JSON.parse(localStorage.getItem('fireops-vehicles')!) as Vehicle[] : seed;
    const issues = localStorage.getItem('fireops-issues') ? JSON.parse(localStorage.getItem('fireops-issues')!) as FleetIssue[] : [];
    const history: Activity[] = vehicles.map(vehicle=>({id:`vehicle-${vehicle.id}`,action:`${vehicle.unit} added to fleet`,detail:'Vehicle record created',createdBy:'Ryan Mitchell',createdAt:vehicle.createdAt,targetType:'vehicle',targetId:vehicle.id,tone:'complete'}));
    issues.forEach(issue=>{history.push({id:`issue-${issue.id}`,action:`Issue reported: ${issue.title}`,detail:`${issue.priority} priority`,createdBy:issue.createdBy,createdAt:issue.createdAt,targetType:'issue',targetId:issue.id,tone:'urgent'});issue.updates?.forEach(update=>history.push({id:`update-${update.id}`,action:`Issue updated: ${issue.title}`,detail:update.text,createdBy:update.createdBy,createdAt:update.createdAt,targetType:'issue',targetId:issue.id,tone:issue.resolvedAt===update.createdAt?'complete':'urgent'}))});
    return history.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  } catch { return []; }
}
function loadIssues() {
  try {
    const stored = localStorage.getItem('fireops-issues');
    const parsed = stored ? JSON.parse(stored) as Partial<FleetIssue>[] : [];
    return parsed.map(issue => {
      const status = issue.status??'Open';
      const updates = issue.updates??[];
      return {...issue, status, updates, resolvedAt: status==='Resolved' ? issue.resolvedAt??updates[0]?.createdAt??issue.createdAt : undefined};
    }) as FleetIssue[];
  } catch { return []; }
}

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>(loadVehicles);
  const [issues, setIssues] = useState<FleetIssue[]>(loadIssues);
  const [crew, setCrew] = useState<CrewMember[]>(loadCrew);
  const [activities, setActivities] = useState<Activity[]>(loadActivities);
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'All'>('All');
  const [formOpen, setFormOpen] = useState(false);
  const [issueFormOpen, setIssueFormOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<FleetIssue | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<CrewMember | null>(null);
  const [notice, setNotice] = useState('');
  const canManageFleet = currentUser.role === 'owner';
  useEffect(() => localStorage.setItem('fireops-vehicles', JSON.stringify(vehicles)), [vehicles]);
  useEffect(() => localStorage.setItem('fireops-issues', JSON.stringify(issues)), [issues]);
  useEffect(() => localStorage.setItem('fireops-crew', JSON.stringify(crew)), [crew]);
  useEffect(() => localStorage.setItem('fireops-activities', JSON.stringify(activities)), [activities]);
  const logActivity = (activity: Omit<Activity,'id'|'createdAt'|'createdBy'>) => setActivities(items => [{...activity,id:crypto.randomUUID(),createdBy:currentUser.name,createdAt:new Date().toISOString()},...items]);
  const filtered = useMemo(() => vehicles.filter(v => {
    const text = `${v.unit} ${v.type} ${v.make} ${v.model} ${v.year} ${v.plate}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === 'All' || v.status === filter);
  }), [vehicles, query, filter]);
  const addVehicle = (vehicle: Vehicle) => {
    setVehicles(v => [vehicle, ...v]); logActivity({action:`${vehicle.unit} added to fleet`,detail:'Vehicle record created',targetType:'vehicle',targetId:vehicle.id,tone:'complete'}); setFormOpen(false); setNotice(`${vehicle.unit} added to inventory`);
    setTimeout(() => setNotice(''), 3200);
  };
  const addIssue = (issue: FleetIssue) => {
    const vehicle=vehicles.find(item=>item.id===issue.vehicleId);setIssues(items => [issue, ...items]); logActivity({action:`Issue reported: ${issue.title}`,detail:`${vehicle?.unit??'Unknown vehicle'} · ${issue.priority} priority`,targetType:'issue',targetId:issue.id,tone:'urgent'}); setIssueFormOpen(false); setNotice('Issue created');
    setTimeout(() => setNotice(''), 3200);
  };
  const updateIssue = (issue: FleetIssue) => {
    const previous=issues.find(item=>item.id===issue.id);const vehicle=vehicles.find(item=>item.id===issue.vehicleId);const statusChanged=previous?.status!==issue.status;const action=statusChanged?(issue.status==='Resolved'?`Issue resolved: ${issue.title}`:`Issue reopened: ${issue.title}`):`Issue updated: ${issue.title}`;
    setIssues(items => items.map(item => item.id === issue.id ? issue : item));
    logActivity({action,detail:`${vehicle?.unit??'Unknown vehicle'} · ${issue.updates[0]?.text??'Issue record updated'}`,targetType:'issue',targetId:issue.id,tone:issue.status==='Resolved'?'complete':'urgent'}); setSelectedIssue(issue); setNotice('Issue updated');
    setTimeout(() => setNotice(''), 3200);
  };
  const updateVehicle = (vehicle: Vehicle) => {
    setVehicles(v => v.map(item => item.id === vehicle.id ? vehicle : item));
    logActivity({action:`${vehicle.unit} details updated`,detail:'Vehicle record changed',targetType:'vehicle',targetId:vehicle.id,tone:'complete'}); setEditing(null); setNotice(`${vehicle.unit} details updated`);
    setTimeout(() => setNotice(''), 3200);
  };
  const updateStatus = (id: string, status: Status) => {
    if (!canManageFleet) return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||vehicle.status===status)return;
    setVehicles(v => v.map(item => item.id === id ? {...item, status, assignedTo: status === 'Assigned' ? item.assignedTo : undefined} : item));
    logActivity({action:`${vehicle.unit} status changed to ${status}`,detail:`Previous status: ${vehicle.status}`,targetType:'vehicle',targetId:id,tone:['Maintenance','Out of service'].includes(status)?'urgent':'complete'});
    setSelected(v => v?.id === id ? {...v, status, assignedTo: status === 'Assigned' ? v.assignedTo : undefined} : v);
  };
  const assignToMe = (id: string) => {
    if (selected?.assignedTo && selected.assignedTo !== currentUser.id) return;
    const assignedTo = selected?.assignedTo === currentUser.id ? undefined : currentUser.id;
    const status: Status = assignedTo ? 'Assigned' : 'Ready';
    setVehicles(items => items.map(item => item.id === id ? {...item, assignedTo, status} : item));
    logActivity({action:assignedTo?`${currentUser.name} assigned ${selected?.unit} to themselves`:`${currentUser.name} unassigned ${selected?.unit}`,detail:assignedTo?'Vehicle is now in use':'Vehicle returned to ready status',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item => item?.id === id ? {...item, assignedTo, status} : item);
    setNotice(assignedTo ? 'Vehicle assigned to you' : 'Vehicle assignment removed');
    setTimeout(() => setNotice(''), 3200);
  };
  const inviteCrew = (member: CrewMember) => {
    setCrew(items => [...items, member]); logActivity({action:`${member.name} invited to company`,detail:member.email,targetType:'crew',targetId:member.id,tone:'complete'}); setInviteOpen(false); setNotice(`Invitation sent to ${member.email}`);
    setTimeout(() => setNotice(''), 3200);
  };
  const updateCrew = (member: CrewMember) => {
    setCrew(items => items.map(item => item.id === member.id ? member : item)); logActivity({action:`Credentials updated for ${member.name}`,detail:member.credentialName||member.credential?.name||'Credential record updated',targetType:'crew',targetId:member.id,tone:'complete'}); setSelectedCrew(member); setNotice('Crew credentials updated');
    setTimeout(() => setNotice(''), 3200);
  };

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage}/>
    <div className="app-main">
      <Topbar onMenu={() => {}} />
      <main>
        {page === 'vehicles' && <VehiclesPage vehicles={vehicles} issues={issues} crew={crew} filtered={filtered} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} canManage={canManageFleet} onAdd={() => setFormOpen(true)} onSelect={setSelected}/>}
        {page === 'overview' && <Overview vehicles={vehicles} issues={issues} crew={crew} activities={activities} isOwner={canManageFleet} onSelectVehicle={setSelected} onSelectIssue={setSelectedIssue} onSelectCrew={setSelectedCrew}/>}
        {page === 'issues' && <IssuesPage issues={issues} vehicles={vehicles} onNew={() => setIssueFormOpen(true)} onSelect={setSelectedIssue}/>}
        {page === 'crew' && canManageFleet && <CrewPage crew={crew} vehicles={vehicles} onInvite={() => setInviteOpen(true)} onSelect={setSelectedCrew}/>}
        {page === 'company' && <Company onInvite={canManageFleet ? () => setInviteOpen(true) : undefined}/>}
      </main>
      <MobileNav page={page} setPage={setPage}/>
    </div>
    {formOpen && canManageFleet && <VehicleForm onClose={() => setFormOpen(false)} onSave={addVehicle}/>}
    {editing && canManageFleet && <VehicleForm vehicle={editing} onClose={() => setEditing(null)} onSave={updateVehicle}/>}
    {issueFormOpen && <IssueForm vehicles={vehicles} onClose={() => setIssueFormOpen(false)} onSave={addIssue}/>}
    {inviteOpen && canManageFleet && <InviteCrewForm existing={crew} onClose={() => setInviteOpen(false)} onSave={inviteCrew}/>}
    {selected && <VehicleDetail vehicle={selected} issues={issues.filter(issue => issue.vehicleId === selected.id)} crew={crew} canManage={canManageFleet} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null)}} onIssue={issue => {setSelected(null);setSelectedIssue(issue)}} onStatus={s => updateStatus(selected.id, s)} onAssign={() => assignToMe(selected.id)}/>}
    {selectedIssue && <IssueDetail issue={selectedIssue} vehicle={vehicles.find(v => v.id === selectedIssue.vehicleId)} onClose={() => setSelectedIssue(null)} onSave={updateIssue}/>}
    {selectedCrew && canManageFleet && <CrewDetail member={selectedCrew} assignedVehicles={vehicles.filter(vehicle => vehicle.assignedTo === selectedCrew.id)} onClose={() => setSelectedCrew(null)} onSave={updateCrew}/>}
    {notice && <div className="toast"><span><Check size={16}/></span>{notice}</div>}
  </div>;
}

function Brand() { return <div className="brand"><div className="brand-mark"><span/></div><b>FIREOPS</b></div> }
function Sidebar({page,setPage}:{page:Page;setPage:(p:Page)=>void}) {
  return <aside className="sidebar"><Brand/><nav>
    <NavItem icon={<LayoutDashboard/>} label="Overview" active={page==='overview'} onClick={()=>setPage('overview')}/>
    <NavItem icon={<Truck/>} label="Fleet" active={page==='vehicles'} onClick={()=>setPage('vehicles')}/>
    <NavItem icon={<CircleAlert/>} label="Issues" active={page==='issues'} onClick={()=>setPage('issues')}/>
    {currentUser.role==='owner'&&<NavItem icon={<Users/>} label="Crew" active={page==='crew'} onClick={()=>setPage('crew')}/>}
    <NavItem icon={<Building2/>} label="Company" active={page==='company'} onClick={()=>setPage('company')}/>
  </nav><div className="sidebar-foot"><div className="avatar">RM</div><div><b>Ryan Mitchell</b><span>Company owner</span></div><MoreHorizontal size={18}/></div></aside>
}
function NavItem({icon,label,active,onClick}:{icon:React.ReactNode;label:string;active:boolean;onClick:()=>void}) {
  return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>
}
function Topbar({onMenu}:{onMenu:()=>void}) {
  return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Menu/></button><div className="mobile-brand"><Brand/></div><div className="topbar-right"><div className="top-user-name">{currentUser.name}</div></div></header>
}

function VehiclesPage({vehicles,issues,crew,filtered,query,setQuery,filter,setFilter,canManage,onAdd,onSelect}:{vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];filtered:Vehicle[];query:string;setQuery:(v:string)=>void;filter:Status|'All';setFilter:(v:Status|'All')=>void;canManage:boolean;onAdd:()=>void;onSelect:(v:Vehicle)=>void}) {
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Fleet management</span><h1>Fleet</h1><p>Manage company vehicles and apparatus in one place.</p></div>{canManage&&<button className="primary desktop-add" onClick={onAdd}><Plus size={19}/> Add vehicle</button>}</div>
    <section className="stats-row">
      <Stat label="Total vehicles" value={vehicles.length} icon={<Truck/>}/>
      <Stat label="Ready" value={vehicles.filter(v=>v.status==='Ready').length} icon={<Check/>} tone="green"/>
      <Stat label="Needs attention" value={vehicles.filter(v=>['Maintenance','Out of service'].includes(v.status)).length} icon={<Wrench/>} tone="amber"/>
    </section>
    <section className="inventory-panel"><div className="inventory-tools"><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search vehicles" aria-label="Search vehicles"/>{query&&<button onClick={()=>setQuery('')}><X size={16}/></button>}</div><div className="filter-wrap"><SlidersHorizontal size={17}/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'All')} aria-label="Filter by status"><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="list-label"><b>{filtered.length} {filtered.length===1?'vehicle':'vehicles'}</b><span>Updated now</span></div>
      <div className="vehicle-list">{filtered.map(v=><VehicleCard key={v.id} vehicle={v} assignedName={crew.find(member=>member.id===v.assignedTo)?.name} issueCount={issues.filter(issue=>issue.vehicleId===v.id&&issue.status==='Open').length} onClick={()=>onSelect(v)}/>)}
      {!filtered.length && <div className="empty"><Search/><h3>No vehicles found</h3><p>Try another search or clear current filter.</p><button className="secondary" onClick={()=>{setQuery('');setFilter('All')}}>Clear filters</button></div>}</div>
    </section>
    {canManage&&<button className="fab" onClick={onAdd}><Plus/> <span>Add vehicle</span></button>}
  </div>
}
function IssuesPage({issues,vehicles,onNew,onSelect}:{issues:FleetIssue[];vehicles:Vehicle[];onNew:()=>void;onSelect:(issue:FleetIssue)=>void}) {
  const vehicleName=(id:string)=>vehicles.find(v=>v.id===id)?.unit??'Unknown vehicle';
  const openIssues=issues.filter(issue=>issue.status==='Open');
  const monthAgo=Date.now()-30*24*60*60*1000;
  const resolvedIssues=issues.filter(issue=>issue.status==='Resolved'&&Date.parse(issue.resolvedAt??issue.createdAt)>=monthAgo).sort((a,b)=>Date.parse(b.resolvedAt??b.createdAt)-Date.parse(a.resolvedAt??a.createdAt));
  const IssueRow=({issue}:{issue:FleetIssue})=><button className="issue-card" onClick={()=>onSelect(issue)}><div className={`priority-icon ${issue.status==='Resolved'?'resolved':issue.priority.toLowerCase()}`}>{issue.status==='Resolved'?<Check/>:<AlertTriangle/>}</div><div className="issue-copy"><div className="issue-title"><h3>{issue.title}</h3><div className="issue-badges"><span className={`issue-status ${issue.status.toLowerCase()}`}>{issue.status}</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority}</span></div></div><p>{issue.description}</p><div className="issue-meta"><b>{vehicleName(issue.vehicleId)}</b><span>Reported by {issue.createdBy}</span><span>{issue.updates.length} {issue.updates.length===1?'update':'updates'}</span><span>{new Date(issue.status==='Resolved'?(issue.resolvedAt??issue.createdAt):issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div></div><ChevronRight className="card-arrow"/></button>;
  return <div className="page issues-page"><div className="page-heading"><div><span className="eyebrow">Fleet reporting</span><h1>Issues</h1><p>Report and review vehicle issues.</p></div><button className="primary desktop-add" onClick={onNew}><Plus size={19}/> New issue</button></div>
    <section className="issues-panel"><div className="list-label"><b>Current issues</b><span>{openIssues.length} open</span></div><div className="issue-list">{openIssues.map(issue=><IssueRow issue={issue} key={issue.id}/>)}{!openIssues.length&&<div className="empty compact-empty"><Check/><h3>No open issues</h3><p>Fleet has no current reported issues.</p><button className="secondary" onClick={onNew}>New issue</button></div>}</div></section>
    <section className="issues-panel resolved-panel"><div className="list-label"><b>Resolved</b><span>Last 30 days</span></div><div className="issue-list">{resolvedIssues.map(issue=><IssueRow issue={issue} key={issue.id}/>)}{!resolvedIssues.length&&<div className="empty compact-empty"><Check/><h3>No recently resolved issues</h3><p>Resolved issues remain here for 30 days.</p></div>}</div></section>
    <button className="fab" onClick={onNew}><Plus/> <span>New issue</span></button>
  </div>
}
function Stat({label,value,icon,tone='dark'}:{label:string;value:number;icon:React.ReactNode;tone?:string}) {return <div className="stat"><div className={`stat-icon ${tone}`}>{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>}
function VehicleCard({vehicle,assignedName,issueCount,onClick}:{vehicle:Vehicle;assignedName?:string;issueCount:number;onClick:()=>void}) {
  return <button className="vehicle-card" onClick={onClick}><div className="vehicle-icon">{vehicle.photo?<img src={vehicle.photo.dataUrl} alt=""/>:vehicle.type==='Dozer'?<Wrench/>:<Truck/>}</div><div className="vehicle-info"><div className="vehicle-title"><h3>{vehicle.unit}</h3><StatusBadge status={vehicle.status}/></div><p>{vehicle.year} {vehicle.make} {vehicle.model}</p><div className="vehicle-meta"><span><CarFront/> {vehicle.type}</span>{assignedName&&<span className="vehicle-assignee"><CircleUserRound/> {assignedName}</span>}<span className={issueCount?'open-issues':''}><CircleAlert/> {issueCount} open {issueCount===1?'issue':'issues'}</span></div></div><ChevronRight className="card-arrow"/></button>
}
function StatusBadge({status}:{status:Status}) {return <span className={`status ${status.toLowerCase().replace(/ /g,'-')}`}><i/>{status}</span>}

function Overview({vehicles,issues,crew,activities,isOwner,onSelectVehicle,onSelectIssue,onSelectCrew}:{vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];activities:Activity[];isOwner:boolean;onSelectVehicle:(v:Vehicle)=>void;onSelectIssue:(issue:FleetIssue)=>void;onSelectCrew:(member:CrewMember)=>void}) {
  const neededVehicles = vehicles.filter(v => v.status === 'Maintenance' || v.status === 'Out of service');
  const openIssues = issues.filter(issue => issue.status === 'Open');
  const neededCount = neededVehicles.length + openIssues.length;
  const openActivity=(activity:Activity)=>{if(activity.targetType==='vehicle'){const vehicle=vehicles.find(item=>item.id===activity.targetId);if(vehicle)onSelectVehicle(vehicle)}if(activity.targetType==='issue'){const issue=issues.find(item=>item.id===activity.targetId);if(issue)onSelectIssue(issue)}if(activity.targetType==='crew'){const member=crew.find(item=>item.id===activity.targetId);if(member)onSelectCrew(member)}};
  const formatDate = (date:string) => new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="page overview-page"><div className="page-heading"><div><span className="eyebrow">Operations</span><h1>Overview</h1><p>Stay on top of required work and recent activity.</p></div></div>
    <section className="action-section"><div className="action-heading"><div><h2>Needed actions</h2><p>Items requiring attention</p></div><span className="action-count">{neededCount}</span></div>
      <div className="action-list">{openIssues.map(issue=><button className="action-row" key={`issue-${issue.id}`} onClick={()=>onSelectIssue(issue)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{issue.title}</b><small>{vehicles.find(v=>v.id===issue.vehicleId)?.unit??'Unknown vehicle'} · {issue.priority} priority · Open issue</small></span><ChevronRight/></button>)}{neededVehicles.map(v=><button className="action-row" key={`vehicle-${v.id}`} onClick={()=>onSelectVehicle(v)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{v.status === 'Out of service' ? `Resolve out-of-service status for ${v.unit}` : `Complete maintenance for ${v.unit}`}</b><small>{v.year} {v.make} {v.model} · {v.status}</small></span><ChevronRight/></button>)}
      {!neededCount&&<div className="action-empty"><span><Check/></span><div><b>All caught up</b><p>No fleet actions need attention.</p></div></div>}</div>
    </section>
    {isOwner&&<section className="action-section"><div className="action-heading"><div><h2>Recent actions</h2><p>Activity from everyone in your company</p></div></div>
      <div className="action-list">{activities.slice(0,10).map(activity=><button className="action-row" key={activity.id} onClick={()=>openActivity(activity)}><span className={`action-icon ${activity.tone??'complete'}`}>{activity.tone==='urgent'?<AlertTriangle/>:<Check/>}</span><span className="action-copy"><b>{activity.action}</b><small>{activity.createdBy} · {activity.detail}</small></span><span className="action-time"><Clock3/>{formatDate(activity.createdAt)}</span><ChevronRight/></button>)}{!activities.length&&<div className="action-empty"><span><Clock3/></span><div><b>No recent actions</b><p>Company activity will appear here.</p></div></div>}</div>
    </section>}
  </div>
}
function Company({onInvite}:{onInvite?:()=>void}) {return <div className="page"><div className="page-heading"><div><span className="eyebrow">Account</span><h1>Company</h1><p>Business details for your FireOps account.</p></div>{onInvite&&<button className="primary desktop-add" onClick={onInvite}><UserPlus/> Invite user</button>}</div><section className="company-card"><div className="company-logo">NR</div><div><h2>North Ridge Wildfire</h2><p>Wildland fire contractor</p></div><dl><div><dt>Owner</dt><dd>Ryan Mitchell</dd></div><div><dt>Company ID</dt><dd>NRW-2048</dd></div><div><dt>Account plan</dt><dd>Phase 1 testing</dd></div></dl></section>{onInvite&&<button className="fab" onClick={onInvite}><UserPlus/><span>Invite user</span></button>}</div>}

function CrewPage({crew,vehicles,onInvite,onSelect}:{crew:CrewMember[];vehicles:Vehicle[];onInvite:()=>void;onSelect:(member:CrewMember)=>void}) {
  return <div className="page crew-page"><div className="page-heading"><div><span className="eyebrow">Company users</span><h1>Crew</h1><p>Contact details, vehicle assignments, and credentials.</p></div><button className="primary desktop-add" onClick={onInvite}><UserPlus/> Invite user</button></div>
    <section className="stats-row crew-stats"><Stat label="Total crew" value={crew.length} icon={<Users/>}/><Stat label="Active" value={crew.filter(member=>member.status==='Active').length} icon={<Check/>} tone="green"/><Stat label="Invitations" value={crew.filter(member=>member.status==='Invited').length} icon={<Mail/>} tone="amber"/></section>
    <section className="crew-panel"><div className="list-label"><b>Company crew</b><span>{crew.length} people</span></div><div className="crew-list">{crew.map(member=>{const assigned=vehicles.filter(vehicle=>vehicle.assignedTo===member.id);return <button className="crew-row" key={member.id} onClick={()=>onSelect(member)}><span className="crew-avatar">{member.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span><span className="crew-copy"><span className="crew-name"><b>{member.name}</b>{member.role==='owner'&&<em>Owner</em>}<i className={member.status.toLowerCase()}>{member.status}</i></span><small><Mail/> {member.email}</small><small><Phone/> {member.phone||'No phone added'}</small></span><span className="crew-summary"><b>{assigned.length}</b><small>{assigned.length===1?'vehicle':'vehicles'}</small></span><span className={member.credential?'credential-state complete':member.credentialName?'credential-state named':'credential-state'}><ShieldCheck/>{member.credential?.name??member.credentialName??'No credential'}</span><ChevronRight className="card-arrow"/></button>})}</div></section>
    <button className="fab" onClick={onInvite}><UserPlus/><span>Invite user</span></button>
  </div>;
}
function InviteCrewForm({existing,onClose,onSave}:{existing:CrewMember[];onClose:()=>void;onSave:(member:CrewMember)=>void}) {
  const [form,setForm]=useState({email:'',name:'',phone:''});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const submit=(event:React.FormEvent)=>{event.preventDefault();const email=form.email.trim().toLowerCase();const next:Record<string,string>={};if(!/^\S+@\S+\.\S+$/.test(email))next.email='Enter a valid email address';if(existing.some(member=>member.email.toLowerCase()===email))next.email='This user is already on your crew';setErrors(next);if(Object.keys(next).length)return;const fallback=email.split('@')[0].split(/[._-]/).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');onSave({id:crypto.randomUUID(),name:form.name.trim()||fallback,email,phone:form.phone.trim(),role:'member',status:'Invited'})};
  return <div className="overlay"><section className="drawer form-drawer invite-form"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Company access</span><h2>Invite crew member</h2><p>They will receive an email to create their account.</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form onSubmit={submit} noValidate><FormSection number="1" title="Crew details"><div className="form-grid"><Field label="Email address" required error={errors.email} wide><input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})} placeholder="name@company.com" autoFocus/></Field><Field label="Full name" wide><input value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Optional until invite is accepted"/></Field><Field label="Phone" wide><input type="tel" value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})} placeholder="Optional"/></Field></div></FormSection><div className="invite-note"><Mail/><div><b>Email invitation</b><p>Invite remains pending until user signs in and joins North Ridge Wildfire.</p></div></div><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit"><UserPlus/> Send invitation</button></footer></form></section></div>;
}
function CrewDetail({member,assignedVehicles,onClose,onSave}:{member:CrewMember;assignedVehicles:Vehicle[];onClose:()=>void;onSave:(member:CrewMember)=>void}) {
  const [credential,setCredential]=useState<VehicleFile|undefined>(member.credential);
  const [credentialName,setCredentialName]=useState(member.credentialName??'');
  const changed=credential!==member.credential||credentialName!==member.credentialName;
  return <div className="overlay"><section className="drawer detail-drawer crew-detail"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Crew record</span><h2>{member.name}</h2></div><button className="close" onClick={onClose}><X/></button></header><div className="crew-profile"><span className="crew-avatar large">{member.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span><span className={`crew-status ${member.status.toLowerCase()}`}>{member.status}</span><h3>{member.name}</h3><p>{member.role==='owner'?'Company owner':'Crew member'}</p></div><div className="detail-section"><h4>Contact information</h4><dl className="details"><Detail icon={<Mail/>} label="Email" value={member.email}/><Detail icon={<Phone/>} label="Phone" value={member.phone||'Not added'}/></dl></div><div className="detail-section"><h4>Credentials</h4><div className="credential-editor"><Field label="Credential name"><input value={credentialName} onChange={event=>setCredentialName(event.target.value)} placeholder="e.g. Red Card, EMT"/></Field><FileUpload label="Image or PDF" accept="image/*,.pdf,application/pdf" file={credential} onChange={setCredential}/>{credential&&<a href={credential.dataUrl} target="_blank" rel="noreferrer">View current file</a>}</div><button className="primary save-credential" disabled={!changed} onClick={()=>onSave({...member,credential,credentialName:credentialName.trim()})}><ShieldCheck/> Save credentials</button></div><div className="detail-section"><h4>Assigned vehicles</h4>{assignedVehicles.length?<div className="assigned-vehicles">{assignedVehicles.map(vehicle=><div key={vehicle.id}><Truck/><span><b>{vehicle.unit}</b><small>{vehicle.year} {vehicle.make} {vehicle.model}</small></span></div>)}</div>:<p className="no-updates">No vehicles assigned.</p>}</div></section></div>;
}

function VehicleForm({vehicle,onClose,onSave}:{vehicle?:Vehicle;onClose:()=>void;onSave:(v:Vehicle)=>void}) {
  const editing = Boolean(vehicle);
  const [form,setForm]=useState({unit:vehicle?.unit??'',type:vehicle?.type??'Type 3 Engine',year:String(vehicle?.year??new Date().getFullYear()),make:vehicle?.make??'',model:vehicle?.model??'',vin:vehicle?.vin??'',plate:vehicle?.plate??'',status:vehicle?.status??'Ready' as Status,notes:vehicle?.notes??''});
  const [files,setFiles]=useState({photo:vehicle?.photo,contract:vehicle?.contract,viprChecklist:vehicle?.viprChecklist,registration:vehicle?.registration,insurance:vehicle?.insurance,dotInspection:vehicle?.dotInspection});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const updateFile=(key:keyof typeof files,file?:VehicleFile)=>setFiles(current=>({...current,[key]:file}));
  const submit=(e:React.FormEvent)=>{e.preventDefault();const next:Record<string,string>={};if(!form.unit.trim())next.unit='Unit name is required';if(!form.make.trim())next.make='Make is required';if(!form.model.trim())next.model='Model is required';if(!form.year||Number(form.year)<1950||Number(form.year)>new Date().getFullYear()+1)next.year='Enter a valid year';setErrors(next);if(Object.keys(next).length)return;onSave({id:vehicle?.id??crypto.randomUUID(),unit:form.unit.trim(),type:form.type,year:Number(form.year),make:form.make.trim(),model:form.model.trim(),vin:form.vin.trim().toUpperCase(),plate:form.plate.trim().toUpperCase(),status:form.status,...files,notes:form.notes.trim(),createdAt:vehicle?.createdAt??new Date().toISOString(),assignedTo:vehicle?.assignedTo})};
  return <div className="overlay"><section className="drawer form-drawer"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Vehicle inventory</span><h2>{editing?'Edit vehicle':'Add vehicle'}</h2><p>{editing?'Update fleet details for this vehicle.':'Enter basic details. You can update these later.'}</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form onSubmit={submit} noValidate>
    <FormSection number="1" title="Vehicle details"><div className="form-grid"><Field label="Unit name" required error={errors.unit}><input value={form.unit} onChange={e=>update('unit',e.target.value)} placeholder="e.g. Engine 702" autoFocus/></Field><Field label="Vehicle type" required><select value={form.type} onChange={e=>update('type',e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select></Field><Field label="Year" required error={errors.year}><input type="number" inputMode="numeric" value={form.year} onChange={e=>update('year',e.target.value)}/></Field><Field label="Make" required error={errors.make}><input value={form.make} onChange={e=>update('make',e.target.value)} placeholder="e.g. International"/></Field><Field label="Model" required error={errors.model}><input value={form.model} onChange={e=>update('model',e.target.value)} placeholder="e.g. HV"/></Field><Field label="Status"><select value={form.status} onChange={e=>update('status',e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></Field></div></FormSection>
    <FormSection number="2" title="Registration & documents" optional><div className="form-grid"><Field label="VIN"><input value={form.vin} onChange={e=>update('vin',e.target.value)} maxLength={17} placeholder="17-character VIN"/></Field><Field label="License plate"><input value={form.plate} onChange={e=>update('plate',e.target.value)} placeholder="Plate number"/></Field><FileUpload label="Photo" accept="image/*" file={files.photo} onChange={file=>updateFile('photo',file)}/><FileUpload label="Contract" accept="image/*,.pdf,application/pdf" file={files.contract} onChange={file=>updateFile('contract',file)}/><FileUpload label="VIPR Checklist" accept="image/*,.pdf,application/pdf" file={files.viprChecklist} onChange={file=>updateFile('viprChecklist',file)}/><FileUpload label="Registration" accept="image/*,.pdf,application/pdf" file={files.registration} onChange={file=>updateFile('registration',file)}/><FileUpload label="Insurance" accept="image/*,.pdf,application/pdf" file={files.insurance} onChange={file=>updateFile('insurance',file)}/><FileUpload label="DOT Inspection" accept="image/*,.pdf,application/pdf" file={files.dotInspection} onChange={file=>updateFile('dotInspection',file)}/><Field label="Notes" wide><textarea value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="Anything else to know about this vehicle"/></Field></div></FormSection>
    <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit">{editing?<Pencil/>:<Plus/>} {editing?'Save changes':'Add to inventory'}</button></footer>
  </form></section></div>
}
function IssueForm({vehicles,onClose,onSave}:{vehicles:Vehicle[];onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [form,setForm]=useState({vehicleId:vehicles[0]?.id??'',title:'',description:'',priority:'Medium' as Priority});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const submit=(e:React.FormEvent)=>{e.preventDefault();const next:Record<string,string>={};if(!form.vehicleId)next.vehicleId='Select a vehicle';if(!form.title.trim())next.title='Issue title is required';if(!form.description.trim())next.description='Description is required';setErrors(next);if(Object.keys(next).length)return;onSave({id:crypto.randomUUID(),vehicleId:form.vehicleId,title:form.title.trim(),description:form.description.trim(),priority:form.priority,status:'Open',updates:[],createdBy:currentUser.name,createdAt:new Date().toISOString()})};
  return <div className="overlay"><section className="drawer form-drawer issue-form"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Fleet reporting</span><h2>New issue</h2><p>Report a vehicle problem for company review.</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form onSubmit={submit} noValidate><FormSection number="1" title="Issue details"><div className="form-grid"><Field label="Vehicle" required error={errors.vehicleId} wide><select value={form.vehicleId} onChange={e=>update('vehicleId',e.target.value)} autoFocus><option value="">Select a vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.unit} — {v.year} {v.make} {v.model}</option>)}</select></Field><Field label="Issue title" required error={errors.title} wide><input value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Pump losing pressure"/></Field><Field label="Description" required error={errors.description} wide><textarea value={form.description} onChange={e=>update('description',e.target.value)} placeholder="Describe the issue and when it occurs"/></Field><Field label="Priority" required wide><select value={form.priority} onChange={e=>update('priority',e.target.value)}>{priorities.map(p=><option key={p}>{p}</option>)}</select></Field></div></FormSection><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit"><Plus/> Create issue</button></footer></form></section></div>
}
function FormSection({number,title,optional,children}:{number:string;title:string;optional?:boolean;children:React.ReactNode}) {return <fieldset><legend><span>{number}</span>{title}{optional&&<em>Optional</em>}</legend>{children}</fieldset>}
function Field({label,required,error,wide,children}:{label:string;required?:boolean;error?:string;wide?:boolean;children:React.ReactNode}) {return <label className={`${error?'has-error':''} ${wide?'wide':''}`}><span>{label}{required&&<b>*</b>}</span>{children}{error&&<small>{error}</small>}</label>}
function FileUpload({label,accept,file,onChange}:{label:string;accept:string;file?:VehicleFile;onChange:(file?:VehicleFile)=>void}) {
  const selectFile=(selected?:File)=>{if(!selected)return;const reader=new FileReader();reader.onload=()=>onChange({name:selected.name,type:selected.type,dataUrl:String(reader.result)});reader.readAsDataURL(selected)};
  return <div className="upload-field"><span>{label}</span><label className={file?'has-file':''}><input type="file" accept={accept} onChange={e=>selectFile(e.target.files?.[0])}/>{file?(file.type.startsWith('image/')?<FileImage/>:<FileText/>):<Upload/>}<span>{file?.name??'Choose file'}</span></label>{file&&<button type="button" onClick={()=>onChange(undefined)} aria-label={`Remove ${label}`}>Remove</button>}</div>
}

function VehicleDetail({vehicle,issues,crew,canManage,onClose,onEdit,onIssue,onStatus,onAssign}:{vehicle:Vehicle;issues:FleetIssue[];crew:CrewMember[];canManage:boolean;onClose:()=>void;onEdit:()=>void;onIssue:(issue:FleetIssue)=>void;onStatus:(s:Status)=>void;onAssign:()=>void}) {const openIssues=issues.filter(issue=>issue.status==='Open');const resolvedIssues=issues.filter(issue=>issue.status==='Resolved').sort((a,b)=>Date.parse(b.resolvedAt??b.createdAt)-Date.parse(a.resolvedAt??a.createdAt));const documents=[['Contract',vehicle.contract],['VIPR Checklist',vehicle.viprChecklist],['Registration',vehicle.registration],['Insurance',vehicle.insurance],['DOT Inspection',vehicle.dotInspection]] as const;return <div className="overlay"><section className="drawer detail-drawer"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Vehicle record</span><h2>{vehicle.unit}</h2></div><div className="detail-actions">{canManage&&<button className="edit-vehicle" onClick={onEdit}><Pencil/> Edit</button>}<button className="close" onClick={onClose}><X/></button></div></header><div className="detail-hero"><div className={`large-vehicle-icon ${vehicle.photo?'has-photo':''}`}>{vehicle.photo?<img src={vehicle.photo.dataUrl} alt={`${vehicle.unit} vehicle`}/>:<Truck/>}</div><StatusBadge status={vehicle.status}/><h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3><p>{vehicle.type}</p>{vehicle.assignedTo&&<span className="assigned-person"><CircleUserRound/> Assigned to {crew.find(member=>member.id===vehicle.assignedTo)?.name??'Crew member'}</span>}<button className={vehicle.assignedTo===currentUser.id?'assignment-button assigned':'assignment-button'} disabled={Boolean(vehicle.assignedTo&&vehicle.assignedTo!==currentUser.id)} onClick={onAssign}>{vehicle.assignedTo===currentUser.id?<><Check/> Assigned to me</>:vehicle.assignedTo?<><CircleUserRound/> Assigned</>:<><CircleUserRound/> Assign to me</>}</button></div><div className="detail-section"><h4>Current status</h4><div className={`status-select ${canManage?'':'readonly'}`}>{statuses.map(s=><button key={s} disabled={!canManage} className={vehicle.status===s?'selected':''} onClick={()=>onStatus(s)}>{vehicle.status===s&&<Check/>}{s}</button>)}</div></div>{openIssues.length>0&&<div className="detail-section vehicle-issues"><h4>Open issues <span>{openIssues.length}</span></h4>{openIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></span><span><b>{issue.title}</b><small>{issue.priority} priority · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}<div className="detail-section"><h4>Vehicle information</h4><dl className="details"><Detail icon={<Hash/>} label="VIN" value={vehicle.vin||'Not added'}/><Detail icon={<CarFront/>} label="License plate" value={vehicle.plate||'Not added'}/><Detail icon={<CalendarDays/>} label="Added" value={new Date(vehicle.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}/></dl></div><div className="detail-section"><h4>Documents</h4><div className="document-list">{documents.map(([label,file])=><div key={label}><span>{file?.type.startsWith('image/')?<FileImage/>:<FileText/>}<b>{label}</b></span>{file?<a href={file.dataUrl} target="_blank" rel="noreferrer">View</a>:<em>Not added</em>}</div>)}</div></div>{resolvedIssues.length>0&&<div className="detail-section vehicle-issues resolved-vehicle-issues"><h4>Resolved issues <span>{resolvedIssues.length}</span></h4>{resolvedIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className="priority-icon resolved"><Check/></span><span><b>{issue.title}</b><small>Resolved {new Date(issue.resolvedAt??issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{vehicle.notes&&<div className="detail-section"><h4>Notes</h4><p className="notes">{vehicle.notes}</p></div>}</section></div>}
function IssueDetail({issue,vehicle,onClose,onSave}:{issue:FleetIssue;vehicle?:Vehicle;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [updateText,setUpdateText]=useState('');
  const saveUpdate=(status?:IssueStatus)=>{if(!updateText.trim())return;const now=new Date().toISOString();const nextStatus=status??issue.status;onSave({...issue,status:nextStatus,resolvedAt:nextStatus==='Resolved'?(issue.resolvedAt??now):undefined,updates:[{id:crypto.randomUUID(),text:updateText.trim(),createdBy:currentUser.name,createdAt:now},...issue.updates]});setUpdateText('')};
  const addUpdate=(e:React.FormEvent)=>{e.preventDefault();saveUpdate()};
  const formatDate=(date:string)=>new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="overlay"><section className="drawer detail-drawer issue-detail"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">{vehicle?.unit??'Vehicle issue'}</span><h2>{issue.title}</h2></div><button className="close" onClick={onClose}><X/></button></header><div className="issue-detail-summary"><div className="issue-badges"><span className={`issue-status ${issue.status.toLowerCase()}`}>{issue.status}</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority} priority</span></div><p>{issue.description}</p><small>Reported by {issue.createdBy} · {formatDate(issue.createdAt)}</small></div><div className="detail-section"><h4>Add update</h4><form className="update-form" onSubmit={addUpdate}><textarea value={updateText} onChange={e=>setUpdateText(e.target.value)} placeholder="Add progress, repair, or inspection notes"/><div className="update-actions"><button className="primary" disabled={!updateText.trim()}><MessageSquare/> Add update</button><button type="button" className={issue.status==='Open'?'resolve-button':'reopen-button'} disabled={!updateText.trim()} onClick={()=>saveUpdate(issue.status==='Open'?'Resolved':'Open')}>{issue.status==='Open'?<Check/>:<CircleAlert/>}{issue.status==='Open'?'Mark as resolved':'Reopen issue'}</button></div></form></div><div className="detail-section issue-history"><h4>Updates <span>{issue.updates.length}</span></h4>{issue.updates.map(update=><article key={update.id}><span><MessageSquare/></span><div><p>{update.text}</p><small>{update.createdBy} · {formatDate(update.createdAt)}</small></div></article>)}{!issue.updates.length&&<p className="no-updates">No updates yet.</p>}</div></section></div>
}
function Detail({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {return <div><dt>{icon}<span>{label}</span></dt><dd>{value}</dd></div>}
function MobileNav({page,setPage}:{page:Page;setPage:(p:Page)=>void}) {return <nav className="mobile-nav"><button className={page==='overview'?'active':''} onClick={()=>setPage('overview')}><LayoutDashboard/><span>Overview</span></button><button className={page==='vehicles'?'active':''} onClick={()=>setPage('vehicles')}><Truck/><span>Fleet</span></button><button className={page==='issues'?'active':''} onClick={()=>setPage('issues')}><CircleAlert/><span>Issues</span></button>{currentUser.role==='owner'&&<button className={page==='crew'?'active':''} onClick={()=>setPage('crew')}><Users/><span>Crew</span></button>}<button className={page==='company'?'active':''} onClick={()=>setPage('company')}><CircleUserRound/><span>Company</span></button></nav>}
