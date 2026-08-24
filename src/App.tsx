import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Bell, Building2, CalendarDays, CarFront, Check, ChevronRight,
  CircleAlert, CircleUserRound, Clock3, Gauge, Hash, LayoutDashboard, Menu, MessageSquare, MoreHorizontal, Pencil, Plus,
  Search, Settings, SlidersHorizontal, Truck, Wrench, X
} from 'lucide-react';

type Status = 'Ready' | 'Assigned' | 'Maintenance' | 'Out of service';
type Page = 'overview' | 'vehicles' | 'issues' | 'company';
type UserRole = 'owner' | 'member';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type IssueStatus = 'Open' | 'Resolved';
type Vehicle = {
  id: string; unit: string; type: string; year: number; make: string; model: string;
  vin: string; plate: string; mileage: number; hours?: number; status: Status;
  notes?: string; createdAt: string;
};
type IssueUpdate = {id: string; text: string; createdBy: string; createdAt: string};
type FleetIssue = {
  id: string; vehicleId: string; title: string; description: string; priority: Priority;
  status: IssueStatus; resolvedAt?: string; updates: IssueUpdate[]; createdBy: string; createdAt: string;
};

const seed: Vehicle[] = [
  {id:'v1',unit:'Engine 701',type:'Type 3 Engine',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',mileage:48216,hours:3284,status:'Ready',createdAt:'2025-02-04'},
  {id:'v2',unit:'Tender 12',type:'Water Tender',year:2017,make:'Peterbilt',model:'367',vin:'1XPTD4EX8HD397122',plate:'CA 8T012',mileage:76341,hours:5108,status:'Assigned',createdAt:'2025-01-18'},
  {id:'v3',unit:'Dozer 4',type:'Dozer',year:2014,make:'Caterpillar',model:'D7R',vin:'CAT00D7RJLGP01234',plate:'',mileage:0,hours:9870,status:'Maintenance',createdAt:'2024-12-11'}
];
const types = ['Type 3 Engine','Type 4 Engine','Type 6 Engine','Water Tender','Crew Carrier','Dozer','Transport','Support Vehicle','Other'];
const statuses: Status[] = ['Ready','Assigned','Maintenance','Out of service'];
const priorities: Priority[] = ['Low','Medium','High','Critical'];
const currentUser: {name: string; role: UserRole} = {name: 'Ryan Mitchell', role: 'owner'};

function loadVehicles() {
  try { const stored = localStorage.getItem('fireops-vehicles'); return stored ? JSON.parse(stored) as Vehicle[] : seed; }
  catch { return seed; }
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
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'All'>('All');
  const [formOpen, setFormOpen] = useState(false);
  const [issueFormOpen, setIssueFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<FleetIssue | null>(null);
  const [notice, setNotice] = useState('');
  const canManageFleet = currentUser.role === 'owner';
  useEffect(() => localStorage.setItem('fireops-vehicles', JSON.stringify(vehicles)), [vehicles]);
  useEffect(() => localStorage.setItem('fireops-issues', JSON.stringify(issues)), [issues]);
  const filtered = useMemo(() => vehicles.filter(v => {
    const text = `${v.unit} ${v.type} ${v.make} ${v.model} ${v.year} ${v.plate}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === 'All' || v.status === filter);
  }), [vehicles, query, filter]);
  const addVehicle = (vehicle: Vehicle) => {
    setVehicles(v => [vehicle, ...v]); setFormOpen(false); setNotice(`${vehicle.unit} added to inventory`);
    setTimeout(() => setNotice(''), 3200);
  };
  const addIssue = (issue: FleetIssue) => {
    setIssues(items => [issue, ...items]); setIssueFormOpen(false); setNotice('Issue created');
    setTimeout(() => setNotice(''), 3200);
  };
  const updateIssue = (issue: FleetIssue) => {
    setIssues(items => items.map(item => item.id === issue.id ? issue : item));
    setSelectedIssue(issue); setNotice('Issue updated');
    setTimeout(() => setNotice(''), 3200);
  };
  const updateVehicle = (vehicle: Vehicle) => {
    setVehicles(v => v.map(item => item.id === vehicle.id ? vehicle : item));
    setEditing(null); setNotice(`${vehicle.unit} details updated`);
    setTimeout(() => setNotice(''), 3200);
  };
  const updateStatus = (id: string, status: Status) => {
    if (!canManageFleet) return;
    setVehicles(v => v.map(item => item.id === id ? {...item, status} : item));
    setSelected(v => v?.id === id ? {...v, status} : v);
  };

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage}/>
    <div className="app-main">
      <Topbar onMenu={() => {}} />
      <main>
        {page === 'vehicles' && <VehiclesPage vehicles={vehicles} issues={issues} filtered={filtered} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} canManage={canManageFleet} onAdd={() => setFormOpen(true)} onSelect={setSelected}/>} 
        {page === 'overview' && <Overview vehicles={vehicles} issues={issues} onSelectVehicle={setSelected} onSelectIssue={setSelectedIssue}/>} 
        {page === 'issues' && <IssuesPage issues={issues} vehicles={vehicles} onNew={() => setIssueFormOpen(true)} onSelect={setSelectedIssue}/>} 
        {page === 'company' && <Company/>}
      </main>
      <MobileNav page={page} setPage={setPage}/>
    </div>
    {formOpen && canManageFleet && <VehicleForm onClose={() => setFormOpen(false)} onSave={addVehicle}/>} 
    {editing && canManageFleet && <VehicleForm vehicle={editing} onClose={() => setEditing(null)} onSave={updateVehicle}/>} 
    {issueFormOpen && <IssueForm vehicles={vehicles} onClose={() => setIssueFormOpen(false)} onSave={addIssue}/>} 
    {selected && <VehicleDetail vehicle={selected} issues={issues.filter(issue => issue.vehicleId === selected.id)} canManage={canManageFleet} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null)}} onIssue={issue => {setSelected(null);setSelectedIssue(issue)}} onStatus={s => updateStatus(selected.id, s)}/>} 
    {selectedIssue && <IssueDetail issue={selectedIssue} vehicle={vehicles.find(v => v.id === selectedIssue.vehicleId)} onClose={() => setSelectedIssue(null)} onSave={updateIssue}/>} 
    {notice && <div className="toast"><span><Check size={16}/></span>{notice}</div>}
  </div>;
}

function Brand() { return <div className="brand"><div className="brand-mark"><span/></div><b>FIREOPS</b></div> }
function Sidebar({page,setPage}:{page:Page;setPage:(p:Page)=>void}) {
  return <aside className="sidebar"><Brand/><nav>
    <NavItem icon={<LayoutDashboard/>} label="Overview" active={page==='overview'} onClick={()=>setPage('overview')}/>
    <NavItem icon={<Truck/>} label="Fleet" active={page==='vehicles'} onClick={()=>setPage('vehicles')}/>
    <NavItem icon={<CircleAlert/>} label="Issues" active={page==='issues'} onClick={()=>setPage('issues')}/>
    <NavItem icon={<Building2/>} label="Company" active={page==='company'} onClick={()=>setPage('company')}/>
  </nav><div className="sidebar-foot"><div className="avatar">RM</div><div><b>Ryan Mitchell</b><span>Company owner</span></div><MoreHorizontal size={18}/></div></aside>
}
function NavItem({icon,label,active,onClick}:{icon:React.ReactNode;label:string;active:boolean;onClick:()=>void}) {
  return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>
}
function Topbar({onMenu}:{onMenu:()=>void}) {
  return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Menu/></button><div className="mobile-brand"><Brand/></div><div className="topbar-right"><button aria-label="Notifications"><Bell size={20}/><i/></button><div className="top-avatar">RM</div></div></header>
}

function VehiclesPage({vehicles,issues,filtered,query,setQuery,filter,setFilter,canManage,onAdd,onSelect}:{vehicles:Vehicle[];issues:FleetIssue[];filtered:Vehicle[];query:string;setQuery:(v:string)=>void;filter:Status|'All';setFilter:(v:Status|'All')=>void;canManage:boolean;onAdd:()=>void;onSelect:(v:Vehicle)=>void}) {
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Fleet management</span><h1>Fleet</h1><p>Manage company vehicles and apparatus in one place.</p></div>{canManage&&<button className="primary desktop-add" onClick={onAdd}><Plus size={19}/> Add vehicle</button>}</div>
    <section className="stats-row">
      <Stat label="Total vehicles" value={vehicles.length} icon={<Truck/>}/>
      <Stat label="Ready" value={vehicles.filter(v=>v.status==='Ready').length} icon={<Check/>} tone="green"/>
      <Stat label="Needs attention" value={vehicles.filter(v=>['Maintenance','Out of service'].includes(v.status)).length} icon={<Wrench/>} tone="amber"/>
    </section>
    <section className="inventory-panel"><div className="inventory-tools"><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search vehicles" aria-label="Search vehicles"/>{query&&<button onClick={()=>setQuery('')}><X size={16}/></button>}</div><div className="filter-wrap"><SlidersHorizontal size={17}/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'All')} aria-label="Filter by status"><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="list-label"><b>{filtered.length} {filtered.length===1?'vehicle':'vehicles'}</b><span>Updated now</span></div>
      <div className="vehicle-list">{filtered.map(v=><VehicleCard key={v.id} vehicle={v} issueCount={issues.filter(issue=>issue.vehicleId===v.id&&issue.status==='Open').length} onClick={()=>onSelect(v)}/>)}
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
function VehicleCard({vehicle,issueCount,onClick}:{vehicle:Vehicle;issueCount:number;onClick:()=>void}) {
  return <button className="vehicle-card" onClick={onClick}><div className="vehicle-icon">{vehicle.type==='Dozer'?<Wrench/>:<Truck/>}</div><div className="vehicle-info"><div className="vehicle-title"><h3>{vehicle.unit}</h3><StatusBadge status={vehicle.status}/></div><p>{vehicle.year} {vehicle.make} {vehicle.model}</p><div className="vehicle-meta"><span><CarFront/> {vehicle.type}</span>{vehicle.mileage>0&&<span><Gauge/> {vehicle.mileage.toLocaleString()} mi</span>}{vehicle.hours&&<span>{vehicle.hours.toLocaleString()} hrs</span>}<span className={issueCount?'open-issues':''}><CircleAlert/> {issueCount} open {issueCount===1?'issue':'issues'}</span></div></div><ChevronRight className="card-arrow"/></button>
}
function StatusBadge({status}:{status:Status}) {return <span className={`status ${status.toLowerCase().replace(/ /g,'-')}`}><i/>{status}</span>}

function Overview({vehicles,issues,onSelectVehicle,onSelectIssue}:{vehicles:Vehicle[];issues:FleetIssue[];onSelectVehicle:(v:Vehicle)=>void;onSelectIssue:(issue:FleetIssue)=>void}) {
  const neededVehicles = vehicles.filter(v => v.status === 'Maintenance' || v.status === 'Out of service');
  const openIssues = issues.filter(issue => issue.status === 'Open');
  const neededCount = neededVehicles.length + openIssues.length;
  const recent = [...vehicles.map(vehicle=>({kind:'vehicle' as const,date:vehicle.createdAt,vehicle})),...issues.map(issue=>({kind:'issue' as const,date:issue.createdAt,issue})),...issues.filter(issue=>issue.status==='Resolved'&&issue.resolvedAt).map(issue=>({kind:'resolved' as const,date:issue.resolvedAt!,issue}))].sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0,7);
  const formatDate = (date:string) => new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return <div className="page overview-page"><div className="page-heading"><div><span className="eyebrow">Operations</span><h1>Overview</h1><p>Stay on top of required work and recent activity.</p></div></div>
    <section className="action-section"><div className="action-heading"><div><h2>Needed actions</h2><p>Items requiring attention</p></div><span className="action-count">{neededCount}</span></div>
      <div className="action-list">{openIssues.map(issue=><button className="action-row" key={`issue-${issue.id}`} onClick={()=>onSelectIssue(issue)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{issue.title}</b><small>{vehicles.find(v=>v.id===issue.vehicleId)?.unit??'Unknown vehicle'} · {issue.priority} priority · Open issue</small></span><ChevronRight/></button>)}{neededVehicles.map(v=><button className="action-row" key={`vehicle-${v.id}`} onClick={()=>onSelectVehicle(v)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{v.status === 'Out of service' ? `Resolve out-of-service status for ${v.unit}` : `Complete maintenance for ${v.unit}`}</b><small>{v.year} {v.make} {v.model} · {v.status}</small></span><ChevronRight/></button>)}
      {!neededCount&&<div className="action-empty"><span><Check/></span><div><b>All caught up</b><p>No fleet actions need attention.</p></div></div>}</div>
    </section>
    <section className="action-section"><div className="action-heading"><div><h2>Recent actions</h2><p>Latest fleet activity</p></div></div>
      <div className="action-list">{recent.map(item=>item.kind==='vehicle'?<button className="action-row" key={`vehicle-${item.vehicle.id}`} onClick={()=>onSelectVehicle(item.vehicle)}><span className="action-icon complete"><Check/></span><span className="action-copy"><b>{item.vehicle.unit} added to fleet</b><small>Vehicle record created · {formatDate(item.date)}</small></span><span className="action-time"><Clock3/>{formatDate(item.date)}</span><ChevronRight/></button>:item.kind==='resolved'?<button className="action-row" key={`resolved-${item.issue.id}`} onClick={()=>onSelectIssue(item.issue)}><span className="action-icon complete"><Check/></span><span className="action-copy"><b>Issue resolved: {item.issue.title}</b><small>{vehicles.find(v=>v.id===item.issue.vehicleId)?.unit??'Unknown vehicle'} · Resolved {formatDate(item.date)}</small></span><span className="action-time"><Clock3/>{formatDate(item.date)}</span><ChevronRight/></button>:<button className="action-row" key={`issue-${item.issue.id}`} onClick={()=>onSelectIssue(item.issue)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>Issue reported: {item.issue.title}</b><small>{vehicles.find(v=>v.id===item.issue.vehicleId)?.unit??'Unknown vehicle'} · {item.issue.priority} priority · {formatDate(item.date)}</small></span><span className="action-time"><Clock3/>{formatDate(item.date)}</span><ChevronRight/></button>)}</div>
    </section>
  </div>
}
function Company() {return <div className="page"><div className="page-heading"><div><span className="eyebrow">Account</span><h1>Company</h1><p>Business details for your FireOps account.</p></div></div><section className="company-card"><div className="company-logo">NR</div><div><h2>North Ridge Wildfire</h2><p>Wildland fire contractor</p></div><button><Settings/> Manage</button><dl><div><dt>Owner</dt><dd>Ryan Mitchell</dd></div><div><dt>Company ID</dt><dd>NRW-2048</dd></div><div><dt>Account plan</dt><dd>Phase 1 testing</dd></div></dl></section></div>}

function VehicleForm({vehicle,onClose,onSave}:{vehicle?:Vehicle;onClose:()=>void;onSave:(v:Vehicle)=>void}) {
  const editing = Boolean(vehicle);
  const [form,setForm]=useState({unit:vehicle?.unit??'',type:vehicle?.type??'Type 3 Engine',year:String(vehicle?.year??new Date().getFullYear()),make:vehicle?.make??'',model:vehicle?.model??'',vin:vehicle?.vin??'',plate:vehicle?.plate??'',mileage:vehicle?.mileage?String(vehicle.mileage):'',hours:vehicle?.hours?String(vehicle.hours):'',status:vehicle?.status??'Ready' as Status,notes:vehicle?.notes??''});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const submit=(e:React.FormEvent)=>{e.preventDefault();const next:Record<string,string>={};if(!form.unit.trim())next.unit='Unit name is required';if(!form.make.trim())next.make='Make is required';if(!form.model.trim())next.model='Model is required';if(!form.year||Number(form.year)<1950||Number(form.year)>new Date().getFullYear()+1)next.year='Enter a valid year';setErrors(next);if(Object.keys(next).length)return;onSave({id:vehicle?.id??crypto.randomUUID(),unit:form.unit.trim(),type:form.type,year:Number(form.year),make:form.make.trim(),model:form.model.trim(),vin:form.vin.trim().toUpperCase(),plate:form.plate.trim().toUpperCase(),mileage:Number(form.mileage)||0,hours:Number(form.hours)||undefined,status:form.status,notes:form.notes.trim(),createdAt:vehicle?.createdAt??new Date().toISOString()})};
  return <div className="overlay"><section className="drawer form-drawer"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Vehicle inventory</span><h2>{editing?'Edit vehicle':'Add vehicle'}</h2><p>{editing?'Update fleet details for this vehicle.':'Enter basic details. You can update these later.'}</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form onSubmit={submit} noValidate>
    <FormSection number="1" title="Vehicle details"><div className="form-grid"><Field label="Unit name" required error={errors.unit}><input value={form.unit} onChange={e=>update('unit',e.target.value)} placeholder="e.g. Engine 702" autoFocus/></Field><Field label="Vehicle type" required><select value={form.type} onChange={e=>update('type',e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select></Field><Field label="Year" required error={errors.year}><input type="number" inputMode="numeric" value={form.year} onChange={e=>update('year',e.target.value)}/></Field><Field label="Make" required error={errors.make}><input value={form.make} onChange={e=>update('make',e.target.value)} placeholder="e.g. International"/></Field><Field label="Model" required error={errors.model}><input value={form.model} onChange={e=>update('model',e.target.value)} placeholder="e.g. HV"/></Field><Field label="Status"><select value={form.status} onChange={e=>update('status',e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></Field></div></FormSection>
    <FormSection number="2" title="Registration & usage" optional><div className="form-grid"><Field label="VIN"><input value={form.vin} onChange={e=>update('vin',e.target.value)} maxLength={17} placeholder="17-character VIN"/></Field><Field label="License plate"><input value={form.plate} onChange={e=>update('plate',e.target.value)} placeholder="Plate number"/></Field><Field label="Current mileage"><div className="suffix-input"><input type="number" inputMode="numeric" value={form.mileage} onChange={e=>update('mileage',e.target.value)} placeholder="0"/><span>mi</span></div></Field><Field label="Engine hours"><div className="suffix-input"><input type="number" inputMode="decimal" value={form.hours} onChange={e=>update('hours',e.target.value)} placeholder="0"/><span>hrs</span></div></Field><Field label="Notes" wide><textarea value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="Anything else to know about this vehicle"/></Field></div></FormSection>
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

function VehicleDetail({vehicle,issues,canManage,onClose,onEdit,onIssue,onStatus}:{vehicle:Vehicle;issues:FleetIssue[];canManage:boolean;onClose:()=>void;onEdit:()=>void;onIssue:(issue:FleetIssue)=>void;onStatus:(s:Status)=>void}) {const openIssues=issues.filter(issue=>issue.status==='Open');const resolvedIssues=issues.filter(issue=>issue.status==='Resolved').sort((a,b)=>Date.parse(b.resolvedAt??b.createdAt)-Date.parse(a.resolvedAt??a.createdAt));return <div className="overlay"><section className="drawer detail-drawer"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">Vehicle record</span><h2>{vehicle.unit}</h2></div><div className="detail-actions">{canManage&&<button className="edit-vehicle" onClick={onEdit}><Pencil/> Edit</button>}<button className="close" onClick={onClose}><X/></button></div></header><div className="detail-hero"><div className="large-vehicle-icon"><Truck/></div><StatusBadge status={vehicle.status}/><h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3><p>{vehicle.type}</p></div><div className="detail-section"><h4>Current status</h4><div className={`status-select ${canManage?'':'readonly'}`}>{statuses.map(s=><button key={s} disabled={!canManage} className={vehicle.status===s?'selected':''} onClick={()=>onStatus(s)}>{vehicle.status===s&&<Check/>}{s}</button>)}</div></div>{openIssues.length>0&&<div className="detail-section vehicle-issues"><h4>Open issues <span>{openIssues.length}</span></h4>{openIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></span><span><b>{issue.title}</b><small>{issue.priority} priority · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}<div className="detail-section"><h4>Vehicle information</h4><dl className="details"><Detail icon={<Hash/>} label="VIN" value={vehicle.vin||'Not added'}/><Detail icon={<CarFront/>} label="License plate" value={vehicle.plate||'Not added'}/><Detail icon={<Gauge/>} label="Mileage" value={vehicle.mileage?`${vehicle.mileage.toLocaleString()} mi`:'Not added'}/><Detail icon={<CalendarDays/>} label="Added" value={new Date(vehicle.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}/></dl></div>{resolvedIssues.length>0&&<div className="detail-section vehicle-issues resolved-vehicle-issues"><h4>Resolved issues <span>{resolvedIssues.length}</span></h4>{resolvedIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className="priority-icon resolved"><Check/></span><span><b>{issue.title}</b><small>Resolved {new Date(issue.resolvedAt??issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{vehicle.notes&&<div className="detail-section"><h4>Notes</h4><p className="notes">{vehicle.notes}</p></div>}</section></div>}
function IssueDetail({issue,vehicle,onClose,onSave}:{issue:FleetIssue;vehicle?:Vehicle;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [updateText,setUpdateText]=useState('');
  const saveUpdate=(status?:IssueStatus)=>{if(!updateText.trim())return;const now=new Date().toISOString();const nextStatus=status??issue.status;onSave({...issue,status:nextStatus,resolvedAt:nextStatus==='Resolved'?(issue.resolvedAt??now):undefined,updates:[{id:crypto.randomUUID(),text:updateText.trim(),createdBy:currentUser.name,createdAt:now},...issue.updates]});setUpdateText('')};
  const addUpdate=(e:React.FormEvent)=>{e.preventDefault();saveUpdate()};
  const formatDate=(date:string)=>new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="overlay"><section className="drawer detail-drawer issue-detail"><header><button className="back-mobile" onClick={onClose}><ArrowLeft/></button><div><span className="eyebrow">{vehicle?.unit??'Vehicle issue'}</span><h2>{issue.title}</h2></div><button className="close" onClick={onClose}><X/></button></header><div className="issue-detail-summary"><div className="issue-badges"><span className={`issue-status ${issue.status.toLowerCase()}`}>{issue.status}</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority} priority</span></div><p>{issue.description}</p><small>Reported by {issue.createdBy} · {formatDate(issue.createdAt)}</small></div><div className="detail-section"><h4>Add update</h4><form className="update-form" onSubmit={addUpdate}><textarea value={updateText} onChange={e=>setUpdateText(e.target.value)} placeholder="Add progress, repair, or inspection notes"/><div className="update-actions"><button className="primary" disabled={!updateText.trim()}><MessageSquare/> Add update</button><button type="button" className={issue.status==='Open'?'resolve-button':'reopen-button'} disabled={!updateText.trim()} onClick={()=>saveUpdate(issue.status==='Open'?'Resolved':'Open')}>{issue.status==='Open'?<Check/>:<CircleAlert/>}{issue.status==='Open'?'Mark as resolved':'Reopen issue'}</button></div></form></div><div className="detail-section issue-history"><h4>Updates <span>{issue.updates.length}</span></h4>{issue.updates.map(update=><article key={update.id}><span><MessageSquare/></span><div><p>{update.text}</p><small>{update.createdBy} · {formatDate(update.createdAt)}</small></div></article>)}{!issue.updates.length&&<p className="no-updates">No updates yet.</p>}</div></section></div>
}
function Detail({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {return <div><dt>{icon}<span>{label}</span></dt><dd>{value}</dd></div>}
function MobileNav({page,setPage}:{page:Page;setPage:(p:Page)=>void}) {return <nav className="mobile-nav"><button className={page==='overview'?'active':''} onClick={()=>setPage('overview')}><LayoutDashboard/><span>Overview</span></button><button className={page==='vehicles'?'active':''} onClick={()=>setPage('vehicles')}><Truck/><span>Fleet</span></button><button className={page==='issues'?'active':''} onClick={()=>setPage('issues')}><CircleAlert/><span>Issues</span></button><button className={page==='company'?'active':''} onClick={()=>setPage('company')}><CircleUserRound/><span>Company</span></button></nav>}
