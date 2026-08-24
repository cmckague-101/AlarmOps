import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDialogA11y } from './useDialogA11y';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarDays, CarFront, Check, ChevronRight,
  CircleAlert, CircleUserRound, Clock3, ExternalLink, FileImage, FileText, Hash, LayoutDashboard, LogOut, Mail, MessageSquare, Pencil, Phone, Plus,
  Search, ShieldCheck, SlidersHorizontal, Truck, Upload, UserPlus, Users, Wrench, X
} from 'lucide-react';

type Status = 'Ready' | 'Assigned' | 'Maintenance' | 'Out of service';
type Page = 'overview' | 'vehicles' | 'crew' | 'company';
export type UserRole = 'owner' | 'member';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type IssueStatus = 'Open' | 'Resolved';
type VehicleDocumentKey = 'contract' | 'viprChecklist' | 'registration' | 'insurance' | 'dotInspection';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type UndoAction = { vehicle: Vehicle; label: string };
export type VehicleFile = {name: string; type: string; dataUrl: string; path?: string};
type CrewStatus = 'Active' | 'Invited';
export type CrewMember = {
  id: string; name: string; email: string; phone: string; role: UserRole; status: CrewStatus;
  credential?: VehicleFile; credentialName?: string; joinedAt?: string;
};
export type Vehicle = {
  id: string; unit: string; type: string; year: number; make: string; model: string;
  vin: string; plate: string; status: Status; photo?: VehicleFile; contract?: VehicleFile;
  viprChecklist?: VehicleFile; registration?: VehicleFile; insurance?: VehicleFile;
  dotInspection?: VehicleFile; notes?: string; createdAt: string; assignedTo?: string;
};
type IssueUpdate = {id: string; text: string; createdBy: string; createdAt: string};
export type FleetIssue = {
  id: string; vehicleId: string; title: string; description: string; priority: Priority;
  status: IssueStatus; resolvedAt?: string; updates: IssueUpdate[]; createdBy: string; createdAt: string;
};
export type Activity = {
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
const vehicleDocumentOptions: {key:VehicleDocumentKey;label:string}[] = [
  {key:'contract',label:'Contract'},
  {key:'viprChecklist',label:'VIPR checklist'},
  {key:'registration',label:'Registration'},
  {key:'insurance',label:'Insurance'},
  {key:'dotInspection',label:'DOT inspection'}
];
export type FireOpsUser = {id: string; name: string; role: UserRole};
export type CompanyInfo = {name: string; code: string; industry: string};
export type FleetSnapshot = {vehicles: Vehicle[]; issues: FleetIssue[]; crew: CrewMember[]; activities: Activity[]};
const demoUser: FireOpsUser = {id: 'u1', name: 'Ryan Mitchell', role: 'owner'};
const demoCompany: CompanyInfo = {name:'North Ridge Wildfire',code:'NRW-2048',industry:'Wildland fire contractor'};
const seedCrew: CrewMember[] = [
  {id:'u1',name:'Ryan Mitchell',email:'ryan@northridgewildfire.com',phone:'(530) 555-0142',role:'owner',status:'Active',joinedAt:'2024-11-08'},
  {id:'u2',name:'Maya Torres',email:'maya@northridgewildfire.com',phone:'(530) 555-0198',role:'member',status:'Active',credentialName:'Red Card',joinedAt:'2025-01-16'},
  {id:'u3',name:'Cole Bennett',email:'cole@northridgewildfire.com',phone:'(530) 555-0117',role:'member',status:'Active',joinedAt:'2025-02-02'}
];

function saveLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function normalizeVehicle(vehicle: Vehicle): Vehicle {
  if (vehicle.status === 'Assigned') return vehicle.assignedTo ? vehicle : {...vehicle, status: 'Ready'};
  return vehicle.assignedTo ? {...vehicle, assignedTo: undefined} : vehicle;
}

function normalizeVehicles(vehicles: Vehicle[]) {
  return vehicles.map(normalizeVehicle);
}

function loadVehicles() {
  try { const stored = localStorage.getItem('fireops-vehicles'); return normalizeVehicles(stored ? JSON.parse(stored) as Vehicle[] : seed); }
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

export default function App({user=demoUser,company=demoCompany,initialData,onDataChange,onSignOut,uploadFile}:{user?:FireOpsUser;company?:CompanyInfo;initialData?:FleetSnapshot;onDataChange?:(data:FleetSnapshot)=>Promise<void>|void;onSignOut?:()=>void;uploadFile?:(file:File)=>Promise<VehicleFile>}) {
  const currentUser = user;
  const [vehicles, setVehicles] = useState<Vehicle[]>(()=>initialData?.vehicles ? normalizeVehicles(initialData.vehicles) : loadVehicles());
  const [issues, setIssues] = useState<FleetIssue[]>(()=>initialData?.issues??loadIssues());
  const [crew, setCrew] = useState<CrewMember[]>(()=>initialData?.crew??loadCrew());
  const [activities, setActivities] = useState<Activity[]>(()=>initialData?.activities??loadActivities());
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'All'>('All');
  const [formOpen, setFormOpen] = useState(false);
  const [issueFormOpen, setIssueFormOpen] = useState(false);
  const [issueVehicleId, setIssueVehicleId] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<FleetIssue | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<CrewMember | null>(null);
  const [notice, setNotice] = useState('');
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const canManageFleet = currentUser.role === 'owner';
  useEffect(() => {
    const snapshot={vehicles,issues,crew,activities};
    let active=true;
    const timer=window.setTimeout(async()=>{
      setSaveState('saving');
      if (onDataChange) {
        try {
          const saveRequest=saveQueue.current.then(()=>onDataChange(snapshot));
          saveQueue.current=saveRequest.catch(()=>undefined);
          await saveRequest;
          if(active){setStorageError(false);setSaveState('saved')}
        } catch {
          if(active){setStorageError(true);setSaveState('error')}
        }
      } else {
        const saved=[saveLocal('fireops-vehicles',vehicles),saveLocal('fireops-issues',issues),saveLocal('fireops-crew',crew),saveLocal('fireops-activities',activities)].every(Boolean);
        if(active){setStorageError(!saved);setSaveState(saved?'saved':'error')}
      }
    },300);
    return()=>{active=false;window.clearTimeout(timer)};
  },[vehicles,issues,crew,activities,onDataChange,saveAttempt]);
  const logActivity = (activity: Omit<Activity,'id'|'createdAt'|'createdBy'>) => setActivities(items => [{...activity,id:crypto.randomUUID(),createdBy:currentUser.name,createdAt:new Date().toISOString()},...items]);
  const showNotice = (message:string,undo:UndoAction|null=null) => {
    setNotice(message);setUndoAction(undo);
    window.setTimeout(()=>{setNotice(current=>current===message?'':current);setUndoAction(current=>current===undo?null:current)},undo?7000:3200);
  };
  const undoLastAction = () => {
    if(!undoAction)return;
    const previous=undoAction.vehicle;
    setVehicles(items=>items.map(item=>item.id===previous.id?previous:item));
    setSelected(item=>item?.id===previous.id?previous:item);
    logActivity({action:`Change undone for ${previous.unit}`,detail:'Vehicle status and assignment restored',targetType:'vehicle',targetId:previous.id,tone:'complete'});
    showNotice(`${previous.unit} restored`);
  };
  const filtered = useMemo(() => vehicles.filter(v => {
    const text = `${v.unit} ${v.type} ${v.make} ${v.model} ${v.year} ${v.plate}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === 'All' || v.status === filter);
  }), [vehicles, query, filter]);
  const addVehicle = (vehicle: Vehicle) => {
    const next=normalizeVehicle(vehicle);
    setVehicles(v => [next, ...v]); logActivity({action:`${next.unit} added to fleet`,detail:'Vehicle record created',targetType:'vehicle',targetId:next.id,tone:'complete'}); setFormOpen(false); showNotice(`${next.unit} added to inventory`);
  };
  const addIssue = (issue: FleetIssue) => {
    const vehicle=vehicles.find(item=>item.id===issue.vehicleId);setIssues(items => [issue, ...items]); logActivity({action:`Issue reported: ${issue.title}`,detail:`${vehicle?.unit??'Unknown vehicle'} · ${issue.priority} priority`,targetType:'issue',targetId:issue.id,tone:'urgent'}); setIssueFormOpen(false); showNotice('Issue created');
  };
  const updateIssue = (issue: FleetIssue) => {
    const previous=issues.find(item=>item.id===issue.id);const vehicle=vehicles.find(item=>item.id===issue.vehicleId);const statusChanged=previous?.status!==issue.status;const action=statusChanged?(issue.status==='Resolved'?`Issue resolved: ${issue.title}`:`Issue reopened: ${issue.title}`):`Issue updated: ${issue.title}`;
    setIssues(items => items.map(item => item.id === issue.id ? issue : item));
    logActivity({action,detail:`${vehicle?.unit??'Unknown vehicle'} · ${issue.updates[0]?.text??'Issue record updated'}`,targetType:'issue',targetId:issue.id,tone:issue.status==='Resolved'?'complete':'urgent'}); setSelectedIssue(issue); showNotice('Issue updated');
  };
  const updateVehicle = (vehicle: Vehicle) => {
    const next=normalizeVehicle(vehicle);
    setVehicles(v => v.map(item => item.id === next.id ? next : item));
    logActivity({action:`${next.unit} details updated`,detail:'Vehicle record changed',targetType:'vehicle',targetId:next.id,tone:'complete'}); setEditing(null); showNotice(`${next.unit} details updated`);
  };
  const updateStatus = (id: string, status: Status) => {
    if (!canManageFleet) return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||vehicle.status===status)return;
    if(status==='Assigned'&&!vehicle.assignedTo){showNotice('Assign a crew member before setting status to Assigned');return}
    const next={...vehicle,status,assignedTo:status==='Assigned'?vehicle.assignedTo:undefined};
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:`${vehicle.unit} status changed to ${status}`,detail:`Previous status: ${vehicle.status}`,targetType:'vehicle',targetId:id,tone:['Maintenance','Out of service'].includes(status)?'urgent':'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(`${vehicle.unit} changed to ${status}`,{vehicle,label:`Undo status change for ${vehicle.unit}`});
  };
  const updateAssignment = (id: string, assignedTo?: string) => {
    if (!canManageFleet) return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||vehicle.assignedTo===assignedTo)return;
    const next={...vehicle,assignedTo,status:assignedTo?'Assigned' as Status:vehicle.status==='Assigned'?'Ready' as Status:vehicle.status};
    const member=crew.find(item=>item.id===assignedTo);
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:`${vehicle.unit} assignment updated`,detail:member?`Assigned to ${member.name}`:'No crew member assigned',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(member?`${vehicle.unit} assigned to ${member.name}`:`${vehicle.unit} assignment cleared`,{vehicle,label:`Undo assignment change for ${vehicle.unit}`});
  };
  const assignToMe = (id: string) => {
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||(vehicle.assignedTo&&vehicle.assignedTo!==currentUser.id))return;
    const assignedTo=vehicle.assignedTo===currentUser.id?undefined:currentUser.id;
    const status:Status=assignedTo?'Assigned':'Ready';
    const next={...vehicle,assignedTo,status};
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:assignedTo?`${currentUser.name} assigned ${vehicle.unit} to themselves`:`${currentUser.name} unassigned ${vehicle.unit}`,detail:assignedTo?'Vehicle is now in use':'Vehicle returned to ready status',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(assignedTo?'Vehicle assigned to you':'Vehicle assignment removed',{vehicle,label:`Undo assignment change for ${vehicle.unit}`});
  };
  const inviteCrew = (member: CrewMember) => {
    setCrew(items => [...items, member]); logActivity({action:`${member.name} invited to company`,detail:member.email,targetType:'crew',targetId:member.id,tone:'complete'}); setInviteOpen(false); showNotice(`Invitation to ${company.name} sent to ${member.email}`);
  };
  const updateCrew = (member: CrewMember) => {
    setCrew(items => items.map(item => item.id === member.id ? member : item)); logActivity({action:`Credentials updated for ${member.name}`,detail:member.credentialName||member.credential?.name||'Credential record updated',targetType:'crew',targetId:member.id,tone:'complete'}); setSelectedCrew(member); showNotice('Crew credentials updated');
  };

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} user={currentUser}/>
    <div className="app-main">
      <Topbar user={currentUser} saveState={saveState} onSignOut={onSignOut}/>
      <main>
        {storageError&&<div className="storage-error" role="alert"><span><b>Changes could not be saved.</b> Check your connection or remove large uploads.</span><button onClick={()=>setSaveAttempt(attempt=>attempt+1)}>Retry save</button></div>}
        {page === 'vehicles' && <VehiclesPage vehicles={vehicles} issues={issues} crew={crew} filtered={filtered} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} canManage={canManageFleet} onAdd={() => setFormOpen(true)} onSelect={setSelected} onNewIssue={() => {setIssueVehicleId('');setIssueFormOpen(true)}} onSelectIssue={setSelectedIssue}/>}
        {page === 'overview' && <Dashboard vehicles={vehicles} issues={issues} crew={crew} activities={activities} isOwner={canManageFleet} onSelectVehicle={setSelected} onSelectIssue={setSelectedIssue} onSelectCrew={setSelectedCrew}/>}
        {page === 'crew' && canManageFleet && <CrewPage crew={crew} onInvite={() => setInviteOpen(true)} onSelect={setSelectedCrew}/>}
        {page === 'company' && <Company company={company} owner={currentUser.name}/>}
      </main>
      <MobileNav page={page} setPage={setPage} user={currentUser}/>
    </div>
    {formOpen && canManageFleet && <VehicleForm uploadFile={uploadFile} onClose={() => setFormOpen(false)} onSave={addVehicle}/>}
    {editing && canManageFleet && <VehicleForm vehicle={editing} uploadFile={uploadFile} onClose={() => setEditing(null)} onSave={updateVehicle}/>}
    {issueFormOpen && <IssueForm vehicles={vehicles} initialVehicleId={issueVehicleId} user={currentUser} onClose={() => setIssueFormOpen(false)} onSave={addIssue}/>}
    {inviteOpen && canManageFleet && <InviteCrewForm existing={crew} companyName={company.name} onClose={() => setInviteOpen(false)} onSave={inviteCrew}/>}
    {selected && <VehicleDetail vehicle={selected} issues={issues.filter(issue => issue.vehicleId === selected.id)} crew={crew} user={currentUser} canManage={canManageFleet} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null)}} onNewIssue={() => {setIssueVehicleId(selected.id);setSelected(null);setIssueFormOpen(true)}} onIssue={issue => {setSelected(null);setSelectedIssue(issue)}} onStatus={s => updateStatus(selected.id, s)} onAssignee={memberId => updateAssignment(selected.id,memberId||undefined)} onAssign={() => assignToMe(selected.id)}/>}
    {selectedIssue && <IssueDetail issue={selectedIssue} vehicle={vehicles.find(v => v.id === selectedIssue.vehicleId)} user={currentUser} onClose={() => setSelectedIssue(null)} onSave={updateIssue}/>}
    {selectedCrew && canManageFleet && <CrewDetail member={selectedCrew} vehicles={vehicles} uploadFile={uploadFile} onClose={() => setSelectedCrew(null)} onSave={updateCrew} onAssign={vehicleId=>updateAssignment(vehicleId,selectedCrew.id)}/>}
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="toast"><span><Check size={16}/></span><b>{notice}</b>{undoAction&&<button onClick={undoLastAction} aria-label={undoAction.label}>Undo</button>}</div>}</div>
  </div>;
}

function Brand() { return <div className="brand"><img className="brand-mark" src="/fireops-logo.webp" width="320" height="258" alt=""/><b>FIREOPS</b></div> }
function Sidebar({page,setPage,user}:{page:Page;setPage:(p:Page)=>void;user:FireOpsUser}) {
  return <aside className="sidebar"><Brand/><nav>
    <NavItem icon={<LayoutDashboard/>} label="Dashboard" active={page==='overview'} onClick={()=>setPage('overview')}/>
    <NavItem icon={<Truck/>} label="Fleet" active={page==='vehicles'} onClick={()=>setPage('vehicles')}/>
    {user.role==='owner'&&<NavItem icon={<Users/>} label="Crew" active={page==='crew'} onClick={()=>setPage('crew')}/>}
    <NavItem icon={<Building2/>} label="Company" active={page==='company'} onClick={()=>setPage('company')}/>
  </nav></aside>
}
function NavItem({icon,label,active,onClick}:{icon:React.ReactNode;label:string;active:boolean;onClick:()=>void}) {
  return <button className={active?'active':''} onClick={onClick} aria-current={active?'page':undefined}>{icon}<span>{label}</span></button>
}
function Topbar({user,saveState,onSignOut}:{user:FireOpsUser;saveState:SaveState;onSignOut?:()=>void}) {
  const saveLabel=saveState==='saving'?'Saving changes':saveState==='error'?'Save failed':saveState==='saved'?'All changes saved':'';
  return <header className="topbar"><div className="mobile-brand"><Brand/></div><div className="topbar-right">{saveLabel&&<div className={`save-status ${saveState}`} role="status" aria-live="polite">{saveState==='saving'?<Clock3/>:saveState==='error'?<CircleAlert/>:<Check/>}<span>{saveLabel}</span></div>}<div className="top-user-name">{user.name}</div>{onSignOut&&<button className="topbar-signout" onClick={onSignOut}><LogOut/><span>Sign out</span></button>}</div></header>
}

function VehiclesPage({vehicles,issues,crew,filtered,query,setQuery,filter,setFilter,canManage,onAdd,onSelect,onNewIssue,onSelectIssue}:{vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];filtered:Vehicle[];query:string;setQuery:(v:string)=>void;filter:Status|'All';setFilter:(v:Status|'All')=>void;canManage:boolean;onAdd:()=>void;onSelect:(v:Vehicle)=>void;onNewIssue:()=>void;onSelectIssue:(issue:FleetIssue)=>void}) {
  const openIssues=issues.filter(issue=>issue.status==='Open');
  return <div className="page"><div className="page-heading"><div><h1 className="fleet-title">Fleet <span aria-hidden="true">-</span> <a href="#fleet-issues">{openIssues.length} {openIssues.length===1?'Issue':'Issues'}</a></h1></div><div className="fleet-heading-actions">{canManage&&<><button className="primary desktop-add" onClick={onAdd}><Plus size={19}/> Add vehicle</button><button className="primary mobile-add-vehicle" onClick={onAdd}><Plus size={18}/> Add vehicle</button></>}</div></div>
    <section className="stats-row fleet-stats">
      <Stat label="Total vehicles" value={vehicles.length}/>
      <Stat label="Ready" value={vehicles.filter(v=>v.status==='Ready').length}/>
      <Stat label="Needs attention" value={vehicles.filter(v=>['Maintenance','Out of service'].includes(v.status)).length}/>
    </section>
    <section className="inventory-panel"><div className="inventory-tools"><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search vehicles" aria-label="Search vehicles"/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear vehicle search"><X size={16}/></button>}</div><div className="filter-wrap"><SlidersHorizontal size={17}/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'All')} aria-label="Filter by status"><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="list-label"><b>{filtered.length} {filtered.length===1?'vehicle':'vehicles'}</b><span>Updated now</span></div>
      <div className="vehicle-list">{filtered.map(v=><VehicleCard key={v.id} vehicle={v} assignedName={crew.find(member=>member.id===v.assignedTo)?.name} issueCount={issues.filter(issue=>issue.vehicleId===v.id&&issue.status==='Open').length} onClick={()=>onSelect(v)}/>)}
      {!filtered.length && <div className="empty"><Search/><h3>No vehicles found</h3><p>Try another search or clear current filter.</p><button className="secondary" onClick={()=>{setQuery('');setFilter('All')}}>Clear filters</button></div>}</div>
    </section>
    <FleetIssues issues={openIssues} vehicles={vehicles} onNewIssue={onNewIssue} onSelect={onSelectIssue}/>
  </div>
}
function FleetIssues({issues,vehicles,onNewIssue,onSelect}:{issues:FleetIssue[];vehicles:Vehicle[];onNewIssue:()=>void;onSelect:(issue:FleetIssue)=>void}) {
  const vehicleName=(id:string)=>vehicles.find(v=>v.id===id)?.unit??'Unknown vehicle';
  return <section className="issues-panel fleet-issues" id="fleet-issues"><div className="fleet-issues-heading"><div><div className="fleet-issues-title"><h2>Current issues</h2><button className="primary" onClick={onNewIssue}><Plus size={17}/> New issue</button></div><p>{issues.length} open</p></div></div><div className="issue-list">{issues.map(issue=><button className="issue-card" onClick={()=>onSelect(issue)} key={issue.id}><div className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></div><div className="issue-copy"><div className="issue-title"><h3>{issue.title}</h3><div className="issue-badges"><span className="issue-status">Open</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority}</span></div></div><p>{issue.description}</p><div className="issue-meta"><b>{vehicleName(issue.vehicleId)}</b><span>Reported by {issue.createdBy}</span><span>{issue.updates.length} {issue.updates.length===1?'update':'updates'}</span><span>{new Date(issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div></div><ChevronRight className="card-arrow"/></button>)}{!issues.length&&<div className="empty compact-empty"><Check/><h3>No open issues</h3><p>Fleet has no current reported issues.</p></div>}</div></section>
}
function Stat({label,value,icon,tone='dark'}:{label:string;value:number;icon?:React.ReactNode;tone?:string}) {return <div className={`stat ${icon?'':'no-icon'}`}>{icon&&<div className={`stat-icon ${tone}`}>{icon}</div>}<div><strong>{value}</strong><span>{label}</span></div></div>}
function VehicleCard({vehicle,assignedName,issueCount,onClick}:{vehicle:Vehicle;assignedName?:string;issueCount:number;onClick:()=>void}) {
  return <button className="vehicle-card" onClick={onClick}><div className="vehicle-icon">{vehicle.photo?<img src={vehicle.photo.dataUrl} alt="" loading="lazy" decoding="async"/>:vehicle.type==='Dozer'?<Wrench/>:<Truck/>}</div><div className="vehicle-info"><div className="vehicle-title"><h3>{vehicle.unit}</h3><StatusBadge status={vehicle.status}/></div><p>{vehicle.year} {vehicle.make} {vehicle.model}</p><div className="vehicle-meta"><span><CarFront/> {vehicle.type}</span>{assignedName&&<span className="vehicle-assignee"><CircleUserRound/> {assignedName}</span>}<span className={issueCount?'open-issues':''}><CircleAlert/> {issueCount} open {issueCount===1?'issue':'issues'}</span></div></div><ChevronRight className="card-arrow"/></button>
}
function StatusBadge({status}:{status:Status}) {return <span className={`status ${status.toLowerCase().replace(/ /g,'-')}`}><i/>{status}</span>}

function Dashboard({vehicles,issues,crew,activities,isOwner,onSelectVehicle,onSelectIssue,onSelectCrew}:{vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];activities:Activity[];isOwner:boolean;onSelectVehicle:(v:Vehicle)=>void;onSelectIssue:(issue:FleetIssue)=>void;onSelectCrew:(member:CrewMember)=>void}) {
  const neededVehicles = vehicles.filter(v => v.status === 'Maintenance' || v.status === 'Out of service');
  const openIssues = issues.filter(issue => issue.status === 'Open');
  const neededCount = neededVehicles.length + openIssues.length;
  const openActivity=(activity:Activity)=>{if(activity.targetType==='vehicle'){const vehicle=vehicles.find(item=>item.id===activity.targetId);if(vehicle)onSelectVehicle(vehicle)}if(activity.targetType==='issue'){const issue=issues.find(item=>item.id===activity.targetId);if(issue)onSelectIssue(issue)}if(activity.targetType==='crew'){const member=crew.find(item=>item.id===activity.targetId);if(member)onSelectCrew(member)}};
  const formatDate = (date:string) => new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="page overview-page"><div className="page-heading"><div><h1>Dashboard</h1></div></div>
    <section className="action-section"><div className="action-heading"><div><h2>Needed actions</h2><p>Items requiring attention</p></div><span className="action-count">{neededCount}</span></div>
      <div className="action-list">{openIssues.map(issue=><button className="action-row" key={`issue-${issue.id}`} onClick={()=>onSelectIssue(issue)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{issue.title}</b><small>{vehicles.find(v=>v.id===issue.vehicleId)?.unit??'Unknown vehicle'} · {issue.priority} priority · Open issue</small></span><ChevronRight/></button>)}{neededVehicles.map(v=><button className="action-row" key={`vehicle-${v.id}`} onClick={()=>onSelectVehicle(v)}><span className="action-icon urgent"><AlertTriangle/></span><span className="action-copy"><b>{v.status === 'Out of service' ? `Resolve out-of-service status for ${v.unit}` : `Complete maintenance for ${v.unit}`}</b><small>{v.year} {v.make} {v.model} · {v.status}</small></span><ChevronRight/></button>)}
      {!neededCount&&<div className="action-empty"><span><Check/></span><div><b>All caught up</b><p>No fleet actions need attention.</p></div></div>}</div>
    </section>
    {isOwner&&<section className="action-section"><div className="action-heading"><div><h2>Recent actions</h2><p>Activity from everyone in your company</p></div></div>
      <div className="action-list">{activities.slice(0,10).map(activity=><button className="action-row" key={activity.id} onClick={()=>openActivity(activity)}><span className={`action-icon ${activity.tone??'complete'}`}>{activity.tone==='urgent'?<AlertTriangle/>:<Check/>}</span><span className="action-copy"><b>{activity.action}</b><small>{activity.createdBy} · {activity.detail}</small></span><span className="action-time"><Clock3/>{formatDate(activity.createdAt)}</span><ChevronRight/></button>)}{!activities.length&&<div className="action-empty"><span><Clock3/></span><div><b>No recent actions</b><p>Company activity will appear here.</p></div></div>}</div>
    </section>}
  </div>
}
function Company({company,owner}:{company:CompanyInfo;owner:string}) {const initials=company.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase();return <div className="page"><div className="page-heading"><div><h1>Company</h1><p>Business details for your FireOps account.</p></div></div><section className="company-card"><div className="company-logo">{initials}</div><div><h2>{company.name}</h2><p>{company.industry||'Industry not specified'}</p></div><dl><div><dt>Owner</dt><dd>{owner}</dd></div><div><dt>Company ID</dt><dd>{company.code}</dd></div></dl></section></div>}

function CrewPage({crew,onInvite,onSelect}:{crew:CrewMember[];onInvite:()=>void;onSelect:(member:CrewMember)=>void}) {
  return <div className="page crew-page"><div className="page-heading"><div><h1>Crew</h1></div><button className="primary desktop-add" onClick={onInvite}><UserPlus/> Invite user</button></div>
    <section className="stats-row crew-stats"><Stat label="Total crew" value={crew.length}/><Stat label="Active" value={crew.filter(member=>member.status==='Active').length}/><Stat label="Invitations" value={crew.filter(member=>member.status==='Invited').length}/></section>
    <section className="crew-panel"><div className="list-label"><b>Company crew</b><span>{crew.length} people</span></div><div className="crew-list">{crew.map(member=><button className="crew-row" key={member.id} onClick={()=>onSelect(member)}><span className="crew-avatar">{member.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span><span className="crew-copy"><span className="crew-name"><b>{member.name}</b>{member.role==='owner'&&<em>Owner</em>}<i className={member.status.toLowerCase()}>{member.status}</i></span><small><Mail/> {member.email}</small><small><Phone/> {member.phone||'No phone added'}</small></span><span className={member.credential?'credential-state complete':member.credentialName?'credential-state named':'credential-state'}><ShieldCheck/>{member.credential?.name??member.credentialName??'No credential'}</span><ChevronRight className="card-arrow"/></button>)}</div></section>
    <button className="fab" onClick={onInvite}><UserPlus/><span>Invite user</span></button>
  </div>;
}
function InviteCrewForm({existing,companyName,onClose,onSave}:{existing:CrewMember[];companyName:string;onClose:()=>void;onSave:(member:CrewMember)=>void}) {
  const [form,setForm]=useState({email:'',name:'',phone:''});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const formRef=useRef<HTMLFormElement>(null);
  const dialog=useDialogA11y(onClose);
  const submit=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const email=form.email.trim().toLowerCase();const next:Record<string,string>={};if(!/^\S+@\S+\.\S+$/.test(email))next.email='Enter a valid email address';if(existing.some(member=>member.email.toLowerCase()===email))next.email='This user is already on your crew';setErrors(next);if(Object.keys(next).length){focusFirstInvalid(event.currentTarget);return}const fallback=email.split('@')[0].split(/[._-]/).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');onSave({id:crypto.randomUUID(),name:form.name.trim()||fallback,email,phone:form.phone.trim(),role:'member',status:'Invited'})};
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer invite-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close invite form"><ArrowLeft/></button><div><h2 id={dialog.titleId}>Invite crew member</h2><p>They will receive an email to create their account.</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><FormErrorSummary errors={errors} formRef={formRef}/><FormSection number="1" title="Crew details"><div className="form-grid"><Field label="Email address" required error={errors.email} wide><input name="email" type="email" maxLength={254} value={form.email} onChange={event=>setForm({...form,email:event.target.value})} placeholder="name@company.com" autoFocus/></Field><Field label="Full name" wide><input maxLength={120} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Optional until invite is accepted"/></Field><Field label="Phone" wide><input type="tel" maxLength={30} value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})} placeholder="Optional"/></Field></div></FormSection><div className="invite-note"><Mail/><div><b>Email invitation to {companyName}</b><p>Invite remains pending until user signs in and joins {companyName}.</p></div></div><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit"><UserPlus/> Send invitation</button></footer></form></section></div>;
}
function CrewDetail({member,vehicles,uploadFile,onClose,onSave,onAssign}:{member:CrewMember;vehicles:Vehicle[];uploadFile?:(file:File)=>Promise<VehicleFile>;onClose:()=>void;onSave:(member:CrewMember)=>void;onAssign:(vehicleId:string)=>void}) {
  const [credential,setCredential]=useState<VehicleFile|undefined>(member.credential);
  const [credentialName,setCredentialName]=useState(member.credentialName??'');
  const [vehicleId,setVehicleId]=useState('');
  const changed=credential!==member.credential||credentialName!==(member.credentialName??'');
  const assignedVehicles=vehicles.filter(vehicle=>vehicle.assignedTo===member.id);
  const availableVehicles=vehicles.filter(vehicle=>!vehicle.assignedTo&&['Ready','Assigned'].includes(vehicle.status));
  const canAssign=member.status==='Active'&&availableVehicles.length>0;
  const assignmentId=useId();
  const dialog=useDialogA11y(onClose);
  const assignVehicle=()=>{if(!vehicleId||!canAssign)return;onAssign(vehicleId);setVehicleId('')};
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer crew-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close crew details"><ArrowLeft/></button><div><h2 id={dialog.titleId}>{member.name}</h2></div><button className="close" onClick={onClose} aria-label="Close crew details"><X/></button></header><div className="crew-profile"><span className="crew-avatar large">{member.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span><span className={`crew-status ${member.status.toLowerCase()}`}>{member.status}</span><h3>{member.name}</h3><p>{member.role==='owner'?'Company owner':'Crew member'}</p></div><div className="detail-section"><h4>Contact information</h4><dl className="details"><Detail icon={<Mail/>} label="Email" value={member.email}/><Detail icon={<Phone/>} label="Phone" value={member.phone||'Not added'}/></dl></div><div className="detail-section"><h4>Credentials</h4><div className="credential-editor"><Field label="Credential name"><input maxLength={120} value={credentialName} onChange={event=>setCredentialName(event.target.value)} placeholder="e.g. Red Card, EMT"/></Field><FileUpload label="Image or PDF" accept="image/*,.pdf,application/pdf" file={credential} uploadFile={uploadFile} onChange={setCredential}/>{credential&&<a href={credential.dataUrl} target="_blank" rel="noreferrer">View current file</a>}</div><button className="primary save-credential" disabled={!changed} onClick={()=>onSave({...member,credential,credentialName:credentialName.trim()})}><ShieldCheck/> Save credentials</button></div><div className="detail-section"><h4>Assigned vehicles</h4>{assignedVehicles.length?<div className="assigned-vehicles">{assignedVehicles.map(vehicle=><div key={vehicle.id}><Truck/><span><b>{vehicle.unit}</b><small>{vehicle.year} {vehicle.make} {vehicle.model}</small></span></div>)}</div>:<p className="no-updates">No vehicles assigned.</p>}</div><div className="detail-section crew-assignment"><h4>Assign vehicle</h4><label htmlFor={assignmentId}>Vehicle</label><div><select id={assignmentId} value={vehicleId} disabled={!canAssign} onChange={event=>setVehicleId(event.target.value)}><option value="">Select vehicle</option>{availableVehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.year} {vehicle.make} {vehicle.model}</option>)}</select><button className="primary" disabled={!vehicleId||!canAssign} onClick={assignVehicle}><Truck/> Assign</button></div>{member.status==='Invited'?<p>Assignment available after invitation is accepted.</p>:!availableVehicles.length&&<p>No ready or unassigned vehicles available.</p>}</div></section></div>;
}

function VehicleForm({vehicle,uploadFile,onClose,onSave}:{vehicle?:Vehicle;uploadFile?:(file:File)=>Promise<VehicleFile>;onClose:()=>void;onSave:(v:Vehicle)=>void}) {
  const editing = Boolean(vehicle);
  const dialog=useDialogA11y(onClose);
  const [form,setForm]=useState({unit:vehicle?.unit??'',type:vehicle?.type??'Type 3 Engine',year:String(vehicle?.year??new Date().getFullYear()),make:vehicle?.make??'',model:vehicle?.model??'',vin:vehicle?.vin??'',plate:vehicle?.plate??'',status:vehicle?.status??'Ready' as Status,notes:vehicle?.notes??''});
  const [files,setFiles]=useState({photo:vehicle?.photo,contract:vehicle?.contract,viprChecklist:vehicle?.viprChecklist,registration:vehicle?.registration,insurance:vehicle?.insurance,dotInspection:vehicle?.dotInspection});
  const [selectedDocument,setSelectedDocument]=useState<VehicleDocumentKey|''>('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const formRef=useRef<HTMLFormElement>(null);
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const updateFile=(key:keyof typeof files,file?:VehicleFile)=>setFiles(current=>({...current,[key]:file}));
  const submit=(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const next:Record<string,string>={};if(!form.unit.trim())next.unit='Unit name is required';if(!form.make.trim())next.make='Make is required';if(!form.model.trim())next.model='Model is required';if(!form.year||Number(form.year)<1950||Number(form.year)>new Date().getFullYear()+1)next.year='Enter a valid year';if(form.status==='Assigned'&&!vehicle?.assignedTo)next.status='Assign a crew member from vehicle details before using Assigned status';setErrors(next);if(Object.keys(next).length){focusFirstInvalid(e.currentTarget);return}onSave({id:vehicle?.id??crypto.randomUUID(),unit:form.unit.trim(),type:form.type,year:Number(form.year),make:form.make.trim(),model:form.model.trim(),vin:form.vin.trim().toUpperCase(),plate:form.plate.trim().toUpperCase(),status:form.status,...files,notes:form.notes.trim(),createdAt:vehicle?.createdAt??new Date().toISOString(),assignedTo:vehicle?.assignedTo})};
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close vehicle form"><ArrowLeft/></button><div><h2 id={dialog.titleId}>{editing?'Edit vehicle':'Add vehicle'}</h2><p>{editing?'Update fleet details for this vehicle.':'Enter basic details. You can update these later.'}</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate>
    <FormErrorSummary errors={errors} formRef={formRef}/><FormSection number="1" title="Vehicle details" hideLegend={editing}><div className="form-grid"><Field label="Unit name" required error={errors.unit}><input name="unit" maxLength={120} value={form.unit} onChange={e=>update('unit',e.target.value)} placeholder="e.g. Engine 702" autoFocus/></Field><Field label="Vehicle type" required><select value={form.type} onChange={e=>update('type',e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select></Field><Field label="Year" required error={errors.year}><input name="year" type="number" inputMode="numeric" value={form.year} onChange={e=>update('year',e.target.value)}/></Field><Field label="Make" required error={errors.make}><input name="make" maxLength={80} value={form.make} onChange={e=>update('make',e.target.value)} placeholder="e.g. International"/></Field><Field label="Model" required error={errors.model}><input name="model" maxLength={80} value={form.model} onChange={e=>update('model',e.target.value)} placeholder="e.g. HV"/></Field><Field label="Status" error={errors.status}><select name="status" value={form.status} onChange={e=>update('status',e.target.value)}>{statuses.map(s=><option key={s} disabled={s==='Assigned'&&!vehicle?.assignedTo}>{s}</option>)}</select></Field></div></FormSection>
    <FormSection number="2" title="Registration & documents" optional><div className="form-grid"><Field label="VIN"><input value={form.vin} onChange={e=>update('vin',e.target.value)} maxLength={17} placeholder="17-character VIN"/></Field><Field label="License plate"><input maxLength={20} value={form.plate} onChange={e=>update('plate',e.target.value)} placeholder="Plate number"/></Field><div className="wide"><FileUpload label="Vehicle photo" accept="image/*" file={files.photo} uploadFile={uploadFile} onChange={file=>updateFile('photo',file)}/></div><div className="document-picker wide"><label htmlFor="vehicle-document-type"><span>Document to add</span><select id="vehicle-document-type" value={selectedDocument} onChange={event=>setSelectedDocument(event.target.value as VehicleDocumentKey|'')}><option value="">Select document type</option>{vehicleDocumentOptions.map(({key,label})=><option key={key} value={key}>{label}{files[key]?' · Added':''}</option>)}</select></label>{selectedDocument&&<FileUpload label={files[selectedDocument]?`Replace ${vehicleDocumentOptions.find(option=>option.key===selectedDocument)?.label}`:`Add ${vehicleDocumentOptions.find(option=>option.key===selectedDocument)?.label}`} accept="image/*,.pdf,application/pdf" file={files[selectedDocument]} uploadFile={uploadFile} onChange={file=>updateFile(selectedDocument,file)}/>}</div><Field label="Notes" wide><textarea maxLength={2000} value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="Anything else to know about this vehicle"/></Field></div></FormSection>
    <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit">{editing?<Pencil/>:<Plus/>} {editing?'Save changes':'Add to inventory'}</button></footer>
  </form></section></div>
}
function IssueForm({vehicles,initialVehicleId,user,onClose,onSave}:{vehicles:Vehicle[];initialVehicleId?:string;user:FireOpsUser;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [form,setForm]=useState({vehicleId:initialVehicleId||vehicles[0]?.id||'',title:'',description:'',priority:'Medium' as Priority});
  const dialog=useDialogA11y(onClose);
  const [errors,setErrors]=useState<Record<string,string>>({});
  const formRef=useRef<HTMLFormElement>(null);
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const submit=(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const next:Record<string,string>={};if(!form.vehicleId)next.vehicleId='Select a vehicle';if(!form.title.trim())next.title='Issue title is required';if(!form.description.trim())next.description='Description is required';setErrors(next);if(Object.keys(next).length){focusFirstInvalid(e.currentTarget);return}onSave({id:crypto.randomUUID(),vehicleId:form.vehicleId,title:form.title.trim(),description:form.description.trim(),priority:form.priority,status:'Open',updates:[],createdBy:user.name,createdAt:new Date().toISOString()})};
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer issue-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close issue form"><ArrowLeft/></button><div><h2 id={dialog.titleId}>New issue</h2><p>Report a vehicle problem for company review.</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><FormErrorSummary errors={errors} formRef={formRef}/><fieldset><legend className="sr-only">Issue details</legend><div className="form-grid"><Field label="Vehicle" required error={errors.vehicleId} wide><select name="vehicleId" value={form.vehicleId} onChange={e=>update('vehicleId',e.target.value)} autoFocus><option value="">Select a vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.unit} — {v.year} {v.make} {v.model}</option>)}</select></Field><Field label="Issue title" required error={errors.title} wide><input name="title" maxLength={160} value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Pump losing pressure"/></Field><Field label="Description" required error={errors.description} wide><textarea name="description" maxLength={2000} value={form.description} onChange={e=>update('description',e.target.value)} placeholder="Describe the issue and when it occurs"/></Field><Field label="Priority" required wide><select value={form.priority} onChange={e=>update('priority',e.target.value)}>{priorities.map(p=><option key={p}>{p}</option>)}</select></Field></div></fieldset><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit"><Plus/> Create issue</button></footer></form></section></div>
}
function focusFirstInvalid(form: HTMLFormElement) {
  window.requestAnimationFrame(()=>form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
function FormErrorSummary({errors,formRef}:{errors:Record<string,string>;formRef:React.RefObject<HTMLFormElement|null>}) {
  const entries=Object.entries(errors);
  if(!entries.length)return null;
  return <div className="form-error-summary" role="alert"><b>Correct {entries.length===1?'this field':'these fields'}:</b><ul>{entries.map(([field,message])=><li key={field}><button type="button" onClick={()=>formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()}>{message}</button></li>)}</ul></div>;
}
function FormSection({number,title,optional,hideLegend,children}:{number:string;title:string;optional?:boolean;hideLegend?:boolean;children:React.ReactNode}) {return <fieldset><legend className={hideLegend?'sr-only':undefined}><span>{number}</span>{title}{optional&&<em>Optional</em>}</legend>{children}</fieldset>}
function Field({label,required,error,wide,children}:{label:string;required?:boolean;error?:string;wide?:boolean;children:React.ReactNode}) {
  const errorId = useId();
  const control = isValidElement<Record<string, unknown>>(children) ? cloneElement(children, {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined
  }) : children;
  return <label className={`${error?'has-error':''} ${wide?'wide':''}`}><span>{label}{required&&<b aria-hidden="true">*</b>}{required&&<span className="sr-only"> required</span>}</span>{control}{error&&<small id={errorId} role="alert">{error}</small>}</label>;
}
function FileUpload({label,accept,file,uploadFile,onChange}:{label:string;accept:string;file?:VehicleFile;uploadFile?:(file:File)=>Promise<VehicleFile>;onChange:(file?:VehicleFile)=>void}) {
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const selectFile=async(selected?:File)=>{if(!selected)return;setError('');if(selected.size>8*1024*1024){setError('File must be 8 MB or smaller.');return}setBusy(true);try{if(uploadFile){onChange(await uploadFile(selected));return}const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('read'));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(selected)});onChange({name:selected.name,type:selected.type,dataUrl})}catch{setError('File could not be uploaded. Check your connection and try again.')}finally{setBusy(false)}};
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return <div className="upload-field"><span id={`${inputId}-label`}>{label}</span><label className={file?'has-file':''} htmlFor={inputId}><input id={inputId} type="file" accept={accept} disabled={busy} aria-labelledby={`${inputId}-label`} aria-describedby={error?errorId:undefined} aria-invalid={error?true:undefined} onChange={e=>void selectFile(e.target.files?.[0])}/>{busy?<Upload/>:file?(file.type.startsWith('image/')?<FileImage/>:<FileText/>):<Upload/>}<span>{busy?'Uploading...':file?.name??'Choose file'}</span></label>{file&&<button type="button" onClick={()=>onChange(undefined)} aria-label={`Remove ${label}`}>Remove</button>}{error&&<small id={errorId} role="alert">{error}</small>}</div>
}

function VehicleDetail({vehicle,issues,crew,user,canManage,onClose,onEdit,onNewIssue,onIssue,onStatus,onAssignee,onAssign}:{vehicle:Vehicle;issues:FleetIssue[];crew:CrewMember[];user:FireOpsUser;canManage:boolean;onClose:()=>void;onEdit:()=>void;onNewIssue:()=>void;onIssue:(issue:FleetIssue)=>void;onStatus:(s:Status)=>void;onAssignee:(memberId:string)=>void;onAssign:()=>void}) {const openIssues=issues.filter(issue=>issue.status==='Open');const resolvedIssues=issues.filter(issue=>issue.status==='Resolved').sort((a,b)=>Date.parse(b.resolvedAt??b.createdAt)-Date.parse(a.resolvedAt??a.createdAt));const activeCrew=crew.filter(member=>member.status==='Active');const documents=vehicleDocumentOptions.map(({key,label})=>({label,file:vehicle[key]})).filter(({file})=>Boolean(file));const dialog=useDialogA11y(onClose);return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close vehicle details"><ArrowLeft/></button><div><h2 id={dialog.titleId}>{vehicle.unit}</h2></div><div className="detail-actions"><button className="close" onClick={onClose} aria-label="Close vehicle details"><X/></button></div></header><div className="detail-hero"><div className={`large-vehicle-icon ${vehicle.photo?'has-photo':''}`}>{vehicle.photo?<img src={vehicle.photo.dataUrl} alt={`${vehicle.unit} vehicle`} loading="lazy" decoding="async"/>:<Truck/>}</div><StatusBadge status={vehicle.status}/><h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3><p>{vehicle.type}</p>{vehicle.assignedTo&&<span className="assigned-person"><CircleUserRound/> Assigned to {crew.find(member=>member.id===vehicle.assignedTo)?.name??'Crew member'}</span>}<div className="vehicle-detail-buttons"><button className="issue-vehicle-button" onClick={onNewIssue}><CircleAlert/> Open issue</button><button className={vehicle.assignedTo===user.id?'assignment-button assigned':'assignment-button'} disabled={Boolean(vehicle.assignedTo&&vehicle.assignedTo!==user.id)} onClick={onAssign}>{vehicle.assignedTo===user.id?<><Check/> Assigned to me</>:vehicle.assignedTo?<><CircleUserRound/> Assigned</>:<><CircleUserRound/> Assign to me</>}</button></div></div><div className="detail-section"><h4>Current status</h4><label className={`status-select ${canManage?'':'readonly'}`}><span className="sr-only">Current vehicle status</span><select value={vehicle.status} disabled={!canManage} onChange={event=>onStatus(event.target.value as Status)}>{statuses.map(s=><option key={s} disabled={s==='Assigned'&&!vehicle.assignedTo}>{s}</option>)}</select></label>{canManage&&<label className="assignee-select"><span>Assigned crew member</span><select value={vehicle.assignedTo??''} onChange={event=>onAssignee(event.target.value)}><option value="">No crew member assigned</option>{activeCrew.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select><small>Selecting crew changes status to Assigned.</small></label>}</div>{openIssues.length>0&&<div className="detail-section vehicle-issues"><h4>Open issues <span>{openIssues.length}</span></h4>{openIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></span><span><b>{issue.title}</b><small>{issue.priority} priority · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{canManage&&<button className="edit-vehicle edit-vehicle-wide" onClick={onEdit}><Pencil/> Edit vehicle details</button>}<div className="detail-section"><h4>Vehicle information</h4><dl className="details"><Detail icon={<Hash/>} label="VIN" value={vehicle.vin||'Not added'}/><Detail icon={<CarFront/>} label="License plate" value={vehicle.plate||'Not added'}/><Detail icon={<CalendarDays/>} label="Added" value={new Date(vehicle.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}/></dl></div><div className="detail-section"><h4>Documents</h4>{documents.length?<div className="document-list">{documents.map(({label,file})=>file&&<a className="document-preview" key={label} href={file.dataUrl} target="_blank" rel="noreferrer" aria-label={`Open ${label}: ${file.name}`}><span className={`document-thumbnail ${file.type.startsWith('image/')?'image':''}`}>{file.type.startsWith('image/')?<img src={file.dataUrl} alt="" loading="lazy" decoding="async"/>:<FileText/>}</span><span className="document-copy"><b>{label}</b><small>{file.name}</small></span><ExternalLink/></a>)}</div>:<p className="no-updates">No documents added.</p>}</div>{resolvedIssues.length>0&&<div className="detail-section vehicle-issues resolved-vehicle-issues"><h4>Resolved issues <span>{resolvedIssues.length}</span></h4>{resolvedIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className="priority-icon resolved"><Check/></span><span><b>{issue.title}</b><small>Resolved {new Date(issue.resolvedAt??issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{vehicle.notes&&<div className="detail-section"><h4>Notes</h4><p className="notes">{vehicle.notes}</p></div>}</section></div>}
function IssueDetail({issue,vehicle,user,onClose,onSave}:{issue:FleetIssue;vehicle?:Vehicle;user:FireOpsUser;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [updateText,setUpdateText]=useState('');
  const dialog=useDialogA11y(onClose);
  const updateId=useId();
  const saveUpdate=(status?:IssueStatus)=>{if(!updateText.trim())return;const now=new Date().toISOString();const nextStatus=status??issue.status;onSave({...issue,status:nextStatus,resolvedAt:nextStatus==='Resolved'?(issue.resolvedAt??now):undefined,updates:[{id:crypto.randomUUID(),text:updateText.trim(),createdBy:user.name,createdAt:now},...issue.updates]});setUpdateText('')};
  const addUpdate=(e:React.FormEvent)=>{e.preventDefault();saveUpdate()};
  const formatDate=(date:string)=>new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer issue-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Close issue details"><ArrowLeft/></button><div><h2 id={dialog.titleId}>{issue.title}</h2></div><button className="close" onClick={onClose} aria-label="Close issue details"><X/></button></header><div className="issue-detail-summary">{vehicle&&<div className="issue-vehicle-context"><span><Truck/></span><div><b>{vehicle.unit}</b><small>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.type}</small></div><StatusBadge status={vehicle.status}/></div>}<div className="issue-badges"><span className={`issue-status ${issue.status.toLowerCase()}`}>{issue.status}</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority} priority</span></div><p>{issue.description}</p><small>Reported by {issue.createdBy} · {formatDate(issue.createdAt)}</small></div><div className="detail-section"><h4>Add update</h4><form className="update-form" onSubmit={addUpdate}><label htmlFor={updateId}>Progress, repair, or inspection notes</label><textarea id={updateId} maxLength={2000} value={updateText} onChange={e=>setUpdateText(e.target.value)} placeholder="Describe work completed or next steps"/><div className="update-actions"><button className="primary" disabled={!updateText.trim()}><MessageSquare/> Add update</button><button type="button" className={issue.status==='Open'?'resolve-button':'reopen-button'} disabled={!updateText.trim()} onClick={()=>saveUpdate(issue.status==='Open'?'Resolved':'Open')}>{issue.status==='Open'?<Check/>:<CircleAlert/>}{issue.status==='Open'?'Mark as resolved':'Reopen issue'}</button></div></form></div><div className="detail-section issue-history"><h4>Updates <span>{issue.updates.length}</span></h4>{issue.updates.map(update=><article key={update.id}><span><MessageSquare/></span><div><p>{update.text}</p><small>{update.createdBy} · {formatDate(update.createdAt)}</small></div></article>)}{!issue.updates.length&&<p className="no-updates">No updates yet.</p>}</div></section></div>
}
function Detail({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {return <div><dt>{icon}<span>{label}</span></dt><dd>{value}</dd></div>}
function MobileNav({page,setPage,user}:{page:Page;setPage:(p:Page)=>void;user:FireOpsUser}) {const item=(target:Page,label:string,icon:React.ReactNode)=><button className={page===target?'active':''} aria-current={page===target?'page':undefined} onClick={()=>setPage(target)}>{icon}<span>{label}</span></button>;return <nav className="mobile-nav" aria-label="Primary">{item('overview','Dashboard',<LayoutDashboard/>)}{item('vehicles','Fleet',<Truck/>)}{user.role==='owner'&&item('crew','Crew',<Users/>)}{item('company','Company',<CircleUserRound/>)}</nav>}
