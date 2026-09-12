import StoredDocumentsPage from './StoredDocumentsPage';
import {QuickActions, AvailabilityPage} from './QuickActions';
import {OwnerDashboard} from './OwnerDashboard';
import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from './useDialogA11y';
import OperationsPage, {fetchIncidents} from './OperationsPage';
import TrainingPage from './TrainingPage';
import InventoryPage from './InventoryPage';
import ReceiptsPage from './ReceiptsPage';
import NationalFireActivitySection from './NationalFireActivitySection';
import {
  crewCredentials, dashboardNotifications, isDocumentUnread, isThreadUnread, isTrainingUnread, normalizeVehicle, normalizeVehicles, trainingStage,
  type Activity, type CommunicationReply, type CommunicationThread, type CompanyDocument, type CompanyInfo,
  type CrewCredential, type CrewMember, type DashboardNotification, type FireOpsUser, type FleetIssue,
  type FleetRemoteChange, type FleetSnapshot, type InventoryItem, type IssuePriority as Priority, type IssueStatus,
  type MotiveConnection, type NamedDocument, type NifcIncident, type Training, type TrainingSignup,
  type UserRole, type Vehicle, type VehicleFile, type VehicleStatus as Status,
} from '@fireops/domain';
export {dashboardNotifications,isDocumentUnread,isThreadUnread} from '@fireops/domain';
export type {
  Activity,CommunicationReply,CommunicationThread,CompanyDocument,CompanyInfo,CrewCredential,CrewMember,
  DashboardNotification,FireOpsUser,FleetIssue,FleetRemoteChange,FleetSnapshot,MotiveConnection,NamedDocument,
  UserRole,Vehicle,VehicleFile,
} from '@fireops/domain';
export type VehicleTypeOption = {id:string;name:string};
import {
  AlertTriangle, ArrowLeft, Building2, CalendarDays, Camera, CarFront, Check, ChevronRight, Flame, GraduationCap,
  Bell, CircleAlert, CircleUserRound, Clock3, ExternalLink, Eye, EyeOff, FileImage, FileText, Gauge, Hash, KeyRound, LayoutDashboard, LogOut, Mail, Map as MapIcon, MapPin, MessageSquare, Package, Pencil, Phone, Plus,
  CircleDollarSign, Ellipsis, Moon, Search, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Sun, Trash2, Truck, Upload, UserPlus, Users, Wrench, X
} from 'lucide-react';

type Page = 'overview' | 'vehicles' | 'crew' | 'communications' | 'operations' | 'documents' | 'receipts' | 'invoices' | 'payroll' | 'availability' | 'training' | 'inventory' | 'more' | 'settings';
type NavigablePage = Exclude<Page,'more'>;

const navigationMeta = {
  overview:{label:'Dashboard',description:'Readiness and recent activity',Icon:LayoutDashboard},
  operations:{label:'Operations',description:'Active fires and assigned resources',Icon:MapIcon},
  communications:{label:'Communications',description:'Company updates and replies',Icon:MessageSquare},
  vehicles:{label:'Fleet',description:'Vehicles, assignments, and issues',Icon:Truck},
  crew:{label:'Crew',description:'Manage access, assignments, and credentials',Icon:Users},
  documents:{label:'Documents',description:'Company files and reference documents',Icon:FileText},
  invoices:{label:'Invoices',description:'Upload and review invoices',Icon:FileText},
  payroll:{label:'Payroll',description:'Upload and review payroll documents',Icon:CircleDollarSign},
  availability:{label:'Availability',description:'Crew assignment availability',Icon:CircleUserRound},
  receipts:{label:'Receipts',description:'Upload and review expense receipts',Icon:CircleDollarSign},
  training:{label:'Training',description:'Courses, registration, and attendance',Icon:GraduationCap},
  inventory:{label:'Inventory',description:'Company supplies and equipment counts',Icon:Package},
  settings:{label:'Settings',description:'Company details and integrations',Icon:SettingsIcon},
} satisfies Record<NavigablePage,{label:string;description:string;Icon:typeof LayoutDashboard}>;
const navigationOrder:NavigablePage[]=['overview','operations','communications','vehicles','crew','documents','receipts','invoices','payroll','availability','training','inventory','settings'];
const mobilePrimaryOrder:NavigablePage[]=['overview','operations','vehicles','communications'];

export function navigationLayout(role:UserRole){
  const desktop=navigationOrder.filter(page=>!['crew'].includes(page)||role==='owner');
  const mobilePrimary=mobilePrimaryOrder.filter(page=>desktop.includes(page));
  return {desktop,mobilePrimary,mobileOverflow:desktop.filter(page=>!mobilePrimary.includes(page))};
}
type VehicleDocumentKey = 'contract' | 'viprChecklist' | 'registration' | 'insurance' | 'dotInspection';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type UndoAction = { vehicle: Vehicle; label: string };

const seed: Vehicle[] = [
  {id:'v1',unit:'Engine 701',type:'Type 3 Engine',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',status:'Ready',createdAt:'2025-02-04'},
  {id:'v2',unit:'Tender 12',type:'Water Tender',year:2017,make:'Peterbilt',model:'367',vin:'1XPTD4EX8HD397122',plate:'CA 8T012',status:'Assigned',createdAt:'2025-01-18'},
  {id:'v3',unit:'Dozer 4',type:'Dozer',year:2014,make:'Caterpillar',model:'D7R',vin:'CAT00D7RJLGP01234',plate:'',status:'Maintenance',createdAt:'2024-12-11'}
];
const defaultVehicleTypeNames = ['Type 3 Engine','Type 4 Engine','Type 6 Engine','Water Tender','Crew Carrier','Crew Transport','Command Vehicle','Dozer','Transport','Support Vehicle','Other'];
const defaultVehicleTypes:VehicleTypeOption[]=defaultVehicleTypeNames.map((name,index)=>({id:`default-${index}`,name}));
const statuses: Status[] = ['Ready','Assigned','Maintenance','Out of service'];
const priorities: Priority[] = ['Low','Medium','High','Critical'];
const vehicleDocumentOptions: {key:VehicleDocumentKey;label:string}[] = [
  {key:'contract',label:'Contract'},
  {key:'viprChecklist',label:'VIPR checklist'},
  {key:'registration',label:'Registration'},
  {key:'insurance',label:'Insurance'},
  {key:'dotInspection',label:'DOT inspection'}
];
const demoUser: FireOpsUser = {id: 'u1', name: 'Ryan Mitchell', role: 'owner'};
const demoCompany: CompanyInfo = {name:'North Ridge Wildfire',code:'NRW-2048',industry:'Wildland fire contractor',crewInviteLimit:5,crewInvitedCount:2};
const seedCrew: CrewMember[] = [
  {id:'u1',name:'Ryan Mitchell',email:'ryan@northridgewildfire.com',phone:'(530) 555-0142',role:'owner',status:'Active',joinedAt:'2024-11-08'},
  {id:'u2',name:'Maya Torres',email:'maya@northridgewildfire.com',phone:'(530) 555-0198',role:'member',status:'Active',credentialName:'Red Card',joinedAt:'2025-01-16'},
  {id:'u3',name:'Cole Bennett',email:'cole@northridgewildfire.com',phone:'(530) 555-0117',role:'member',status:'Active',joinedAt:'2025-02-02'}
];

function saveLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function issueBelongsToUser(issue:FleetIssue,user:FireOpsUser) {
  return issue.createdById ? issue.createdById===user.id : issue.createdBy===user.name;
}

function vehicleDocuments(vehicle:Vehicle):NamedDocument[] {
  if(vehicle.documents?.length)return vehicle.documents;
  return vehicleDocumentOptions.flatMap(({key,label})=>vehicle[key]?[{id:`legacy-${key}`,name:label,file:vehicle[key]!}]:[]);
}

function loadDemoMotiveConnection():MotiveConnection {
  try {const stored=localStorage.getItem('fireops-motive-demo');return stored?JSON.parse(stored) as MotiveConnection:{connected:false,mock:true}}
  catch{return {connected:false,mock:true}}
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
function loadCommunicationThreads() {
  try {const stored=localStorage.getItem('fireops-communication-threads');return stored?JSON.parse(stored) as CommunicationThread[]:[]}
  catch{return []}
}
function loadCompanyDocuments() {
  try {const stored=localStorage.getItem('fireops-company-documents');return stored?JSON.parse(stored) as CompanyDocument[]:[]}
  catch{return []}
}
function loadTrainings() {
  try {const stored=localStorage.getItem('fireops-trainings');return stored?JSON.parse(stored) as Training[]:[]}
  catch{return []}
}
function loadInventory() {
  try {const stored=localStorage.getItem('fireops-inventory');return stored?JSON.parse(stored) as InventoryItem[]:[]}
  catch{return []}
}
function loadVehicleTypes() {
  try {const stored=localStorage.getItem('fireops-vehicle-types');const parsed=stored?JSON.parse(stored) as VehicleTypeOption[]:defaultVehicleTypes;return parsed.length?parsed:defaultVehicleTypes}
  catch{return defaultVehicleTypes}
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

type AppProps={
  user?:FireOpsUser;company?:CompanyInfo;companyId?:string;initialData?:FleetSnapshot;remoteChanges?:(FleetRemoteChange&{sequence:number})[];motiveConnection?:MotiveConnection;
  communicationThreads?:CommunicationThread[];communicationError?:string;companyDocuments?:CompanyDocument[];documentError?:string;trainings?:Training[];trainingError?:string;inventoryItems?:InventoryItem[];inventoryError?:string;vehicleTypeOptions?:VehicleTypeOption[];vehicleTypeError?:string;
  onDataChange?:(data:FleetSnapshot)=>Promise<void>|void;onInviteCrew?:(member:CrewMember)=>Promise<CrewMember>;onDeleteCrew?:(member:CrewMember)=>Promise<{accountDeleted?:boolean;accountCleanupFailed?:boolean}|void>;
  onSaveMotive?:(apiKey:string)=>Promise<MotiveConnection>;onDisconnectMotive?:()=>Promise<MotiveConnection>;onCreateThread?:(subject:string,description:string)=>Promise<CommunicationThread>;onReplyToThread?:(threadId:string,body:string)=>Promise<CommunicationReply>;onMarkThreadSeen?:(threadId:string)=>Promise<string>;
  onCreateDocument?:(name:string,file:VehicleFile)=>Promise<CompanyDocument>;onUpdateDocument?:(document:CompanyDocument,name:string,file?:VehicleFile)=>Promise<CompanyDocument>;onDeleteDocument?:(document:CompanyDocument)=>Promise<void>;onMarkDocumentViewed?:(documentId:string)=>Promise<string>;
  onCreateTraining?:(training:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>Promise<Training>;onUpdateTraining?:(trainingId:string,values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>Promise<Training>;onDeleteTraining?:(trainingId:string)=>Promise<void>;onSignupTraining?:(trainingId:string)=>Promise<TrainingSignup>;onCancelTrainingSignup?:(trainingId:string)=>Promise<void>;onMarkTrainingViewed?:(trainingId:string)=>Promise<string>;
  onCreateInventoryItem?:(name:string,quantity:number)=>Promise<InventoryItem>;onUpdateInventoryItem?:(item:InventoryItem,quantity:number)=>Promise<InventoryItem>;onDeleteInventoryItem?:(item:InventoryItem)=>Promise<void>;
  onCreateVehicleType?:(name:string)=>Promise<VehicleTypeOption>;onDeleteVehicleType?:(type:VehicleTypeOption)=>Promise<void>;
  onSignOut?:()=>void;onSwitchCompany?:()=>void;uploadFile?:(file:File)=>Promise<VehicleFile>;onCommitFiles?:(files:VehicleFile[])=>void;onDiscardFiles?:()=>Promise<void>|void;
};

export default function App({user=demoUser,company=demoCompany,companyId,initialData,remoteChanges,motiveConnection,communicationThreads,communicationError,companyDocuments,documentError,trainings:trainingData,trainingError,inventoryItems:inventoryData,inventoryError,vehicleTypeOptions:vehicleTypeData,vehicleTypeError,onDataChange,onInviteCrew,onDeleteCrew,onSaveMotive,onDisconnectMotive,onCreateThread,onReplyToThread,onMarkThreadSeen,onCreateDocument,onUpdateDocument,onDeleteDocument,onMarkDocumentViewed,onCreateTraining,onUpdateTraining,onDeleteTraining,onSignupTraining,onCancelTrainingSignup,onMarkTrainingViewed,onCreateInventoryItem,onUpdateInventoryItem,onDeleteInventoryItem,onCreateVehicleType,onDeleteVehicleType,onSignOut,onSwitchCompany,uploadFile,onCommitFiles,onDiscardFiles}:AppProps) {
  const currentUser = user;
  const [demoMotiveConnection,setDemoMotiveConnection]=useState<MotiveConnection>(loadDemoMotiveConnection);
  const activeMotiveConnection=motiveConnection??demoMotiveConnection;
  const saveDemoMotive=async(apiKey:string)=>{const next:MotiveConnection={connected:true,lastFour:apiKey.slice(-4),connectedAt:new Date().toISOString(),lastVerifiedAt:new Date().toISOString(),mock:true};saveLocal('fireops-motive-demo',next);setDemoMotiveConnection(next);return next};
  const disconnectDemoMotive=async()=>{const next:MotiveConnection={connected:false,mock:true};saveLocal('fireops-motive-demo',next);setDemoMotiveConnection(next);return next};
  const [vehicles, setVehicles] = useState<Vehicle[]>(()=>initialData?.vehicles ? normalizeVehicles(initialData.vehicles) : loadVehicles());
  const [issues, setIssues] = useState<FleetIssue[]>(()=>initialData?.issues??loadIssues());
  const [crew, setCrew] = useState<CrewMember[]>(()=>initialData?.crew??loadCrew());
  const [activities, setActivities] = useState<Activity[]>(()=>initialData?.activities??loadActivities());
  const [page, setPage] = useState<Page>('overview');
  const [requestedIncidentId,setRequestedIncidentId]=useState<string|null>(null);
  const [threads,setThreads]=useState<CommunicationThread[]>(()=>communicationThreads??loadCommunicationThreads());
  useEffect(()=>{if(communicationThreads)setThreads(communicationThreads)},[communicationThreads]);
  const unreadThreadCount=threads.filter(thread=>isThreadUnread(thread,currentUser)).length;
  const [documents,setDocuments]=useState<CompanyDocument[]>(()=>companyDocuments??loadCompanyDocuments());
  useEffect(()=>{if(companyDocuments)setDocuments(companyDocuments)},[companyDocuments]);
  const unreadDocumentCount=documents.filter(document=>isDocumentUnread(document,currentUser)).length;
  const [trainings,setTrainings]=useState<Training[]>(()=>trainingData??loadTrainings());
  useEffect(()=>{if(trainingData)setTrainings(trainingData)},[trainingData]);
  const unreadTrainingCount=trainings.filter(training=>trainingStage(training)==='scheduled'&&isTrainingUnread(training,currentUser)).length;
  const [inventoryItems,setInventoryItems]=useState<InventoryItem[]>(()=>inventoryData??loadInventory());
  useEffect(()=>{if(inventoryData)setInventoryItems(inventoryData)},[inventoryData]);
  const [vehicleTypes,setVehicleTypes]=useState<VehicleTypeOption[]>(()=>vehicleTypeData??loadVehicleTypes());
  useEffect(()=>{if(vehicleTypeData)setVehicleTypes(vehicleTypeData)},[vehicleTypeData]);
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
  const [deleteCandidate, setDeleteCandidate] = useState<Vehicle | null>(null);
  const [crewDeleteCandidate, setCrewDeleteCandidate] = useState<CrewMember | null>(null);
  const [documentForm,setDocumentForm]=useState<CompanyDocument|null|undefined>(undefined);
  const [documentDeleteCandidate,setDocumentDeleteCandidate]=useState<CompanyDocument|null>(null);
  const [deletingCrew, setDeletingCrew] = useState(false);
  const [crewDeleteError, setCrewDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [storageError, setStorageError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [localRevision, setLocalRevision] = useState(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSnapshot = useRef<FleetSnapshot>({vehicles,issues,crew,activities});
  latestSnapshot.current={vehicles,issues,crew,activities};
  const lastRemoteSequence = useRef(0);
  const canManageFleet = currentUser.role === 'owner';
  const initialVisibleCrewCount = useRef(crew.filter(member=>member.role==='member').length).current;
  const visibleCrewCount = crew.filter(member=>member.role==='member').length;
  const invitedCrewCount = Math.max(0,company.crewInvitedCount+visibleCrewCount-initialVisibleCrewCount);
  const invitesAvailable = Math.max(0,company.crewInviteLimit-invitedCrewCount);
  const canInviteCrew = canManageFleet&&invitesAvailable>0;
  useEffect(() => {
    remoteChanges?.filter(change=>change.sequence>lastRemoteSequence.current).forEach(remoteChange=>{
      if(remoteChange.collection==='vehicles'){
        setVehicles(items=>remoteChange.event==='delete'?items.filter(item=>item.id!==remoteChange.id):[remoteChange.record,...items.filter(item=>item.id!==remoteChange.record.id)]);
        setSelected(current=>current ? remoteChange.event==='delete'&&current.id===remoteChange.id?null:remoteChange.event==='upsert'&&current.id===remoteChange.record.id?remoteChange.record:current : null);
      } else if(remoteChange.collection==='issues'){
        setIssues(items=>remoteChange.event==='delete'?items.filter(item=>item.id!==remoteChange.id):[remoteChange.record,...items.filter(item=>item.id!==remoteChange.record.id)]);
        setSelectedIssue(current=>current ? remoteChange.event==='delete'&&current.id===remoteChange.id?null:remoteChange.event==='upsert'&&current.id===remoteChange.record.id?remoteChange.record:current : null);
      } else if(remoteChange.collection==='crew'){
        setCrew(items=>remoteChange.event==='delete'?items.filter(item=>item.id!==remoteChange.id):[remoteChange.record,...items.filter(item=>item.id!==remoteChange.record.id)]);
        setSelectedCrew(current=>current ? remoteChange.event==='delete'&&current.id===remoteChange.id?null:remoteChange.event==='upsert'&&current.id===remoteChange.record.id?remoteChange.record:current : null);
      } else {
        setActivities(items=>remoteChange.event==='delete'?items.filter(item=>item.id!==remoteChange.id):[remoteChange.record,...items.filter(item=>item.id!==remoteChange.record.id)]);
      }
      lastRemoteSequence.current=remoteChange.sequence;
    });
  },[remoteChanges]);
  useEffect(()=>{if(!canInviteCrew)setInviteOpen(false)},[canInviteCrew]);
  useEffect(() => {
    // Every local fleet mutation records an activity and increments localRevision.
    // Realtime state updates intentionally do neither, so they must never echo
    // back through snapshot persistence and race the originating client.
    if(localRevision===0&&saveAttempt===0)return;
    let active=true;
    const timer=window.setTimeout(async()=>{
      setSaveState('saving');
      if (onDataChange) {
        try {
          const saveRequest=saveQueue.current.then(()=>onDataChange(latestSnapshot.current));
          saveQueue.current=saveRequest.catch(()=>undefined);
          await saveRequest;
          if(active){setStorageError('');setSaveState('saved')}
        } catch (error) {
          if(active){setStorageError(error instanceof Error&&error.message.startsWith('Record changed by another user')?`${error.message} Refresh before making more changes.`:'Check your connection or remove large uploads.');setSaveState('error')}
        }
      } else {
        const snapshot=latestSnapshot.current;
        const saved=[saveLocal('fireops-vehicles',snapshot.vehicles),saveLocal('fireops-issues',snapshot.issues),saveLocal('fireops-crew',snapshot.crew),saveLocal('fireops-activities',snapshot.activities)].every(Boolean);
        if(active){setStorageError(saved?'':'Browser storage may be full.');setSaveState(saved?'saved':'error')}
      }
    },300);
    return()=>{active=false;window.clearTimeout(timer)};
  },[localRevision,onDataChange,saveAttempt]);
  const logActivity = (activity: Omit<Activity,'id'|'createdAt'|'createdBy'|'createdById'>) => {
    setActivities(items => [{...activity,id:crypto.randomUUID(),createdBy:currentUser.name,createdById:currentUser.id,createdAt:new Date().toISOString()},...items]);
    setLocalRevision(revision=>revision+1);
  };
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
    const text = `${v.unit} ${v.type} ${v.make} ${v.model} ${v.year} ${v.plate} ${v.assignedFire?.name??''}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === 'All' || v.status === filter);
  }).sort((a,b)=>Number(b.assignedTo===currentUser.id)-Number(a.assignedTo===currentUser.id)), [vehicles, query, filter, currentUser.id]);
  const visibleIssues=useMemo(()=>canManageFleet?issues:issues.filter(issue=>issueBelongsToUser(issue,currentUser)),[canManageFleet,currentUser.id,currentUser.name,issues]);
  const operationsVehicles=useMemo(()=>canManageFleet?vehicles:vehicles.filter(vehicle=>vehicle.assignedTo===currentUser.id),[canManageFleet,currentUser.id,vehicles]);
  const addVehicle = (vehicle: Vehicle) => {
    if (!canManageFleet) return;
    const next=normalizeVehicle(vehicle);
    setVehicles(v => [next, ...v]); logActivity({action:`${next.unit} added to fleet`,detail:'Vehicle record created',targetType:'vehicle',targetId:next.id,tone:'complete'}); setFormOpen(false); showNotice(`${next.unit} added to inventory`);
  };
  const addIssue = (issue: FleetIssue) => {
    const vehicle=vehicles.find(item=>item.id===issue.vehicleId);setIssues(items => [issue, ...items]); logActivity({action:`Issue reported: ${issue.title}`,detail:`${vehicle?.unit??'Unknown vehicle'} · ${issue.priority} priority`,targetType:'issue',targetId:issue.id,tone:'urgent'}); setIssueFormOpen(false); showNotice('Issue created');
  };
  const updateIssue = (issue: FleetIssue) => {
    const previous=issues.find(item=>item.id===issue.id);
    const vehicle=vehicles.find(item=>item.id===issue.vehicleId);
    const statusChanged=previous?.status!==issue.status;
    const changedDetails=[previous?.title!==issue.title?'title':'',previous?.description!==issue.description?'description':'',previous?.priority!==issue.priority?'priority':''].filter(Boolean);
    const action=statusChanged?(issue.status==='Resolved'?`Issue resolved: ${issue.title}`:`Issue reopened: ${issue.title}`):changedDetails.length?`Issue details updated: ${issue.title}`:`Issue updated: ${issue.title}`;
    const detail=changedDetails.length?`${vehicle?.unit??'Unknown vehicle'} · Changed ${changedDetails.join(', ')}`:`${vehicle?.unit??'Unknown vehicle'} · ${issue.updates[0]?.text??'Issue record updated'}`;
    setIssues(items => items.map(item => item.id === issue.id ? issue : item));
    logActivity({action,detail,targetType:'issue',targetId:issue.id,tone:issue.status==='Resolved'?'complete':'urgent'}); setSelectedIssue(issue); showNotice(changedDetails.length?'Issue details saved':'Issue updated');
  };
  const updateVehicle = (vehicle: Vehicle) => {
    if (!canManageFleet) return;
    const next=normalizeVehicle(vehicle);
    setVehicles(v => v.map(item => item.id === next.id ? next : item));
    logActivity({action:`${next.unit} details updated`,detail:'Vehicle record changed',targetType:'vehicle',targetId:next.id,tone:'complete'}); setEditing(null); showNotice(`${next.unit} details updated`);
  };
  const deleteVehicle = (vehicle: Vehicle) => {
    if (!canManageFleet) return;
    const issueCount=issues.filter(issue=>issue.vehicleId===vehicle.id).length;
    setVehicles(items=>items.filter(item=>item.id!==vehicle.id));
    setIssues(items=>items.filter(issue=>issue.vehicleId!==vehicle.id));
    logActivity({action:`${vehicle.unit} deleted from fleet`,detail:issueCount?`${issueCount} linked ${issueCount===1?'issue':'issues'} also deleted`:'Vehicle record deleted',tone:'urgent'});
    setDeleteCandidate(null);
    showNotice(`${vehicle.unit} deleted from inventory`);
  };
  const updateStatus = (id: string, status: Status) => {
    if (!canManageFleet) return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||vehicle.status===status)return;
    if(status==='Assigned'&&!vehicle.assignedTo){showNotice('Assign a crew member before setting status to Assigned');return}
    const next={...vehicle,status,assignedTo:status==='Assigned'?vehicle.assignedTo:undefined,assignedFire:status==='Assigned'?vehicle.assignedFire:undefined};
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:`${vehicle.unit} status changed to ${status}`,detail:`Previous status: ${vehicle.status}`,targetType:'vehicle',targetId:id,tone:['Maintenance','Out of service'].includes(status)?'urgent':'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(`${vehicle.unit} changed to ${status}`,{vehicle,label:`Undo status change for ${vehicle.unit}`});
  };
  const updateAssignment = (id: string, assignedTo?: string) => {
    if (!canManageFleet) return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||vehicle.assignedTo===assignedTo)return;
    const next={...vehicle,assignedTo,assignedFire:assignedTo?vehicle.assignedFire:undefined,status:assignedTo?'Assigned' as Status:vehicle.status==='Assigned'?'Ready' as Status:vehicle.status};
    const member=crew.find(item=>item.id===assignedTo);
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:`${vehicle.unit} assignment updated`,detail:member?`Assigned to ${member.name}`:'No crew member assigned',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(member?`${vehicle.unit} assigned to ${member.name}`:`${vehicle.unit} assignment cleared`,{vehicle,label:`Undo assignment change for ${vehicle.unit}`});
  };
  const updateFireAssignment = (id:string, assignedFire?:Pick<NifcIncident,'id'|'name'|'state'>) => {
    if(!canManageFleet)return;
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||!vehicle.assignedTo||vehicle.assignedFire?.id===assignedFire?.id)return;
    const next={...vehicle,assignedFire,status:'Assigned' as Status};
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:`${vehicle.unit} fire assignment updated`,detail:assignedFire?`Assigned to ${assignedFire.name}`:'Fire assignment cleared',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(assignedFire?`${vehicle.unit} assigned to ${assignedFire.name}`:`${vehicle.unit} fire assignment cleared`,{vehicle,label:`Undo fire assignment for ${vehicle.unit}`});
  };
  const assignToMe = (id: string) => {
    const vehicle=vehicles.find(item=>item.id===id);if(!vehicle||(vehicle.assignedTo&&vehicle.assignedTo!==currentUser.id)||(!canManageFleet&&!vehicle.assignedTo&&vehicle.status!=='Ready'))return;
    const assignedTo=vehicle.assignedTo===currentUser.id?undefined:currentUser.id;
    const status:Status=assignedTo?'Assigned':'Ready';
    const next={...vehicle,assignedTo,assignedFire:assignedTo?vehicle.assignedFire:undefined,status};
    setVehicles(items=>items.map(item=>item.id===id?next:item));
    logActivity({action:assignedTo?`${currentUser.name} assigned ${vehicle.unit} to themselves`:`${currentUser.name} unassigned ${vehicle.unit}`,detail:assignedTo?'Vehicle is now in use':'Vehicle returned to ready status',targetType:'vehicle',targetId:id,tone:'complete'});
    setSelected(item=>item?.id===id?next:item);
    showNotice(assignedTo?'Vehicle assigned to you':'Vehicle assignment removed',{vehicle,label:`Undo assignment change for ${vehicle.unit}`});
  };
  const inviteCrew = async (member: CrewMember) => {
    if(!canInviteCrew){setInviteOpen(false);showNotice('No crew invitations are available');throw new Error('No crew invitations are available.')}
    const invited=onInviteCrew?await onInviteCrew(member):member;
    setCrew(items => [...items, invited]); logActivity({action:`${invited.name} invited to company`,detail:invited.email,targetType:'crew',targetId:invited.id,tone:'complete'}); setInviteOpen(false); showNotice(`Invitation to ${company.name} sent to ${invited.email}`);
  };
  const updateCrew = (member: CrewMember) => {
    const credentials=crewCredentials(member);
    setCrew(items => items.map(item => item.id === member.id ? member : item)); logActivity({action:`Credentials updated for ${member.name}`,detail:credentials.length?`${credentials.length} ${credentials.length===1?'credential':'credentials'} on file`:'Credential removed',targetType:'crew',targetId:member.id,tone:'complete'}); setSelectedCrew(member); showNotice('Crew credentials updated');
  };
  const deleteCrew = async (member: CrewMember) => {
    if(!canManageFleet||member.role==='owner'||member.id===currentUser.id)return;
    setDeletingCrew(true);setCrewDeleteError('');
    try {
      const removal=await onDeleteCrew?.(member);
      const assignmentCount=vehicles.filter(vehicle=>vehicle.assignedTo===member.id).length;
      setCrew(items=>items.filter(item=>item.id!==member.id));
      setVehicles(items=>items.map(vehicle=>vehicle.assignedTo===member.id?{...vehicle,assignedTo:undefined,assignedFire:undefined,status:vehicle.status==='Assigned'?'Ready':vehicle.status}:vehicle));
      logActivity({action:`${member.name} removed from crew`,detail:assignmentCount?`App access revoked · ${assignmentCount} vehicle ${assignmentCount===1?'assignment':'assignments'} cleared`:'App access revoked',tone:'urgent'});
      setCrewDeleteCandidate(null);
      showNotice(removal?.accountDeleted?`${member.name} removed and account deleted`:removal?.accountCleanupFailed?`${member.name} removed; access revoked, but account cleanup failed`:`${member.name} removed and access revoked`);
    } catch {
      setCrewDeleteError('Crew member could not be removed. Check your connection and try again.');
    } finally {
      setDeletingCrew(false);
    }
  };

  const createThread=async(subject:string,description:string)=>{
    const thread=onCreateThread?await onCreateThread(subject,description):{id:crypto.randomUUID(),subject,description,createdBy:currentUser.name,createdById:currentUser.id,createdByRole:currentUser.role,createdAt:new Date().toISOString(),replies:[]};
    setThreads(items=>[thread,...items.filter(item=>item.id!==thread.id)]);
    if(!onCreateThread)saveLocal('fireops-communication-threads',[thread,...threads.filter(item=>item.id!==thread.id)]);
    return thread;
  };
  const replyToThread=async(threadId:string,body:string)=>{
    const reply=onReplyToThread?await onReplyToThread(threadId,body):{id:crypto.randomUUID(),body,createdBy:currentUser.name,createdById:currentUser.id,createdAt:new Date().toISOString()};
    setThreads(items=>{const next=items.map(thread=>thread.id===threadId?{...thread,replies:[...thread.replies.filter(item=>item.id!==reply.id),reply],seenAt:reply.createdAt}:thread);if(!onReplyToThread)saveLocal('fireops-communication-threads',next);return next});
    return reply;
  };
  const markThreadSeen=async(threadId:string)=>{
    const seenAt=onMarkThreadSeen?await onMarkThreadSeen(threadId):new Date().toISOString();
    setThreads(items=>{const next=items.map(thread=>thread.id===threadId?{...thread,seenAt}:thread);if(!onMarkThreadSeen)saveLocal('fireops-communication-threads',next);return next});
  };
  const saveDocument=async(name:string,file?:VehicleFile)=>{
    const editing=documentForm??undefined;
    if(!editing&&!file)throw new Error('Choose file to upload.');
    const saved=editing
      ? onUpdateDocument?await onUpdateDocument(editing,name,file):{...editing,name,file:file??editing.file,updatedAt:new Date().toISOString()}
      : onCreateDocument?await onCreateDocument(name,file!):{id:crypto.randomUUID(),name,file:file!,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    setDocuments(items=>{const next=[saved,...items.filter(item=>item.id!==saved.id)];if(!onCreateDocument&&!onUpdateDocument)saveLocal('fireops-company-documents',next);return next});
    if(file)onCommitFiles?.([file]);
    setDocumentForm(undefined);showNotice(editing?'Document updated':'Document uploaded');
  };
  const deleteDocument=async(document:CompanyDocument)=>{
    if(onDeleteDocument)await onDeleteDocument(document);
    setDocuments(items=>{const next=items.filter(item=>item.id!==document.id);if(!onDeleteDocument)saveLocal('fireops-company-documents',next);return next});
    setDocumentDeleteCandidate(null);showNotice('Document deleted');
  };
  const viewDocument=(document:CompanyDocument)=>{
    window.open(document.file.dataUrl,'_blank','noopener,noreferrer');
    if(!isDocumentUnread(document,currentUser))return;
    const fallback=new Date().toISOString();
    const applyViewed=(viewedAt:string|undefined)=>setDocuments(items=>{const next=items.map(item=>item.id===document.id?{...item,viewedAt}:item);if(!onMarkDocumentViewed)saveLocal('fireops-company-documents',next);return next});
    applyViewed(fallback);
    void (onMarkDocumentViewed?.(document.id)??Promise.resolve(fallback)).then(applyViewed).catch(()=>applyViewed(document.viewedAt));
  };
  const createTraining=async(values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>{
    const now=new Date().toISOString();
    const training=onCreateTraining?await onCreateTraining(values):{...values,id:crypto.randomUUID(),createdAt:now,updatedAt:now,signups:[]};
    setTrainings(items=>{const next=[training,...items.filter(item=>item.id!==training.id)];if(!onCreateTraining)saveLocal('fireops-trainings',next);return next});
    showNotice('Training created and crew notified');return training;
  };
  const updateTraining=async(trainingId:string,values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>{
    const existing=trainings.find(item=>item.id===trainingId);
    const updated=onUpdateTraining?await onUpdateTraining(trainingId,values):existing?{...existing,...values,updatedAt:new Date().toISOString()}:{...values,id:trainingId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),signups:[]};
    setTrainings(items=>{const next=[updated,...items.filter(item=>item.id!==updated.id)];if(!onUpdateTraining)saveLocal('fireops-trainings',next);return next});
    showNotice('Training updated');return updated;
  };
  const deleteTraining=async(training:Training)=>{
    if(onDeleteTraining)await onDeleteTraining(training.id);
    setTrainings(items=>{const next=items.filter(item=>item.id!==training.id);if(!onDeleteTraining)saveLocal('fireops-trainings',next);return next});
    showNotice('Training deleted');
  };
  const signupTraining=async(training:Training)=>{
    const signup=onSignupTraining?await onSignupTraining(training.id):{userId:currentUser.id,userName:currentUser.name,signedUpAt:new Date().toISOString()};
    setTrainings(items=>{const next=items.map(item=>item.id===training.id?{...item,signups:[...item.signups.filter(entry=>entry.userId!==signup.userId),signup]}:item);if(!onSignupTraining)saveLocal('fireops-trainings',next);return next});
    showNotice(`Registered for ${training.courseTitle}`);return signup;
  };
  const cancelTrainingSignup=async(training:Training)=>{
    await onCancelTrainingSignup?.(training.id);
    setTrainings(items=>{const next=items.map(item=>item.id===training.id?{...item,signups:item.signups.filter(entry=>entry.userId!==currentUser.id)}:item);if(!onCancelTrainingSignup)saveLocal('fireops-trainings',next);return next});
    showNotice(`Registration canceled for ${training.courseTitle}`);
  };
  const markTrainingViewed=(training:Training)=>{
    if(!isTrainingUnread(training,currentUser))return;
    const fallback=new Date().toISOString();
    const applyViewed=(viewedAt:string|undefined)=>setTrainings(items=>{const next=items.map(item=>item.id===training.id?{...item,viewedAt}:item);if(!onMarkTrainingViewed)saveLocal('fireops-trainings',next);return next});
    applyViewed(fallback);
    void (onMarkTrainingViewed?.(training.id)??Promise.resolve(fallback)).then(applyViewed).catch(()=>applyViewed(training.viewedAt));
  };
  const createInventoryItem=async(name:string,quantity:number)=>{
    if(!canManageFleet)throw new Error('Company owner access required.');
    const now=new Date().toISOString();
    const item=onCreateInventoryItem?await onCreateInventoryItem(name,quantity):{id:crypto.randomUUID(),name,quantity,createdAt:now,updatedAt:now};
    setInventoryItems(items=>{const next=[item,...items.filter(entry=>entry.id!==item.id)];if(!onCreateInventoryItem)saveLocal('fireops-inventory',next);return next});showNotice(`${item.name} added`);return item;
  };
  const updateInventoryItem=async(item:InventoryItem,quantity:number)=>{
    if(!canManageFleet)throw new Error('Company owner access required.');
    const updated=onUpdateInventoryItem?await onUpdateInventoryItem(item,quantity):{...item,quantity,updatedAt:new Date().toISOString()};
    setInventoryItems(items=>{const next=items.map(entry=>entry.id===updated.id?updated:entry);if(!onUpdateInventoryItem)saveLocal('fireops-inventory',next);return next});return updated;
  };
  const deleteInventoryItem=async(item:InventoryItem)=>{
    if(!canManageFleet)throw new Error('Company owner access required.');
    if(onDeleteInventoryItem)await onDeleteInventoryItem(item);
    setInventoryItems(items=>{const next=items.filter(entry=>entry.id!==item.id);if(!onDeleteInventoryItem)saveLocal('fireops-inventory',next);return next});showNotice(`${item.name} deleted`);
  };
  const createVehicleType=async(name:string)=>{
    if(!canManageFleet)throw new Error('Company owner access required.');
    const type=onCreateVehicleType?await onCreateVehicleType(name):{id:crypto.randomUUID(),name};
    setVehicleTypes(items=>{const next=[...items.filter(item=>item.id!==type.id),type].sort((left,right)=>left.name.localeCompare(right.name));if(!onCreateVehicleType)saveLocal('fireops-vehicle-types',next);return next});
    return type;
  };
  const deleteVehicleType=async(type:VehicleTypeOption)=>{
    if(!canManageFleet)throw new Error('Company owner access required.');
    if(onDeleteVehicleType)await onDeleteVehicleType(type);
    setVehicleTypes(items=>{const next=items.filter(item=>item.id!==type.id);if(!onDeleteVehicleType)saveLocal('fireops-vehicle-types',next);return next});
  };

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} user={currentUser} unreadCount={unreadThreadCount} unreadDocumentCount={unreadDocumentCount} unreadTrainingCount={unreadTrainingCount}/>
    <div className="app-main">
      <Topbar saveState={saveState} notificationCount={currentUser.role==='member'?unreadThreadCount+unreadDocumentCount+unreadTrainingCount:undefined} onNotifications={()=>setPage('overview')} onSignOut={onSignOut} onSwitchCompany={onSwitchCompany}/>
      <main>
        {storageError&&<div className="storage-error" role="alert"><span><b>Changes could not be saved.</b> {storageError}</span><button onClick={()=>setSaveAttempt(attempt=>attempt+1)}>Retry save</button></div>}
        <div className="page-stage" key={page}>
        {page === 'vehicles' && <VehiclesPage vehicles={vehicles} issues={visibleIssues} crew={crew} filtered={filtered} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} canManage={canManageFleet} motiveMock={Boolean(activeMotiveConnection.connected&&activeMotiveConnection.mock)} onAdd={() => setFormOpen(true)} onSelect={setSelected} onSelectIssue={setSelectedIssue}/>}
        {page === 'overview' && <Dashboard quickActions={<QuickActions companyId={companyId} user={currentUser} onOpen={setPage}/>} vehicles={vehicles} issues={visibleIssues} crew={crew} activities={activities} threads={threads} documents={documents} trainings={trainings} user={currentUser} onSelectVehicle={setSelected} onSelectIssue={setSelectedIssue} onSelectCrew={setSelectedCrew} onOpenNotifications={setPage} onSelectIncident={id=>{setRequestedIncidentId(id);setPage('operations')}}/>}
        {page === 'crew' && canManageFleet && <CrewPage crew={crew} vehicles={vehicles} inviteLimit={company.crewInviteLimit} invitesAvailable={invitesAvailable} onInvite={() => setInviteOpen(true)} onSelect={setSelectedCrew}/>}
        {page === 'communications' && <CommunicationsPage threads={threads} user={currentUser} error={communicationError} onCreate={createThread} onReply={replyToThread} onSeen={markThreadSeen}/>}
        {page === 'documents' && <DocumentsPage documents={documents} user={currentUser} error={documentError} onAdd={()=>setDocumentForm(null)} onEdit={document=>setDocumentForm(document)} onDelete={setDocumentDeleteCandidate} onView={viewDocument}/>}
        {page === 'availability' && <AvailabilityPage companyId={companyId} user={currentUser} crew={crew}/>}
        {(page === 'invoices' || page === 'payroll') && <StoredDocumentsPage key={page} kind={page} companyId={companyId} user={currentUser} crew={crew}/>}
        {page === 'receipts' && <ReceiptsPage companyId={companyId} user={currentUser} crew={crew}/>}
        {page === 'training' && <TrainingPage trainings={trainings} user={currentUser} error={trainingError} onCreate={createTraining} onEdit={updateTraining} onDelete={deleteTraining} onSignup={signupTraining} onCancelSignup={cancelTrainingSignup} onViewed={markTrainingViewed}/>}
        {page === 'inventory' && <InventoryPage canManage={canManageFleet} items={inventoryItems} error={inventoryError} onCreate={createInventoryItem} onUpdate={updateInventoryItem} onDelete={deleteInventoryItem}/>}

        {page === 'operations' && <OperationsPage requestedIncidentId={requestedIncidentId} onIncidentOpened={()=>setRequestedIncidentId(null)} assignedIncidentIds={[...new Set(operationsVehicles.flatMap(vehicle=>vehicle.assignedFire?.id?[vehicle.assignedFire.id]:[]))]} resources={operationsVehicles.map(vehicle=>({...vehicle,assignedCrew:crew.find(member=>member.id===vehicle.assignedTo),motive:activeMotiveConnection.connected?motiveSnapshotFor(vehicle,activeMotiveConnection):undefined}))} motiveEnabled={activeMotiveConnection.connected} assignableVehicles={canManageFleet?vehicles.filter(vehicle=>vehicle.assignedTo).map(vehicle=>({...vehicle,assignedCrew:crew.find(member=>member.id===vehicle.assignedTo),motive:undefined})):[]} onAssignVehicle={canManageFleet?(vehicleId,fire)=>updateFireAssignment(vehicleId,fire):undefined} onVehicleSelect={vehicleId=>{const vehicle=vehicles.find(item=>item.id===vehicleId);if(vehicle)setSelected(vehicle)}}/>}
        {page === 'more' && <MorePage user={currentUser} unreadDocumentCount={unreadDocumentCount} unreadTrainingCount={unreadTrainingCount} setPage={setPage}/>}

        {page === 'settings' && <SettingsPage company={company} owner={crew.find(member=>member.role==='owner')?.name??currentUser.name} invitedCrewCount={invitedCrewCount} canManage={canManageFleet} motiveConnection={activeMotiveConnection} onSaveMotive={onSaveMotive??saveDemoMotive} onDisconnectMotive={onDisconnectMotive??disconnectDemoMotive}/>}
        </div>
      </main>
      <MobileNav page={page} setPage={setPage} user={currentUser} unreadCount={unreadThreadCount} unreadDocumentCount={unreadDocumentCount} unreadTrainingCount={unreadTrainingCount}/>
    </div>
    {formOpen && canManageFleet && <VehicleForm vehicleTypes={vehicleTypes} vehicleTypeError={vehicleTypeError} vehicles={vehicles} onCreateVehicleType={createVehicleType} onDeleteVehicleType={deleteVehicleType} uploadFile={uploadFile} onCommitFiles={onCommitFiles} onDiscardFiles={onDiscardFiles} onClose={() => setFormOpen(false)} onSave={addVehicle}/>}
    {editing && canManageFleet && <VehicleForm vehicle={editing} vehicleTypes={vehicleTypes} vehicleTypeError={vehicleTypeError} vehicles={vehicles} onCreateVehicleType={createVehicleType} onDeleteVehicleType={deleteVehicleType} uploadFile={uploadFile} onCommitFiles={onCommitFiles} onDiscardFiles={onDiscardFiles} onClose={() => setEditing(null)} onSave={updateVehicle}/>}
    {issueFormOpen && <IssueForm vehicles={vehicles} initialVehicleId={issueVehicleId} user={currentUser} onClose={() => setIssueFormOpen(false)} onSave={addIssue}/>}
    {inviteOpen && canInviteCrew && <InviteCrewForm existing={crew} companyName={company.name} onClose={() => setInviteOpen(false)} onSave={inviteCrew}/>}
    {selected && <VehicleDetail vehicle={selected} issues={visibleIssues.filter(issue => issue.vehicleId === selected.id)} crew={crew} user={currentUser} canManage={canManageFleet} motiveMock={Boolean(activeMotiveConnection.connected&&activeMotiveConnection.mock)} onClose={() => setSelected(null)} onEdit={() => {setEditing(selected);setSelected(null)}} onDelete={() => {setDeleteCandidate(selected);setSelected(null)}} onNewIssue={() => {setIssueVehicleId(selected.id);setSelected(null);setIssueFormOpen(true)}} onIssue={issue => {setSelected(null);setSelectedIssue(issue)}} onStatus={s => updateStatus(selected.id, s)} onAssignee={memberId => updateAssignment(selected.id,memberId||undefined)} onFire={fire=>updateFireAssignment(selected.id,fire)} onAssign={() => assignToMe(selected.id)}/>}
    {deleteCandidate && canManageFleet && <DeleteVehicleDialog vehicle={deleteCandidate} issueCount={issues.filter(issue=>issue.vehicleId===deleteCandidate.id).length} onCancel={() => {setSelected(deleteCandidate);setDeleteCandidate(null)}} onConfirm={() => deleteVehicle(deleteCandidate)}/>}
    {documentForm!==undefined&&canManageFleet&&<DocumentForm document={documentForm??undefined} uploadFile={uploadFile} onDiscardFiles={onDiscardFiles} onClose={()=>setDocumentForm(undefined)} onSave={saveDocument}/>}
    {documentDeleteCandidate&&canManageFleet&&<DeleteDocumentDialog document={documentDeleteCandidate} onCancel={()=>setDocumentDeleteCandidate(null)} onConfirm={()=>deleteDocument(documentDeleteCandidate)}/>}
    {crewDeleteCandidate && canManageFleet && <DeleteCrewDialog member={crewDeleteCandidate} assignmentCount={vehicles.filter(vehicle=>vehicle.assignedTo===crewDeleteCandidate.id).length} busy={deletingCrew} error={crewDeleteError} onCancel={()=>{if(!deletingCrew){setCrewDeleteCandidate(null);setCrewDeleteError('');setSelectedCrew(crewDeleteCandidate)}}} onConfirm={()=>void deleteCrew(crewDeleteCandidate)}/>}
    {selectedIssue && <IssueDetail issue={selectedIssue} vehicle={vehicles.find(v => v.id === selectedIssue.vehicleId)} user={currentUser} canManage={canManageFleet} onClose={() => setSelectedIssue(null)} onSave={updateIssue}/>}
    {selectedCrew && canManageFleet && <CrewDetail member={selectedCrew} vehicles={vehicles} uploadFile={uploadFile} onCommitFiles={onCommitFiles} onDiscardFiles={onDiscardFiles} onClose={() => setSelectedCrew(null)} onSave={updateCrew} onAssign={vehicleId=>updateAssignment(vehicleId,selectedCrew.id)} onDelete={selectedCrew.role==='owner'||selectedCrew.id===currentUser.id?undefined:()=>{setCrewDeleteError('');setCrewDeleteCandidate(selectedCrew);setSelectedCrew(null)}}/>}
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="toast"><span><Check size={16}/></span><b>{notice}</b>{undoAction&&<button onClick={undoLastAction} aria-label={undoAction.label}>Undo</button>}</div>}</div>
  </div>;
}

function Brand() { return <div className="brand"><picture><img className="brand-mark theme-logo-light" src="/fireops-wordmark-light.png" width="2117" height="743" alt="FireOps, powered by Fireco"/><img className="brand-mark theme-logo-dark" src="/fireops-wordmark.png" width="2117" height="743" alt="FireOps, powered by Fireco"/></picture></div> }
function Sidebar({page,setPage,user,unreadCount,unreadDocumentCount,unreadTrainingCount}:{page:Page;setPage:(p:Page)=>void;user:FireOpsUser;unreadCount:number;unreadDocumentCount:number;unreadTrainingCount:number}) {
  return <aside className="sidebar"><Brand/><nav>
    {navigationLayout(user.role).desktop.map(target=>{const {label,Icon}=navigationMeta[target];const count=target==='communications'?unreadCount:target==='documents'?unreadDocumentCount:target==='training'?unreadTrainingCount:0;return <NavItem key={target} icon={<Icon/>} label={label} active={page===target} notificationCount={count} onClick={()=>setPage(target)}/>})}
  </nav></aside>
}
function NavItem({icon,label,active,notificationCount=0,onClick}:{icon:React.ReactNode;label:string;active:boolean;notificationCount?:number;onClick:()=>void}) {
  return <button className={active?'active':''} onClick={onClick} aria-current={active?'page':undefined}>{icon}<span>{label}</span>{notificationCount>0&&<span className="sidebar-nav-badge" aria-label={`${notificationCount} unread ${notificationCount===1?'item':'items'}`}>{notificationCount>99?'99+':notificationCount}</span>}</button>
}
function Topbar({saveState,notificationCount,onNotifications,onSignOut,onSwitchCompany}:{saveState:SaveState;notificationCount?:number;onNotifications?:()=>void;onSignOut?:()=>void;onSwitchCompany?:()=>void}) {
  const [darkMode,setDarkMode]=useState(()=>document.documentElement.dataset.theme==='dark');
  const saveLabel=saveState==='saving'?'Saving changes':saveState==='error'?'Save failed':saveState==='saved'?'All changes saved':'';
  const toggleTheme=()=>{
    const theme=darkMode?'light':'dark';
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0F1317':'#f7f7f4');
    try{localStorage.setItem('fireops-theme',theme)}catch{/* Storage may be unavailable in private browsing. */}
    setDarkMode(theme==='dark');
  };
  return <header className="topbar"><div className="mobile-brand"><Brand/></div><div className="topbar-right">{saveLabel&&<div className={`save-status ${saveState}`} role="status" aria-live="polite">{saveState==='saving'?<Clock3/>:saveState==='error'?<CircleAlert/>:null}<span>{saveLabel}</span></div>}{notificationCount!==undefined&&<button className="notification-button" onClick={onNotifications} aria-label={notificationCount?`Open notifications, ${notificationCount} unread`:'Open notifications'}><Bell/>{notificationCount>0&&<b>{notificationCount>99?'99+':notificationCount}</b>}</button>}<button className="theme-toggle" type="button" role="switch" aria-checked={darkMode} aria-label={`Switch to ${darkMode?'light':'dark'} mode`} onClick={toggleTheme}><span className={darkMode?'':'active'}><Sun/></span><span className={darkMode?'active':''}><Moon/></span></button>{onSwitchCompany&&<button className="topbar-signout" onClick={onSwitchCompany}><Building2/><span>Switch company</span></button>}{onSignOut&&<button className="topbar-signout" onClick={onSignOut}><LogOut/><span>Sign out</span></button>}</div></header>
}

function MorePage({user,unreadDocumentCount,unreadTrainingCount,setPage}:{user:FireOpsUser;unreadDocumentCount:number;unreadTrainingCount:number;setPage:(page:Page)=>void}) {
  const overflow=navigationLayout(user.role).mobileOverflow;
  return <div className="page more-page"><div className="page-heading"><div><h1>More</h1><p>Additional company tools and settings.</p></div></div><section className="more-section" aria-labelledby="more-sections-heading"><h2 id="more-sections-heading">Navigation</h2><div className="more-list">{overflow.map(target=>{const {label,description,Icon}=navigationMeta[target];const count=target==='documents'?unreadDocumentCount:target==='training'?unreadTrainingCount:0;return <button key={target} onClick={()=>setPage(target)}><span className="more-icon"><Icon/></span><span><b>{label}{count>0&&<i className="more-notification">{count} new</i>}</b><small>{description}</small></span><ChevronRight/></button>})}</div></section></div>;
}

function VehiclesPage({vehicles,issues,crew,filtered,query,setQuery,filter,setFilter,canManage,motiveMock,onAdd,onSelect,onSelectIssue}:{vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];filtered:Vehicle[];query:string;setQuery:(v:string)=>void;filter:Status|'All';setFilter:(v:Status|'All')=>void;canManage:boolean;motiveMock:boolean;onAdd:()=>void;onSelect:(v:Vehicle)=>void;onSelectIssue:(issue:FleetIssue)=>void}) {
  const openIssues=issues.filter(issue=>issue.status==='Open');
  return <div className="page"><div className="page-heading"><div><h1 className="fleet-title">Fleet <span aria-hidden="true">-</span> <a href="#fleet-issues">{openIssues.length} {openIssues.length===1?'Issue':'Issues'}</a></h1></div><div className="fleet-heading-actions">{canManage&&<><button className="primary desktop-add" onClick={onAdd}><Plus size={19}/> Add vehicle</button><button className="primary mobile-add-vehicle" onClick={onAdd}><Plus size={18}/> Add vehicle</button></>}</div></div>
    <section className="stats-row fleet-stats">
      <Stat label="Total vehicles" value={vehicles.length}/>
      <Stat label="Ready" value={vehicles.filter(v=>v.status==='Ready').length}/>
      <Stat label="Needs attention" value={vehicles.filter(v=>['Maintenance','Out of service'].includes(v.status)).length}/>
    </section>
    <section className="inventory-panel"><div className="inventory-tools"><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search vehicles" aria-label="Search vehicles"/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear vehicle search"><X size={16}/></button>}</div><div className="filter-wrap"><SlidersHorizontal size={17}/><select value={filter} onChange={e=>setFilter(e.target.value as Status|'All')} aria-label="Filter by status"><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="list-label"><b>{filtered.length} {filtered.length===1?'vehicle':'vehicles'}</b><span>Updated now</span></div>
      <div className="vehicle-list">{filtered.map(v=><VehicleCard key={v.id} vehicle={v} assignedName={crew.find(member=>member.id===v.assignedTo)?.name} issueCount={issues.filter(issue=>issue.vehicleId===v.id&&issue.status==='Open').length} motiveMock={motiveMock} onClick={()=>onSelect(v)}/>)}
      {!filtered.length && <div className="empty">{vehicles.length?<Search/>:<Truck/>}<h3>{vehicles.length?'No vehicles found':'No vehicles yet'}</h3><p>{vehicles.length?'Try another search or clear current filter.':canManage?'Add first vehicle to start building company fleet.':'Company owner has not added any vehicles yet.'}</p>{vehicles.length?<button className="secondary" onClick={()=>{setQuery('');setFilter('All')}}>Clear filters</button>:canManage&&<button className="primary" onClick={onAdd}><Plus/> Add vehicle</button>}</div>}</div>
    </section>
    <FleetIssues issues={openIssues} vehicles={vehicles} onSelect={onSelectIssue}/>
  </div>
}
function FleetIssues({issues,vehicles,onSelect,title='Current issues',emptyMessage='Fleet has no current reported issues.',id='fleet-issues'}:{issues:FleetIssue[];vehicles:Vehicle[];onSelect:(issue:FleetIssue)=>void;title?:string;emptyMessage?:string;id?:string}) {
  const vehicleName=(vehicleId:string)=>vehicles.find(vehicle=>vehicle.id===vehicleId)?.unit??'Unknown vehicle';
  return <section className="issues-panel fleet-issues" id={id}><div className="fleet-issues-heading"><div><div className="fleet-issues-title"><h2>{title}</h2></div><p>{issues.length} open</p></div></div><div className="issue-list">{issues.map(issue=><button className="issue-card" onClick={()=>onSelect(issue)} key={issue.id}><div className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></div><div className="issue-copy"><div className="issue-title"><h3>{issue.title}</h3><div className="issue-badges"><span className="issue-status">Open</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority}</span></div></div><p>{issue.description}</p><div className="issue-meta"><b>{vehicleName(issue.vehicleId)}</b><span>Reported by {issue.createdBy}</span><span>{issue.updates.length} {issue.updates.length===1?'update':'updates'}</span><span>{new Date(issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div></div><ChevronRight className="card-arrow"/></button>)}{!issues.length&&<div className="empty compact-empty"><Check/><h3>No open issues</h3><p>{emptyMessage}</p></div>}</div></section>
}
function Stat({label,value,icon,tone='dark'}:{label:string;value:number;icon?:React.ReactNode;tone?:string}) {return <div className={`stat ${icon?'':'no-icon'}`}>{icon&&<div className={`stat-icon ${tone}`}>{icon}</div>}<div><strong>{value}</strong><span>{label}</span></div></div>}
function VehicleCard({vehicle,assignedName,issueCount,motiveMock,onClick}:{vehicle:Vehicle;assignedName?:string;issueCount:number;motiveMock?:boolean;onClick:()=>void}) {
  const motive=motiveMock?motiveDemoFor(vehicle):undefined;
  return <button className={`vehicle-card ${motive?'has-motive':''}`} onClick={onClick}><div className="vehicle-icon">{vehicle.photo?<img src={vehicle.photo.dataUrl} alt="" loading="lazy" decoding="async"/>:vehicle.type==='Dozer'?<Wrench/>:<Truck/>}</div><div className="vehicle-info"><div className="vehicle-title"><h3>{vehicle.unit}</h3><StatusBadge status={vehicle.status}/></div><p>{vehicle.year} {vehicle.make} {vehicle.model}</p>{motive&&<div className="vehicle-motive-summary"><span className="vehicle-motive-live"><i/>Motive</span><span title={motive.location}><MapPin/>{motive.location}</span><span><Gauge/>{motive.speed}</span><span><Camera/>Online</span></div>}<div className="vehicle-meta"><span><CarFront/> {vehicle.type}</span>{assignedName&&<span className="vehicle-assignee"><CircleUserRound/> {assignedName}</span>}{vehicle.assignedFire&&<span className="vehicle-fire"><Flame/> {vehicle.assignedFire.name}</span>}<span className={issueCount?'open-issues':''}><CircleAlert/> {issueCount} open {issueCount===1?'issue':'issues'}</span></div></div><ChevronRight className="card-arrow"/></button>
}
function StatusBadge({status}:{status:Status}) {return <span className={`status ${status.toLowerCase().replace(/ /g,'-')}`}><i/>{status}</span>}

function MemberNotifications({threads,documents,trainings,user,onOpen}:{threads:CommunicationThread[];documents:CompanyDocument[];trainings:Training[];user:FireOpsUser;onOpen:(page:'communications'|'documents'|'training')=>void}){
  const notifications=dashboardNotifications(threads,documents,user,10,trainings);
  const unreadCount=notifications.filter(notification=>notification.unread).length;
  const formatDate=(date:string)=>new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return <section className="action-section notification-section" aria-labelledby="notifications-title"><div className="action-heading"><div><h2 id="notifications-title">Notifications</h2><p>Company updates shared with you</p></div>{unreadCount>0&&<span className="notification-count" aria-label={`${unreadCount} unread ${unreadCount===1?'notification':'notifications'}`}>{unreadCount}</span>}</div>
    <div className="notification-list">{notifications.map(notification=><button className={`notification-row ${notification.unread?'unread':''}`} key={notification.id} onClick={()=>onOpen(notification.source)}><span className={`notification-icon ${notification.source}`}>{notification.source==='communications'?<MessageSquare/>:notification.source==='training'?<GraduationCap/>:<FileText/>}</span><span className="notification-copy"><span><b>{notification.title}</b>{notification.unread&&<i>New</i>}</span><small>{notification.detail}</small></span><span className="notification-meta"><em>{notification.source==='communications'?'Communication':notification.source==='training'?'Training':'Document'}</em><time dateTime={notification.createdAt}>{formatDate(notification.createdAt)}</time></span><ChevronRight/></button>)}{!notifications.length&&<div className="notification-empty"><span><Bell/></span><div><b>No notifications yet</b><p>New company updates will appear here.</p></div></div>}</div>
  </section>;
}

function Dashboard({quickActions,vehicles,issues,crew,threads,documents,trainings,user,onSelectVehicle,onSelectIssue,onSelectCrew,onOpenNotifications,onSelectIncident}:{quickActions:React.ReactNode;vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];activities:Activity[];threads:CommunicationThread[];documents:CompanyDocument[];trainings:Training[];user:FireOpsUser;onSelectVehicle:(v:Vehicle)=>void;onSelectIssue:(issue:FleetIssue)=>void;onSelectCrew:(member:CrewMember)=>void;onOpenNotifications:(page:'communications'|'documents'|'training')=>void;onSelectIncident:(id:string)=>void}) {
  if(user.role==='owner')return <OwnerDashboard quickActions={quickActions} nationalFireActivity={<NationalFireActivitySection/>} name={user.name} vehicles={vehicles} crew={crew} issues={issues} onSelect={target=>{if(target.type==='incident')onSelectIncident(target.id);if(target.type==='vehicle'){const item=vehicles.find(v=>v.id===target.id);if(item)onSelectVehicle(item)}if(target.type==='crew'){const item=crew.find(v=>v.id===target.id);if(item)onSelectCrew(item)}if(target.type==='issue'){const item=issues.find(v=>v.id===target.id);if(item)onSelectIssue(item)}}}/>;
  const openIssues=issues.filter(issue=>issue.status==='Open');
  return <div className="page overview-page"><div className="page-heading"><div><h1>Dashboard</h1></div><div className="dashboard-user"><span>{user.name}</span></div></div>
    {quickActions}
    <NationalFireActivitySection/>
    {openIssues.length>0&&<FleetIssues issues={openIssues} vehicles={vehicles} onSelect={onSelectIssue} title="My issues" id="my-issues"/>}
    <MemberNotifications threads={threads} documents={documents} trainings={trainings} user={user} onOpen={onOpenNotifications}/>
  </div>
}

function CommunicationsPage({threads,user,error,onCreate,onReply,onSeen}:{threads:CommunicationThread[];user:FireOpsUser;error?:string;onCreate:(subject:string,description:string)=>Promise<CommunicationThread>;onReply:(threadId:string,body:string)=>Promise<CommunicationReply>;onSeen:(threadId:string)=>Promise<void>}) {
  const [newThreadOpen,setNewThreadOpen]=useState(false);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=threads.find(thread=>thread.id===selectedId);
  const ordered=[...threads].sort((left,right)=>{
    const leftDate=left.replies[left.replies.length-1]?.createdAt??left.createdAt;
    const rightDate=right.replies[right.replies.length-1]?.createdAt??right.createdAt;
    return Date.parse(rightDate)-Date.parse(leftDate);
  });
  useEffect(()=>{if(selected&&isThreadUnread(selected,user))void onSeen(selected.id).catch(()=>undefined)},[selected,user.id]);
  const openThread=(thread:CommunicationThread)=>setSelectedId(thread.id);
  return <div className="page communications-page"><div className="page-heading communications-heading"><div><h1>Communications</h1><p>Company threads and crew replies.</p></div><button className="primary" onClick={()=>setNewThreadOpen(true)}><Plus/> New thread</button></div>
    {error&&<div className="communication-load-error" role="alert"><CircleAlert/><span>{error}</span></div>}
    <section className="thread-panel" aria-labelledby="thread-list-heading"><div className="thread-panel-heading"><div><h2 id="thread-list-heading">Threads</h2><p>{threads.length} {threads.length===1?'conversation':'conversations'}</p></div></div><div className="thread-list">{ordered.map(thread=>{const unread=isThreadUnread(thread,user);const latest=thread.replies[thread.replies.length-1];return <button className={`thread-row ${unread?'unread':''}`} key={thread.id} onClick={()=>openThread(thread)}><span className="thread-mark"><MessageSquare/></span><span className="thread-copy"><span className="thread-title"><b>{thread.subject}</b>{unread&&<i>Unread</i>}</span><span className="thread-preview">{latest?.body??thread.description}</span><small>{latest?`${latest.createdBy} replied`:`Started by ${thread.createdBy}`} · {formatCommunicationDate(latest?.createdAt??thread.createdAt)}</small></span><span className="thread-reply-count" aria-label={`${thread.replies.length} ${thread.replies.length===1?'reply':'replies'}`}><MessageSquare/>{thread.replies.length}</span><ChevronRight/></button>})}{!threads.length&&<div className="empty communication-empty"><MessageSquare/><h3>No threads yet</h3><p>Start a thread to share updates or ask crew a question.</p></div>}</div></section>
    {newThreadOpen&&<NewThreadForm onClose={()=>setNewThreadOpen(false)} onSave={async(subject,description)=>{const thread=await onCreate(subject,description);setNewThreadOpen(false);setSelectedId(thread.id)}}/>}
    {selected&&<ThreadDetail thread={selected} user={user} onClose={()=>setSelectedId(null)} onReply={onReply}/>}
  </div>;
}

function NewThreadForm({onClose,onSave}:{onClose:()=>void;onSave:(subject:string,description:string)=>Promise<void>}) {
  const [subject,setSubject]=useState('');
  const [description,setDescription]=useState('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [submitError,setSubmitError]=useState('');
  const [busy,setBusy]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const next:Record<string,string>={};if(!subject.trim())next.subject='Subject is required';if(!description.trim())next.description='Description is required';setErrors(next);setSubmitError('');if(Object.keys(next).length){focusFirstInvalid(event.currentTarget);return}setBusy(true);try{await onSave(subject.trim(),description.trim())}catch(error){setSubmitError(error instanceof Error?error.message:'Thread could not be created. Check your connection and try again.');setBusy(false)}};
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer form-drawer communication-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" type="button" onClick={onClose}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>New thread</h2><p>Start a company conversation.</p></div><button className="close" type="button" onClick={onClose} aria-label="Close new thread"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><FormErrorSummary errors={errors} formRef={formRef}/><fieldset><div className="form-grid"><Field label="Subject" required error={errors.subject} wide><input name="subject" maxLength={160} value={subject} onChange={event=>setSubject(event.target.value)} autoFocus/></Field><Field label="Description" required error={errors.description} wide><textarea name="description" maxLength={5000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Share context, an update, or a question"/></Field></div>{submitError&&<div className="form-submit-error" role="alert">{submitError}</div>}</fieldset><footer><button className="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?'Posting...':'Post thread'}</button></footer></form></section></div>,document.body);
}

function ThreadDetail({thread,user,onClose,onReply}:{thread:CommunicationThread;user:FireOpsUser;onClose:()=>void;onReply:(threadId:string,body:string)=>Promise<CommunicationReply>}) {
  const [reply,setReply]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const replyId=useId();
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!reply.trim())return;setBusy(true);setError('');try{await onReply(thread.id,reply.trim());setReply('')}catch(replyError){setError(replyError instanceof Error?replyError.message:'Reply could not be posted. Check your connection and try again.')}finally{setBusy(false)}};
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer thread-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{thread.subject}</h2><p>Started by {thread.createdBy}</p></div><button className="close" onClick={onClose} aria-label="Close thread"><X/></button></header><div className="thread-opening"><div className="thread-author"><span>{thread.createdBy.slice(0,1).toUpperCase()}</span><div><b>{thread.createdBy}</b><small>{thread.createdByRole==='owner'?'Company owner':'Crew'} · {formatCommunicationDate(thread.createdAt)}</small></div></div><p>{thread.description}</p></div><section className="thread-replies" aria-labelledby="thread-replies-heading"><h3 id="thread-replies-heading">Replies <span>{thread.replies.length}</span></h3>{thread.replies.map(item=><article className={item.createdById===user.id?'mine':''} key={item.id}><div className="thread-author"><span>{item.createdBy.slice(0,1).toUpperCase()}</span><div><b>{item.createdBy}</b><small>{formatCommunicationDate(item.createdAt)}</small></div></div><p>{item.body}</p></article>)}{!thread.replies.length&&<p className="no-updates">No replies yet.</p>}</section><form className="thread-reply-form" onSubmit={submit}><label htmlFor={replyId}>Reply to thread</label><textarea id={replyId} maxLength={5000} value={reply} onChange={event=>setReply(event.target.value)} placeholder="Write a reply"/>{error&&<div className="form-submit-error" role="alert">{error}</div>}<button className="primary" disabled={busy||!reply.trim()}><MessageSquare/>{busy?'Posting...':'Post reply'}</button></form></section></div>,document.body);
}

function formatCommunicationDate(date:string){return new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}

function DocumentsPage({documents,user,error,onAdd,onEdit,onDelete,onView}:{documents:CompanyDocument[];user:FireOpsUser;error?:string;onAdd:()=>void;onEdit:(document:CompanyDocument)=>void;onDelete:(document:CompanyDocument)=>void;onView:(document:CompanyDocument)=>void}) {
  const canManage=user.role==='owner';
  const ordered=[...documents].sort((left,right)=>Date.parse(right.updatedAt)-Date.parse(left.updatedAt));
  return <div className="page documents-page"><div className="page-heading documents-heading"><div><h1>Documents</h1><p>Company files available to every crew member.</p></div>{canManage&&<button className="primary" onClick={onAdd}><Upload/> Upload document</button>}</div>
    {error&&<div className="communication-load-error" role="alert"><CircleAlert/><span>{error}</span></div>}
    <section className="documents-panel" aria-labelledby="company-documents-heading"><header><div><h2 id="company-documents-heading">Company documents</h2><p>{documents.length} {documents.length===1?'document':'documents'}</p></div></header><div className="company-document-list">{ordered.map(document=>{const unread=isDocumentUnread(document,user);return <article className={`company-document-row ${unread?'unread':''}`} key={document.id}><button className="company-document-open" onClick={()=>onView(document)} aria-label={`Open ${document.name}`}><span className="company-document-icon"><FileText/></span><span className="company-document-copy"><span><b>{document.name}</b>{unread&&<i>New</i>}</span><small>{document.file.name}</small><em>Updated {new Date(document.updatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</em></span><ExternalLink/></button>{canManage&&<span className="company-document-actions"><button onClick={()=>onEdit(document)} aria-label={`Edit ${document.name}`}><Pencil/></button><button className="delete" onClick={()=>onDelete(document)} aria-label={`Delete ${document.name}`}><Trash2/></button></span>}</article>})}{!documents.length&&<div className="empty documents-empty"><FileText/><h3>No company documents</h3><p>{canManage?'Upload first document for crew access.':'Company owner has not uploaded any documents yet.'}</p></div>}</div></section>
  </div>;
}

function DocumentForm({document,uploadFile,onDiscardFiles,onClose,onSave}:{document?:CompanyDocument;uploadFile?:(file:File)=>Promise<VehicleFile>;onDiscardFiles?:()=>Promise<void>|void;onClose:()=>void;onSave:(name:string,file?:VehicleFile)=>Promise<void>}) {
  const [name,setName]=useState(document?.name??'');
  const [file,setFile]=useState<VehicleFile>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  const cancel=()=>{void onDiscardFiles?.();onClose()};
  const dialog=useDialogA11y(()=>{if(!busy)cancel()});
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!name.trim()||(!document&&!file)){setError(!name.trim()?'Document name is required.':'Choose file to upload.');return}setBusy(true);setError('');try{await onSave(name.trim(),file)}catch(saveError){setError(saveError instanceof Error?saveError.message:'Document could not be saved. Check your connection and try again.');setBusy(false)}};
  return createPortal(<div className="overlay"><section ref={dialog.ref} className="drawer form-drawer document-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-busy={busy} tabIndex={-1}><header><button className="back-mobile" disabled={busy} onClick={cancel}><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{document?'Edit document':'Upload document'}</h2><p>{document?'Change document name or replace file.':'Name document, then choose file.'}</p></div><button className="close" disabled={busy} onClick={cancel} aria-label="Close document form"><X/></button></header><form ref={formRef} onSubmit={submit}><fieldset><div className="form-grid"><Field label="Document name" required wide><input maxLength={160} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setError('')}} placeholder="e.g. Employee handbook" autoFocus/></Field><div className="wide"><FileUpload label={document?'Replace file (optional)':'Document file'} accept="image/*,.pdf,application/pdf" file={file} uploadFile={uploadFile} onChange={setFile}/></div></div>{document&&!file&&<div className="document-current-file"><FileText/><span><b>Current file</b><small>{document.file.name}</small></span></div>}{error&&<div className="form-submit-error" role="alert">{error}</div>}</fieldset><footer><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={busy||!name.trim()||(!document&&!file)}>{busy?'Saving...':document?'Save changes':'Upload document'}</button></footer></form></section></div>,window.document.body);
}

function DeleteDocumentDialog({document,onCancel,onConfirm}:{document:CompanyDocument;onCancel:()=>void;onConfirm:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useDialogA11y(()=>{if(!busy)onCancel()});
  const remove=async()=>{setBusy(true);setError('');try{await onConfirm()}catch(deleteError){setError(deleteError instanceof Error?deleteError.message:'Document could not be deleted. Check your connection and try again.');setBusy(false)}};
  return <div className="overlay confirm-overlay"><section ref={dialog.ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={`${dialog.titleId}-description`} aria-busy={busy} tabIndex={-1}><span className="confirm-icon"><Trash2/></span><div><h2 id={dialog.titleId}>Delete {document.name}?</h2><p id={`${dialog.titleId}-description`}>This permanently deletes document for every crew member. This action cannot be undone.</p>{error&&<div className="confirm-error" role="alert">{error}</div>}</div><footer><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-button" disabled={busy} onClick={()=>void remove()}><Trash2/> {busy?'Deleting...':'Delete document'}</button></footer></section></div>;
}

function SettingsPage({company,owner,invitedCrewCount,canManage,motiveConnection,onSaveMotive,onDisconnectMotive}:{company:CompanyInfo;owner:string;invitedCrewCount:number;canManage:boolean;motiveConnection?:MotiveConnection;onSaveMotive?:(apiKey:string)=>Promise<MotiveConnection>;onDisconnectMotive?:()=>Promise<MotiveConnection>}) {
  const initials=company.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase();
  const available=Math.max(0,company.crewInviteLimit-invitedCrewCount);
  const [connection,setConnection]=useState<MotiveConnection>(motiveConnection??{connected:false});
  const [apiKey,setApiKey]=useState('');
  const [showKey,setShowKey]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{if(motiveConnection)setConnection(motiveConnection)},[motiveConnection]);
  const saveMotive=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!apiKey.trim())return;setBusy(true);setError('');setSaved(false);try{const next=onSaveMotive?await onSaveMotive(apiKey.trim()):{connected:true,lastFour:apiKey.trim().slice(-4),lastVerifiedAt:new Date().toISOString()};setConnection(next);setApiKey('');setShowKey(false);setSaved(true)}catch(saveError){setError(saveError instanceof Error?saveError.message:'Motive API key could not be saved.')}finally{setBusy(false)}};
  const disconnect=async()=>{if(!onDisconnectMotive||!window.confirm('Disconnect Motive? Vehicle tracking and camera data will stop until a new API key is connected.'))return;setBusy(true);setError('');setSaved(false);try{setConnection(await onDisconnectMotive());setApiKey('')}catch(disconnectError){setError(disconnectError instanceof Error?disconnectError.message:'Motive connection could not be removed.')}finally{setBusy(false)}};
  return <div className="page settings-page"><div className="page-heading"><div><h1>Settings</h1></div></div><div className="settings-stack"><section className="company-card"><div className="company-logo">{initials}</div><div><h2>{company.name}</h2><p>{company.industry||'Industry not specified'}</p></div><dl><div><dt>Owner</dt><dd>{owner}</dd></div><div><dt>Company ID</dt><dd>{company.code}</dd></div>{canManage&&<><div><dt>Crew invite limit</dt><dd>{company.crewInviteLimit}</dd></div><div><dt>Crew invited</dt><dd>{invitedCrewCount}</dd></div><div><dt>Invites available</dt><dd>{available}</dd></div></>}</dl></section>{canManage&&<section className="integration-panel" aria-labelledby="motive-heading"><header><span className="integration-mark"><KeyRound/></span><div><h2 id="motive-heading">Motive</h2><p>Connect vehicle tracking and camera data to FireOps.</p></div>{connection.mock&&<span className="demo-indicator">Demo data</span>}<span className={`connection-state ${connection.connected?'connected':''}`}><i/>{connection.connected?'Connected':'Not connected'}</span></header><form onSubmit={saveMotive}><div className="integration-copy"><b>{connection.connected?`API key ending in ${connection.lastFour??'••••'}`:'Motive API key'}</b><p>Key is verified with Motive, encrypted, and never shown again. Vehicles will match Motive records by VIN.</p><a className="motive-site-link" href="https://gomotive.com" target="_blank" rel="noreferrer">Visit gomotive.com <ExternalLink/></a>{connection.lastVerifiedAt&&<small>Verified {new Date(connection.lastVerifiedAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</small>}</div><label className="secret-field"><span>{connection.connected?'Replace API key':'API key'}</span><span className="secret-control"><input type={showKey?'text':'password'} value={apiKey} onChange={event=>{setApiKey(event.target.value);setError('');setSaved(false)}} autoComplete="off" spellCheck={false} disabled={busy} placeholder="Paste Motive API key" aria-describedby="motive-key-help"/><button type="button" onClick={()=>setShowKey(value=>!value)} aria-label={showKey?'Hide API key':'Show API key'}>{showKey?<EyeOff/>:<Eye/>}</button></span><small id="motive-key-help">Find this in Motive Dashboard → Admin → Developers.</small></label>{error&&<div className="integration-error" role="alert">{error}</div>}{saved&&<div className="integration-success" role="status"><Check/> Motive connection saved</div>}<footer><button className="primary" type="submit" disabled={busy||!apiKey.trim()}>{busy?'Verifying...':connection.connected?'Verify and replace key':'Verify and connect'}</button>{connection.connected&&onDisconnectMotive&&<button className="integration-disconnect" type="button" disabled={busy} onClick={()=>void disconnect()}>Disconnect</button>}</footer></form></section>}</div></div>;
}

function CrewPage({crew,vehicles,inviteLimit,invitesAvailable,onInvite,onSelect}:{crew:CrewMember[];vehicles:Vehicle[];inviteLimit:number;invitesAvailable:number;onInvite:()=>void;onSelect:(member:CrewMember)=>void}) {
  return <div className="page crew-page"><div className="page-heading"><div><h1>Crew</h1>{invitesAvailable===0&&<p className="crew-limit-note">{inviteLimit===0?'Crew invitations are not enabled for this company.':'Crew invite limit reached. Contact FireOps to add more seats.'}</p>}</div>{invitesAvailable>0&&<div className="fleet-heading-actions"><button className="primary desktop-add" onClick={onInvite}><UserPlus/> Invite user</button><button className="primary mobile-add-vehicle" onClick={onInvite}><UserPlus/> Invite user</button></div>}</div>
    <section className="stats-row crew-stats"><Stat label="Total crew" value={crew.length}/><Stat label="Active" value={crew.filter(member=>member.status==='Active').length}/><Stat label="Invitations" value={crew.filter(member=>member.status==='Invited').length}/></section>
    <section className="crew-panel"><div className="list-label"><b>Company crew</b><span>{crew.length} people</span></div><div className="crew-list">{crew.map(member=>{const assigned=vehicles.find(vehicle=>vehicle.assignedTo===member.id);return <button className="crew-row" key={member.id} onClick={()=>onSelect(member)}><span className="crew-copy"><span className="crew-name"><b>{member.name}</b>{member.role==='owner'&&<em>Owner</em>}<i className={member.status.toLowerCase()}>{member.status}</i></span><small><Mail/> {member.email}</small><small><Phone/> {member.phone||'No phone added'}</small>{assigned&&<small className="crew-assignment"><Truck/> {assigned.unit}</small>}{assigned?.assignedFire&&<small className="crew-assignment"><Flame/> {assigned.assignedFire.name}</small>}</span><span className={crewCredentials(member).length?'credential-state complete':'credential-state'}><ShieldCheck/>{crewCredentials(member).length?`${crewCredentials(member).length} ${crewCredentials(member).length===1?'credential':'credentials'}`:'No credentials'}</span><ChevronRight className="card-arrow"/></button>})}</div></section>
  </div>;
}
function InviteCrewForm({existing,companyName,onClose,onSave}:{existing:CrewMember[];companyName:string;onClose:()=>void;onSave:(member:CrewMember)=>Promise<void>}) {
  const [form,setForm]=useState({email:'',name:'',phone:''});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [submitError,setSubmitError]=useState('');
  const [busy,setBusy]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  const dialog=useDialogA11y(()=>{if(!busy)onClose()});
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const email=form.email.trim().toLowerCase();const next:Record<string,string>={};if(!/^\S+@\S+\.\S+$/.test(email))next.email='Enter a valid email address';if(existing.some(member=>member.email.toLowerCase()===email))next.email='This user is already on your crew';setErrors(next);setSubmitError('');if(Object.keys(next).length){focusFirstInvalid(event.currentTarget);return}const fallback=email.split('@')[0].split(/[._-]/).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');setBusy(true);try{await onSave({id:crypto.randomUUID(),name:form.name.trim()||fallback,email,phone:form.phone.trim(),role:'member',status:'Invited'})}catch(error){setSubmitError(error instanceof Error?error.message:'Invitation could not be sent. Check your connection and try again.');setBusy(false)}};
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer invite-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-busy={busy} tabIndex={-1}><header><button className="back-mobile" disabled={busy} onClick={onClose} aria-label="Back to crew"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>Invite crew member</h2><p>They will receive an email to create their account.</p></div><button className="close" disabled={busy} onClick={onClose} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><FormErrorSummary errors={errors} formRef={formRef}/><FormSection number="1" title="Crew details" hideLegend><div className="form-grid"><Field label="Email address" required error={errors.email} wide><input name="email" type="email" maxLength={254} disabled={busy} value={form.email} onChange={event=>setForm({...form,email:event.target.value})} placeholder="name@company.com" autoFocus/></Field><Field label="Full name" wide><input maxLength={120} disabled={busy} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Optional until invite is accepted"/></Field><Field label="Phone" wide><input type="tel" maxLength={30} disabled={busy} value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})} placeholder="Optional"/></Field></div></FormSection><div className="invite-note"><Mail/><div><b>Email invitation to {companyName}</b><p>Invite remains pending until user completes account setup.</p></div></div>{submitError&&<div className="form-submit-error" role="alert">{submitError}</div>}<footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}><UserPlus/> {busy?'Sending invitation...':'Send invitation'}</button></footer></form></section></div>;
}
function CrewDetail({member,vehicles,uploadFile,onCommitFiles,onDiscardFiles,onClose,onSave,onAssign,onDelete}:{member:CrewMember;vehicles:Vehicle[];uploadFile?:(file:File)=>Promise<VehicleFile>;onCommitFiles?:(files:VehicleFile[])=>void;onDiscardFiles?:()=>Promise<void>|void;onClose:()=>void;onSave:(member:CrewMember)=>void;onAssign:(vehicleId:string)=>void;onDelete?:()=>void}) {
  const credentials=crewCredentials(member);
  const [pendingFile,setPendingFile]=useState<VehicleFile>();
  const [pendingName,setPendingName]=useState('');
  const [vehicleId,setVehicleId]=useState('');
  const assignedVehicles=vehicles.filter(vehicle=>vehicle.assignedTo===member.id);
  const availableVehicles=vehicles.filter(vehicle=>!vehicle.assignedTo&&['Ready','Assigned'].includes(vehicle.status));
  const canAssign=member.status==='Active'&&availableVehicles.length>0;
  const assignmentId=useId();
  const cancel=()=>{void onDiscardFiles?.();onClose()};
  const dialog=useDialogA11y(cancel);
  const assignVehicle=()=>{if(!vehicleId||!canAssign)return;onAssign(vehicleId);setVehicleId('')};
  const saveCredential=()=>{if(!pendingFile||!pendingName.trim())return;const next=[...credentials,{id:crypto.randomUUID(),name:pendingName.trim(),file:pendingFile}];onCommitFiles?.([pendingFile]);onSave({...member,credentials:next,credential:undefined,credentialName:undefined});setPendingFile(undefined);setPendingName('')};
  const removeCredential=(id:string)=>onSave({...member,credentials:credentials.filter(item=>item.id!==id),credential:undefined,credentialName:undefined});
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer crew-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={cancel} aria-label="Back to crew"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{member.name}</h2></div><button className="close" onClick={cancel} aria-label="Close crew details"><X/></button></header><div className="crew-profile"><span className={`crew-status ${member.status.toLowerCase()}`}>{member.status}</span><h3>{member.name}</h3><p>{member.role==='owner'?'Company owner':'Crew member'}</p></div><div className="detail-section crew-contact"><h4>Contact information</h4><dl className="details"><Detail icon={<Mail/>} label="Email" value={<a href={`mailto:${member.email}`}>{member.email}</a>}/><Detail icon={<Phone/>} label="Phone" value={member.phone?<a href={`tel:${member.phone.replace(/[^\d+]/g,'')}`}>{member.phone}</a>:'Not added'}/></dl><div className="credential-heading"><div><h4>Credentials</h4><span>{credentials.length} on file</span></div>{!pendingFile&&<FileUpload label="Upload credential" accept="image/*,.pdf,application/pdf" uploadFile={uploadFile} onChange={setPendingFile}/>}</div>{pendingFile&&<div className="credential-naming"><span className="credential-file"><span className="credential-file-icon">{pendingFile.type.startsWith('image/')?<FileImage/>:<FileText/>}</span><span><b>{pendingFile.name}</b><small>Ready to name</small></span></span><Field label="What is this credential?" required><input maxLength={120} value={pendingName} onChange={event=>setPendingName(event.target.value)} placeholder="e.g. Red Card, EMT certification" autoFocus/></Field><div className="credential-naming-actions"><button className="secondary" type="button" onClick={()=>setPendingFile(undefined)}>Cancel</button><button className="primary" type="button" disabled={!pendingName.trim()} onClick={saveCredential}><Plus/> Add credential</button></div></div>}{credentials.length?<div className="credential-list">{credentials.map(item=><div className="credential-item" key={item.id}><a href={item.file.dataUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.name}`}><span className="document-thumbnail">{item.file.type.startsWith('image/')?<img src={item.file.dataUrl} alt="" loading="lazy" decoding="async"/>:<FileText/>}</span><span className="document-copy"><b>{item.name}</b><small>{item.file.name}</small></span><ExternalLink/></a><button type="button" onClick={()=>removeCredential(item.id)} aria-label={`Remove ${item.name}`}><Trash2/></button></div>)}</div>:!pendingFile&&<p className="no-updates credential-empty">No credentials uploaded.</p>}</div><div className="detail-section"><h4>Assigned vehicles</h4>{assignedVehicles.length?<div className="assigned-vehicles">{assignedVehicles.map(vehicle=><div key={vehicle.id}><Truck/><span><b>{vehicle.unit}</b><small>{vehicle.year} {vehicle.make} {vehicle.model}</small>{vehicle.assignedFire&&<small className="assigned-fire"><Flame/> {vehicle.assignedFire.name}</small>}</span></div>)}</div>:<p className="no-updates">No vehicles assigned.</p>}</div><div className="detail-section crew-assignment"><h4>Assign vehicle</h4><label htmlFor={assignmentId}>Vehicle</label><div><select id={assignmentId} value={vehicleId} disabled={!canAssign} onChange={event=>setVehicleId(event.target.value)}><option value="">Select vehicle</option>{availableVehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.unit} · {vehicle.year} {vehicle.make} {vehicle.model}</option>)}</select><button className="primary" disabled={!vehicleId||!canAssign} onClick={assignVehicle}><Truck/> Assign</button></div>{member.status==='Invited'?<p>Assignment available after invitation is accepted.</p>:!availableVehicles.length&&<p>No ready or unassigned vehicles available.</p>}</div>{onDelete&&<div className="crew-record-actions"><button className="delete-vehicle" onClick={onDelete}><Trash2/> Remove crew member</button><p>Removes company access and clears vehicle assignments.</p></div>}</section></div>;
}

function VehicleForm({vehicle,vehicleTypes,vehicleTypeError,vehicles,onCreateVehicleType,onDeleteVehicleType,uploadFile,onCommitFiles,onDiscardFiles,onClose,onSave}:{vehicle?:Vehicle;vehicleTypes:VehicleTypeOption[];vehicleTypeError?:string;vehicles:Vehicle[];onCreateVehicleType:(name:string)=>Promise<VehicleTypeOption>;onDeleteVehicleType:(type:VehicleTypeOption)=>Promise<void>;uploadFile?:(file:File)=>Promise<VehicleFile>;onCommitFiles?:(files:VehicleFile[])=>void;onDiscardFiles?:()=>Promise<void>|void;onClose:()=>void;onSave:(v:Vehicle)=>void}) {
  const editing = Boolean(vehicle);
  const [managingTypes,setManagingTypes]=useState(false);
  const cancel=()=>{if(managingTypes){setManagingTypes(false);return}void onDiscardFiles?.();onClose()};
  const dialog=useDialogA11y(cancel);
  const [form,setForm]=useState({unit:vehicle?.unit??'',type:vehicle?.type??'',year:String(vehicle?.year??new Date().getFullYear()),make:vehicle?.make??'',model:vehicle?.model??'',vin:vehicle?.vin??'',plate:vehicle?.plate??'',status:vehicle?.status??'Ready' as Status,notes:vehicle?.notes??''});
  const [photo,setPhoto]=useState(vehicle?.photo);
  const [documents,setDocuments]=useState<NamedDocument[]>(()=>vehicle?vehicleDocuments(vehicle):[]);
  const [pendingDocument,setPendingDocument]=useState<VehicleFile>();
  const [pendingDocumentName,setPendingDocumentName]=useState('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const formRef=useRef<HTMLFormElement>(null);
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const configuredType=vehicleTypes.find(type=>type.name.toLocaleLowerCase()===form.type.toLocaleLowerCase());
  const existingLegacyType=Boolean(editing&&vehicle&&form.type&&vehicle.type.toLocaleLowerCase()===form.type.toLocaleLowerCase());
  const selectedType=configuredType?.name??(existingLegacyType?form.type:vehicleTypes[0]?.name??'');
  const typeNames=existingLegacyType&&!configuredType?[form.type,...vehicleTypes.map(type=>type.name)]:vehicleTypes.map(type=>type.name);
  const addDocument=()=>{if(!pendingDocument||!pendingDocumentName.trim())return;setDocuments(current=>[...current,{id:crypto.randomUUID(),name:pendingDocumentName.trim(),file:pendingDocument}]);setPendingDocument(undefined);setPendingDocumentName('')};
  const submit=(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const next:Record<string,string>={};if(!form.unit.trim())next.unit='Unit name is required';if(!selectedType)next.type='Select a vehicle type';if(!form.make.trim())next.make='Make is required';if(!form.model.trim())next.model='Model is required';if(!form.year||Number(form.year)<1950||Number(form.year)>new Date().getFullYear()+1)next.year='Enter a valid year';if(form.status==='Assigned'&&!vehicle?.assignedTo)next.status='Assign a crew member from vehicle details before using Assigned status';setErrors(next);if(Object.keys(next).length){focusFirstInvalid(e.currentTarget);return}onCommitFiles?.([photo,...documents.map(document=>document.file)].filter((file):file is VehicleFile=>Boolean(file)));onSave({id:vehicle?.id??crypto.randomUUID(),unit:form.unit.trim(),type:selectedType,year:Number(form.year),make:form.make.trim(),model:form.model.trim(),vin:form.vin.trim().toUpperCase(),plate:form.plate.trim().toUpperCase(),status:form.status,photo,documents,contract:undefined,viprChecklist:undefined,registration:undefined,insurance:undefined,dotInspection:undefined,notes:form.notes.trim(),createdAt:vehicle?.createdAt??new Date().toISOString(),assignedTo:vehicle?.assignedTo,assignedFire:vehicle?.assignedFire})};
  if(managingTypes)return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer vehicle-type-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={()=>setManagingTypes(false)} aria-label="Back to vehicle form"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>Vehicle types</h2><p>Add choices used when creating or editing vehicles.</p></div><button className="close" onClick={()=>setManagingTypes(false)} aria-label="Back to vehicle form"><X/></button></header><VehicleTypeManager types={vehicleTypes} vehicles={vehicles} loadError={vehicleTypeError} onCreate={onCreateVehicleType} onDelete={onDeleteVehicleType}/></section></div>;
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={cancel} aria-label="Back to fleet"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{editing?'Edit vehicle':'Add vehicle'}</h2><p>{editing?'Update fleet details for this vehicle.':'Enter basic details. You can update these later.'}</p></div><button className="close" onClick={cancel} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate>
    <FormErrorSummary errors={errors} formRef={formRef}/><FormSection number="1" title="Vehicle details" hideLegend><div className="form-grid"><Field label="Unit name" required error={errors.unit}><input name="unit" maxLength={120} value={form.unit} onChange={e=>update('unit',e.target.value)} placeholder="e.g. Engine 702" autoFocus/></Field><Field label="Vehicle type" required error={errors.type}><select name="type" value={selectedType} onChange={e=>{if(e.target.value==='__edit_vehicle_types__'){setManagingTypes(true);return}update('type',e.target.value)}}>{!selectedType&&<option value="">Select vehicle type</option>}{typeNames.map(type=><option key={type} value={type}>{type}</option>)}<option disabled>──────────</option><option value="__edit_vehicle_types__">Edit vehicle types…</option></select></Field><Field label="Year" required error={errors.year}><input name="year" type="number" inputMode="numeric" value={form.year} onChange={e=>update('year',e.target.value)}/></Field><Field label="Make" required error={errors.make}><input name="make" maxLength={80} value={form.make} onChange={e=>update('make',e.target.value)} placeholder="e.g. International"/></Field><Field label="Model" required error={errors.model}><input name="model" maxLength={80} value={form.model} onChange={e=>update('model',e.target.value)} placeholder="e.g. HV"/></Field><Field label="Status" error={errors.status}><select name="status" value={form.status} onChange={e=>update('status',e.target.value)}>{statuses.map(s=><option key={s} disabled={s==='Assigned'&&!vehicle?.assignedTo}>{s}</option>)}</select></Field></div></FormSection>
    <FormSection number="2" title="Registration & documents" optional hideLegend><div className="form-grid"><Field label="VIN"><input value={form.vin} onChange={e=>update('vin',e.target.value)} maxLength={17} placeholder="17-character VIN"/></Field><Field label="License plate"><input maxLength={20} value={form.plate} onChange={e=>update('plate',e.target.value)} placeholder="Plate number"/></Field><div className="wide"><FileUpload label="Vehicle photo" accept="image/*" file={photo} uploadFile={uploadFile} onChange={setPhoto}/></div><div className="vehicle-document-manager wide"><div className="credential-heading"><div><h4>Documents</h4><span>{documents.length} added</span></div>{!pendingDocument&&<FileUpload label="Upload document" accept="image/*,.pdf,application/pdf" uploadFile={uploadFile} onChange={setPendingDocument}/>}</div>{pendingDocument&&<div className="credential-naming"><span className="credential-file"><span className="credential-file-icon">{pendingDocument.type.startsWith('image/')?<FileImage/>:<FileText/>}</span><span><b>{pendingDocument.name}</b><small>Ready to name</small></span></span><Field label="What is this document?" required><input maxLength={120} value={pendingDocumentName} onChange={event=>setPendingDocumentName(event.target.value)} placeholder="e.g. Registration, insurance, VIPR checklist" autoFocus/></Field><div className="credential-naming-actions"><button className="secondary" type="button" onClick={()=>setPendingDocument(undefined)}>Cancel</button><button className="primary" type="button" disabled={!pendingDocumentName.trim()} onClick={addDocument}><Plus/> Add document</button></div></div>}{documents.length?<div className="credential-list">{documents.map(document=><div className="credential-item" key={document.id}><a href={document.file.dataUrl} target="_blank" rel="noreferrer" aria-label={`Open ${document.name}`}><span className="document-thumbnail">{document.file.type.startsWith('image/')?<img src={document.file.dataUrl} alt="" loading="lazy" decoding="async"/>:<FileText/>}</span><span className="document-copy"><b>{document.name}</b><small>{document.file.name}</small></span><ExternalLink/></a><button type="button" onClick={()=>setDocuments(current=>current.filter(item=>item.id!==document.id))} aria-label={`Remove ${document.name}`}><Trash2/></button></div>)}</div>:!pendingDocument&&<p className="no-updates credential-empty">No documents added.</p>}</div><Field label="Notes" wide><textarea maxLength={2000} value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="Anything else to know about this vehicle"/></Field></div></FormSection>
    <footer><button type="button" className="secondary" onClick={cancel}>Cancel</button><button className="primary" type="submit">{editing?<Pencil/>:<Plus/>} {editing?'Save changes':'Add to inventory'}</button></footer>
  </form></section></div>
}
function VehicleTypeManager({types,vehicles,loadError,onCreate,onDelete}:{types:VehicleTypeOption[];vehicles:Vehicle[];loadError?:string;onCreate:(name:string)=>Promise<VehicleTypeOption>;onDelete:(type:VehicleTypeOption)=>Promise<void>}) {
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [actionError,setActionError]=useState('');
  const [deleteCandidate,setDeleteCandidate]=useState<VehicleTypeOption>();
  const usageCount=(type:VehicleTypeOption)=>vehicles.filter(vehicle=>vehicle.type.trim().toLocaleLowerCase()===type.name.toLocaleLowerCase()).length;
  const add=async(event:React.FormEvent)=>{
    event.preventDefault();
    const value=name.trim();
    if(!value||busy)return;
    if(types.some(type=>type.name.toLocaleLowerCase()===value.toLocaleLowerCase())){setActionError('Vehicle type already exists.');return}
    setBusy(true);setActionError('');
    try{await onCreate(value);setName('')}
    catch(error){setActionError(error instanceof Error?error.message:'Vehicle type could not be added.')}
    finally{setBusy(false)}
  };
  const remove=async(type:VehicleTypeOption)=>{
    setBusy(true);setActionError('');
    try{await onDelete(type);setDeleteCandidate(undefined)}
    catch(error){setActionError(error instanceof Error?error.message:'Vehicle type could not be removed.')}
    finally{setBusy(false)}
  };
  return <div className="vehicle-type-manager"><div className="vehicle-type-intro"><h3>Manage vehicle type choices</h3><p>Types assigned to existing vehicles cannot be removed.</p></div>{(actionError||loadError)&&<div className="form-submit-error" role="alert">{actionError||loadError}</div>}<form className="vehicle-type-add" onSubmit={event=>void add(event)}><label htmlFor="new-vehicle-type">Add vehicle type</label><div><input id="new-vehicle-type" value={name} onChange={event=>{setName(event.target.value);setActionError('')}} placeholder="e.g. Command Vehicle" maxLength={80} autoCapitalize="words" autoFocus/><button className="primary" type="submit" disabled={!name.trim()||busy}><Plus/> {busy?'Adding…':'Add'}</button></div></form><div className="vehicle-type-list-heading"><h3>Available types</h3><span>{types.length}</span></div><div className="vehicle-type-list">{types.map(type=>{const count=usageCount(type);const unavailable=count>0||types.length===1;const confirming=deleteCandidate?.id===type.id;return <div className={`vehicle-type-row${confirming?' confirming':''}`} key={type.id}><div><b>{type.name}</b><small>{count?`${count} ${count===1?'vehicle':'vehicles'}`:'Not in use'}</small></div>{confirming?<div className="vehicle-type-confirm"><span>Remove?</span><button type="button" disabled={busy} onClick={()=>setDeleteCandidate(undefined)}>Cancel</button><button type="button" disabled={busy} onClick={()=>void remove(type)}>Yes, remove</button></div>:<button className="vehicle-type-remove" type="button" disabled={unavailable||busy} title={count?'Change vehicles using this type before removing it.':types.length===1?'Add another type before removing this one.':`Remove ${type.name}`} aria-label={`Remove ${type.name}`} onClick={()=>setDeleteCandidate(type)}><Trash2/></button>}</div>})}{!types.length&&<div className="vehicle-type-empty">No vehicle types yet. Add one above.</div>}</div></div>;
}
function IssueForm({vehicles,initialVehicleId,user,onClose,onSave}:{vehicles:Vehicle[];initialVehicleId?:string;user:FireOpsUser;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [form,setForm]=useState({vehicleId:initialVehicleId||vehicles[0]?.id||'',title:'',description:'',priority:'Medium' as Priority});
  const dialog=useDialogA11y(onClose);
  const [errors,setErrors]=useState<Record<string,string>>({});
  const formRef=useRef<HTMLFormElement>(null);
  const update=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const submit=(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const next:Record<string,string>={};if(!form.vehicleId)next.vehicleId='Select a vehicle';if(!form.title.trim())next.title='Issue title is required';if(!form.description.trim())next.description='Description is required';setErrors(next);if(Object.keys(next).length){focusFirstInvalid(e.currentTarget);return}onSave({id:crypto.randomUUID(),vehicleId:form.vehicleId,title:form.title.trim(),description:form.description.trim(),priority:form.priority,status:'Open',updates:[],createdBy:user.name,createdById:user.id,createdAt:new Date().toISOString()})};
  return <div className="overlay"><section ref={dialog.ref} className="drawer form-drawer issue-form" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Back to fleet"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>New issue</h2><p>Report a vehicle problem for company review.</p></div><button className="close" onClick={onClose} aria-label="Close"><X/></button></header><form ref={formRef} onSubmit={submit} noValidate><FormErrorSummary errors={errors} formRef={formRef}/><fieldset><legend className="sr-only">Issue details</legend><div className="form-grid"><Field label="Vehicle" required error={errors.vehicleId} wide><select name="vehicleId" value={form.vehicleId} onChange={e=>update('vehicleId',e.target.value)} autoFocus><option value="">Select a vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.unit} — {v.year} {v.make} {v.model}</option>)}</select></Field><Field label="Issue title" required error={errors.title} wide><input name="title" maxLength={160} value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Pump losing pressure"/></Field><Field label="Description" required error={errors.description} wide><textarea name="description" maxLength={2000} value={form.description} onChange={e=>update('description',e.target.value)} placeholder="Describe the issue and when it occurs"/></Field><Field label="Priority" required wide><select value={form.priority} onChange={e=>update('priority',e.target.value)}>{priorities.map(p=><option key={p}>{p}</option>)}</select></Field></div></fieldset><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit"><Plus/> Create issue</button></footer></form></section></div>
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
  return <div className="upload-field"><span id={`${inputId}-label`}>{label}</span><label className={file?'has-file':''} htmlFor={inputId}><input id={inputId} type="file" accept={accept} disabled={busy} aria-labelledby={`${inputId}-label`} aria-describedby={error?errorId:undefined} aria-invalid={error?true:undefined} onChange={e=>void selectFile(e.target.files?.[0])}/>{busy?<Upload/>:file?(file.type.startsWith('image/')?<FileImage/>:<FileText/>):<Upload/>}<span>{busy?'Uploading...':file?.name??'Choose file'}</span></label>{file&&<button className="upload-remove" type="button" onClick={()=>onChange(undefined)} aria-label={`Remove ${label}`}><Trash2/> Remove</button>}{error&&<small id={errorId} role="alert">{error}</small>}</div>
}

function DeleteCrewDialog({member,assignmentCount,busy,error,onCancel,onConfirm}:{member:CrewMember;assignmentCount:number;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}) {
  const dialog=useDialogA11y(onCancel);
  return <div className="overlay confirm-overlay"><section ref={dialog.ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={`${dialog.titleId}-description`} aria-busy={busy} tabIndex={-1}><span className="confirm-icon"><Trash2/></span><div><h2 id={dialog.titleId}>Remove {member.name}?</h2><p id={`${dialog.titleId}-description`}>This removes them from company crew and revokes their FireOps access.{assignmentCount?` ${assignmentCount} vehicle ${assignmentCount===1?'assignment':'assignments'} will be cleared.`:''} This action cannot be undone.</p>{error&&<div className="confirm-error" role="alert">{error}</div>}</div><footer><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-button" disabled={busy} onClick={onConfirm}><Trash2/> {busy?'Removing...':'Remove member'}</button></footer></section></div>;
}

function DeleteVehicleDialog({vehicle,issueCount,onCancel,onConfirm}:{vehicle:Vehicle;issueCount:number;onCancel:()=>void;onConfirm:()=>void}) {
  const dialog=useDialogA11y(onCancel);
  return <div className="overlay confirm-overlay"><section ref={dialog.ref} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={`${dialog.titleId}-description`} tabIndex={-1}><span className="confirm-icon"><Trash2/></span><div><h2 id={dialog.titleId}>Delete {vehicle.unit}?</h2><p id={`${dialog.titleId}-description`}>This permanently deletes vehicle record{issueCount?` and ${issueCount} linked ${issueCount===1?'issue':'issues'}`:''}. This action cannot be undone.</p></div><footer><button className="secondary" onClick={onCancel}>Cancel</button><button className="danger-button" onClick={onConfirm}><Trash2/> Delete vehicle</button></footer></section></div>;
}

function motiveDemoFor(vehicle:Vehicle) {
  const feeds=[
    {location:'Redding, CA · I-5 North',speed:'42 mph',ago:'2 min ago'},
    {location:'Shasta Lake, CA · Shasta Dam Blvd',speed:'0 mph',ago:'5 min ago'},
    {location:'Anderson, CA · Factory Outlets Dr',speed:'27 mph',ago:'1 min ago'}
  ];
  return feeds[Math.abs(vehicle.id.split('').reduce((sum,char)=>sum+char.charCodeAt(0),0))%feeds.length];
}

function motiveSnapshotFor(vehicle:Vehicle,connection:MotiveConnection){
  if(connection.mock){const feed=motiveDemoFor(vehicle);return {location:feed.location,speed:feed.speed,updatedAt:`Updated ${feed.ago}`}}
  const vin=vehicle.vin.trim().toUpperCase();
  const snapshot=vin?connection.vehicles?.find(item=>item.vin.trim().toUpperCase()===vin):undefined;
  if(!snapshot)return undefined;
  const timestamp=Date.parse(snapshot.updatedAt);
  const updatedAt=Number.isNaN(timestamp)?snapshot.updatedAt:`Updated ${new Date(timestamp).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
  return {location:snapshot.location,speed:snapshot.speed,updatedAt};
}

function MotiveHeroStatus({vehicle}:{vehicle:Vehicle}) {
  const feed=motiveDemoFor(vehicle);
  const [capturing,setCapturing]=useState(false);
  const [capture,setCapture]=useState<{src:string;capturedAt:string}|null>(null);
  const captureImage=()=>{
    if(capturing)return;
    setCapturing(true);
    window.setTimeout(()=>{
      setCapture({src:'/motive-camera-demo.svg',capturedAt:new Date().toISOString()});
      setCapturing(false);
    },650);
  };
  return <><div className="motive-hero-status" aria-label="Motive vehicle status"><div className="motive-hero-title"><span><i/>Motive live</span><small>Updated {feed.ago}</small></div><div className="motive-hero-data"><span><MapPin/><b>{feed.location}</b></span><span><Gauge/><b>{feed.speed}</b></span><button className="motive-camera-capture" type="button" onClick={captureImage} disabled={capturing} aria-haspopup="dialog"><Camera/><b>{capturing?'Capturing…':'Camera online'}</b></button></div></div>{capture&&<MotiveImageViewer vehicle={vehicle} capture={capture} onClose={()=>setCapture(null)}/>}</>;
}

function MotiveImageViewer({vehicle,capture,onClose}:{vehicle:Vehicle;capture:{src:string;capturedAt:string};onClose:()=>void}) {
  const dialog=useDialogA11y<HTMLDivElement>(onClose);
  return createPortal(<div className="camera-viewer-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><div ref={dialog.ref} className="camera-viewer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><div><h2 id={dialog.titleId}>{vehicle.unit} camera image</h2><p>Captured {new Date(capture.capturedAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'})}</p></div><button type="button" onClick={onClose} aria-label="Close camera image"><X/></button></header><div className="camera-viewer-stage"><img src={capture.src} alt={`Forward camera capture from ${vehicle.unit}`}/></div></div></div>,document.body);
}

function FireAssignmentField({vehicle,onChange}:{vehicle:Vehicle;onChange:(fire?:Pick<NifcIncident,'id'|'name'|'state'>)=>void}){
  const listId=useId();
  const [query,setQuery]=useState(vehicle.assignedFire?.name??'');
  const [incidents,setIncidents]=useState<NifcIncident[]>([]);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{setQuery(vehicle.assignedFire?.name??'')},[vehicle.assignedFire?.id,vehicle.assignedFire?.name]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    void fetchIncidents(controller.signal).then(data=>{setIncidents(data);setLoading(false)}).catch(fetchError=>{
      if(fetchError instanceof DOMException&&fetchError.name==='AbortError')return;
      setError('Active fires could not be loaded. Check connection and retry.');setLoading(false);
    });
    return()=>controller.abort();
  },[attempt]);
  const matches=useMemo(()=>{
    const term=query.trim().toLowerCase();
    if(!term)return incidents.slice(0,8);
    return incidents.filter(incident=>`${incident.name} ${incident.state}`.toLowerCase().includes(term)).slice(0,8);
  },[incidents,query]);
  const choose=(incident:NifcIncident)=>{setQuery(incident.name);setOpen(false);onChange({id:incident.id,name:incident.name,state:incident.state})};
  return <div className="fire-assignment"><label htmlFor={`${listId}-input`}>Assigned to fire</label><div className="fire-combobox"><Flame aria-hidden="true"/><input id={`${listId}-input`} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={open} value={query} placeholder="Type fire name" autoComplete="off" onFocus={()=>setOpen(true)} onBlur={()=>window.setTimeout(()=>{setOpen(false);setQuery(vehicle.assignedFire?.name??'')},0)} onChange={event=>{setQuery(event.target.value);setOpen(true)}} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false)}}}/>{vehicle.assignedFire&&<button type="button" aria-label={`Clear fire assignment to ${vehicle.assignedFire.name}`} onMouseDown={event=>event.preventDefault()} onClick={()=>{setQuery('');setOpen(false);onChange(undefined)}}><X/></button>}{open&&<div className="fire-options" id={listId} role="listbox">{loading?<p>Loading active fires...</p>:error?<div className="fire-options-state"><p>{error}</p><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>setAttempt(value=>value+1)}>Retry</button></div>:matches.length?matches.map(incident=><button type="button" role="option" aria-selected={vehicle.assignedFire?.id===incident.id} key={incident.id} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(incident)}><span><b>{incident.name}</b><small>{incident.state||'State not reported'}</small></span>{vehicle.assignedFire?.id===incident.id&&<Check/>}</button>):<p>No active fires match "{query.trim()}".</p>}</div>}</div><small>Searches active NIFC fires. Selecting fire assigns vehicle to incident.</small></div>;
}

function VehicleDetail({vehicle,issues,crew,user,canManage,motiveMock,onClose,onEdit,onDelete,onNewIssue,onIssue,onStatus,onAssignee,onFire,onAssign}:{vehicle:Vehicle;issues:FleetIssue[];crew:CrewMember[];user:FireOpsUser;canManage:boolean;motiveMock:boolean;onClose:()=>void;onEdit:()=>void;onDelete:()=>void;onNewIssue:()=>void;onIssue:(issue:FleetIssue)=>void;onStatus:(s:Status)=>void;onAssignee:(memberId:string)=>void;onFire:(fire?:Pick<NifcIncident,'id'|'name'|'state'>)=>void;onAssign:()=>void}) {const openIssues=issues.filter(issue=>issue.status==='Open');const resolvedIssues=issues.filter(issue=>issue.status==='Resolved').sort((a,b)=>Date.parse(b.resolvedAt??b.createdAt)-Date.parse(a.resolvedAt??a.createdAt));const activeCrew=crew.filter(member=>member.status==='Active');const documents=vehicleDocuments(vehicle);const dialog=useDialogA11y(onClose);return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}><header><button className="back-mobile" onClick={onClose} aria-label="Back to fleet"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{vehicle.unit}</h2></div><div className="detail-actions"><button className="close" onClick={onClose} aria-label="Close vehicle details"><X/></button></div></header><div className="detail-hero"><div className={`large-vehicle-icon ${vehicle.photo?'has-photo':''}`}>{vehicle.photo?<img src={vehicle.photo.dataUrl} alt={`${vehicle.unit} vehicle`} loading="lazy" decoding="async"/>:<Truck/>}</div><StatusBadge status={vehicle.status}/><h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3><p>{vehicle.type}</p>{vehicle.assignedTo&&<span className="assigned-person"><CircleUserRound/> Assigned to {crew.find(member=>member.id===vehicle.assignedTo)?.name??'Crew member'}</span>}{motiveMock&&<MotiveHeroStatus vehicle={vehicle}/>}<div className="vehicle-detail-buttons"><button className="issue-vehicle-button" onClick={onNewIssue}><CircleAlert/> Open issue</button><button className={vehicle.assignedTo===user.id?'assignment-button assigned':'assignment-button'} disabled={Boolean(vehicle.assignedTo&&vehicle.assignedTo!==user.id)||(!canManage&&!vehicle.assignedTo&&vehicle.status!=='Ready')} onClick={onAssign}>{vehicle.assignedTo===user.id?<><Check/> Remove Assignment</>:vehicle.assignedTo?<><CircleUserRound/> Assigned</>:!canManage&&vehicle.status!=='Ready'?<><CircleUserRound/> Unavailable</>:<><CircleUserRound/> Assign to me</>}</button></div></div><div className="detail-section"><h4>Current status</h4><label className={`status-select ${canManage?'':'readonly'}`}><span className="sr-only">Current vehicle status</span><select value={vehicle.status} disabled={!canManage} onChange={event=>onStatus(event.target.value as Status)}>{statuses.map(s=><option key={s} disabled={s==='Assigned'&&!vehicle.assignedTo}>{s}</option>)}</select></label>{canManage&&<label className="assignee-select"><span>Assigned crew member</span><select value={vehicle.assignedTo??''} onChange={event=>onAssignee(event.target.value)}><option value="">No crew member assigned</option>{activeCrew.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select><small>Selecting crew changes status to Assigned.</small></label>}{canManage&&vehicle.assignedTo&&<FireAssignmentField vehicle={vehicle} onChange={onFire}/>}</div>{openIssues.length>0&&<div className="detail-section vehicle-issues"><h4>Open issues <span>{openIssues.length}</span></h4>{openIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className={`priority-icon ${issue.priority.toLowerCase()}`}><AlertTriangle/></span><span><b>{issue.title}</b><small>{issue.priority} priority · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{canManage&&<div className="vehicle-record-actions"><button className="edit-vehicle" onClick={onEdit}><Pencil/> Edit vehicle details</button><button className="delete-vehicle" onClick={onDelete}><Trash2/> Delete vehicle</button></div>}<div className="detail-section"><h4>Vehicle information</h4><dl className="details"><Detail icon={<Hash/>} label="VIN" value={vehicle.vin||'Not added'}/><Detail icon={<CarFront/>} label="License plate" value={vehicle.plate||'Not added'}/><Detail icon={<CalendarDays/>} label="Added" value={new Date(vehicle.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}/></dl></div><div className="detail-section"><h4>Documents</h4>{documents.length?<div className="document-list">{documents.map(document=><a className="document-preview" key={document.id} href={document.file.dataUrl} target="_blank" rel="noreferrer" aria-label={`Open ${document.name}: ${document.file.name}`}><span className={`document-thumbnail ${document.file.type.startsWith('image/')?'image':''}`}>{document.file.type.startsWith('image/')?<img src={document.file.dataUrl} alt="" loading="lazy" decoding="async"/>:<FileText/>}</span><span className="document-copy"><b>{document.name}</b><small>{document.file.name}</small></span><ExternalLink/></a>)}</div>:<p className="no-updates">No documents added.</p>}</div>{resolvedIssues.length>0&&<div className="detail-section vehicle-issues resolved-vehicle-issues"><h4>Resolved issues <span>{resolvedIssues.length}</span></h4>{resolvedIssues.map(issue=><button key={issue.id} onClick={()=>onIssue(issue)}><span className="priority-icon resolved"><Check/></span><span><b>{issue.title}</b><small>Resolved {new Date(issue.resolvedAt??issue.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {issue.updates.length} {issue.updates.length===1?'update':'updates'}</small></span><ChevronRight/></button>)}</div>}{vehicle.notes&&<div className="detail-section"><h4>Notes</h4><p className="notes">{vehicle.notes}</p></div>}</section></div>}
function IssueDetail({issue,vehicle,user,canManage,onClose,onSave}:{issue:FleetIssue;vehicle?:Vehicle;user:FireOpsUser;canManage:boolean;onClose:()=>void;onSave:(issue:FleetIssue)=>void}) {
  const [updateText,setUpdateText]=useState('');
  const [editingDetails,setEditingDetails]=useState(false);
  const [details,setDetails]=useState({title:issue.title,description:issue.description,priority:issue.priority});
  const [detailErrors,setDetailErrors]=useState<Record<string,string>>({});
  const detailFormRef=useRef<HTMLFormElement>(null);
  const dialog=useDialogA11y(onClose);
  const updateId=useId();
  const detailsChanged=details.title.trim()!==issue.title||details.description.trim()!==issue.description||details.priority!==issue.priority;
  const beginEditing=()=>{setDetails({title:issue.title,description:issue.description,priority:issue.priority});setDetailErrors({});setEditingDetails(true)};
  const cancelEditing=()=>{setDetails({title:issue.title,description:issue.description,priority:issue.priority});setDetailErrors({});setEditingDetails(false)};
  const saveDetails=(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!canManage)return;
    const errors:Record<string,string>={};
    if(!details.title.trim())errors.title='Issue title is required';
    if(!details.description.trim())errors.description='Description is required';
    setDetailErrors(errors);
    if(Object.keys(errors).length){focusFirstInvalid(event.currentTarget);return}
    onSave({...issue,title:details.title.trim(),description:details.description.trim(),priority:details.priority});
    setEditingDetails(false);
  };
  const saveUpdate=(status?:IssueStatus)=>{if(!updateText.trim())return;const now=new Date().toISOString();const nextStatus=status??issue.status;onSave({...issue,status:nextStatus,resolvedAt:nextStatus==='Resolved'?(issue.resolvedAt??now):undefined,updates:[{id:crypto.randomUUID(),text:updateText.trim(),createdBy:user.name,createdById:user.id,createdAt:now},...issue.updates]});setUpdateText('')};
  const addUpdate=(event:React.FormEvent)=>{event.preventDefault();saveUpdate()};
  const formatDate=(date:string)=>new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer issue-detail" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}>
    <header><button className="back-mobile" onClick={onClose} aria-label="Back to previous view"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{issue.title}</h2></div><div className="detail-actions"><button className="close" onClick={onClose} aria-label="Close issue details"><X/></button></div></header>
    <div className="issue-detail-summary">{vehicle&&<div className="issue-vehicle-context"><span><Truck/></span><div><b>{vehicle.unit}</b><small>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.type}</small></div><StatusBadge status={vehicle.status}/></div>}
      {editingDetails?<form ref={detailFormRef} className="issue-details-form" onSubmit={saveDetails} noValidate><FormErrorSummary errors={detailErrors} formRef={detailFormRef}/><div className="form-grid"><Field label="Issue title" required error={detailErrors.title} wide><input name="title" maxLength={160} value={details.title} onChange={event=>setDetails(current=>({...current,title:event.target.value}))} autoFocus/></Field><Field label="Description" required error={detailErrors.description} wide><textarea name="description" maxLength={2000} value={details.description} onChange={event=>setDetails(current=>({...current,description:event.target.value}))}/></Field><Field label="Priority" required wide><select value={details.priority} onChange={event=>setDetails(current=>({...current,priority:event.target.value as Priority}))}>{priorities.map(priority=><option key={priority}>{priority}</option>)}</select></Field></div><div className="issue-details-actions"><button type="button" className="secondary" onClick={cancelEditing}>Cancel</button><button className="primary" disabled={!detailsChanged}><Pencil/> Save issue</button></div></form>:<><div className="issue-badges"><span className={`issue-status ${issue.status.toLowerCase()}`}>{issue.status}</span><span className={`priority ${issue.priority.toLowerCase()}`}>{issue.priority} priority</span></div><p>{issue.description}</p><small>Reported by {issue.createdBy} · {formatDate(issue.createdAt)}</small></>}
    </div>
    {canManage&&!editingDetails&&<button className="edit-vehicle edit-vehicle-wide issue-edit-button" onClick={beginEditing}><Pencil/> Edit issue details</button>}
    <div className="detail-section"><h4>Add update</h4><form className="update-form" onSubmit={addUpdate}><label htmlFor={updateId}>Progress, repair, or inspection notes</label><textarea id={updateId} maxLength={2000} value={updateText} onChange={event=>setUpdateText(event.target.value)} placeholder="Describe work completed or next steps"/><div className="update-actions"><button className="primary" disabled={!updateText.trim()}><MessageSquare/> Add update</button><button type="button" className={issue.status==='Open'?'resolve-button':'reopen-button'} disabled={!updateText.trim()} onClick={()=>saveUpdate(issue.status==='Open'?'Resolved':'Open')}>{issue.status==='Open'?<Check/>:<CircleAlert/>}{issue.status==='Open'?'Mark as resolved':'Reopen issue'}</button></div></form></div>
    <div className="detail-section issue-history"><h4>Updates <span>{issue.updates.length}</span></h4>{issue.updates.map(update=><article key={update.id}><span><MessageSquare/></span><div><p>{update.text}</p><small>{update.createdBy} · {formatDate(update.createdAt)}</small></div></article>)}{!issue.updates.length&&<p className="no-updates">No updates yet.</p>}</div>
  </section></div>
}
function Detail({icon,label,value}:{icon:React.ReactNode;label:string;value:React.ReactNode}) {return <div><dt>{icon}<span>{label}</span></dt><dd>{value}</dd></div>}
function MobileNav({page,setPage,user,unreadCount,unreadDocumentCount,unreadTrainingCount}:{page:Page;setPage:(p:Page)=>void;user:FireOpsUser;unreadCount:number;unreadDocumentCount:number;unreadTrainingCount:number}) {
  const {mobilePrimary,mobileOverflow}=navigationLayout(user.role);
  const item=(target:Page,label:string,icon:React.ReactNode,active=page===target,badge=0)=><button key={target} className={active?'active':''} aria-current={active?'page':undefined} onClick={()=>setPage(target)}><span className="mobile-nav-icon">{icon}{badge>0&&<b aria-label={`${badge} new ${badge===1?'item':'items'}`}>{badge>99?'99+':badge}</b>}</span><span>{label}</span></button>;
  const overflowBadge=(mobileOverflow.includes('documents')?unreadDocumentCount:0)+(mobileOverflow.includes('training')?unreadTrainingCount:0);
  return <nav className="mobile-nav" aria-label="Primary">{mobilePrimary.map(target=>{const {label,Icon}=navigationMeta[target];return item(target,target==='communications'?'Comms':label,<Icon/>,page===target,target==='communications'?unreadCount:target==='documents'?unreadDocumentCount:0)})}{item('more','More',<Ellipsis/>,page==='more'||mobileOverflow.some(target=>target===page),overflowBadge)}</nav>;
}
