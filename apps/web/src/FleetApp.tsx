import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {crewCredentials} from '@fireops/domain';
import { ArrowDown, BellRing, Boxes, Building2, Check, Download, Gauge, GraduationCap, LogOut, Mail, MapPinned, MessageSquareText, ReceiptText, ShieldCheck, Smartphone, Truck } from 'lucide-react';
import App, { type AnnualQualificationRecord, type CommunicationReply, type CommunicationThread, type CompanyDocument, type CompanyInfo, type CrewCredential, type CrewExperience, type CrewMember, type FireOpsUser, type FleetRemoteChange, type FleetSnapshot, type MotiveConnection, type UserRole, type VehicleFile, type VehicleTypeOption } from './App';
import type { Training, TrainingSignup } from './TrainingPage';
import type { InventoryItem } from './InventoryPage';
import { supabase, supabaseConfigured } from './supabase';
import './auth.css';

type Membership = { company_id: string; role: UserRole };
type Profile = { full_name: string };
type FleetRecordRow = { record_id: string; data: unknown; version: number; updated_by: string; updated_at: string };
type CommunicationThreadRow = {id:string;subject:string;description:string;created_by:string|null;created_by_name:string;created_by_role:UserRole;created_at:string};
type CommunicationReplyRow = {id:string;thread_id:string;body:string;created_by:string|null;created_by_name:string;created_at:string};
type CommunicationReadRow = {thread_id:string;seen_at:string};
type CompanyDocumentRow = {id:string;name:string;file_name:string;mime_type:string;storage_path:string;created_at:string;updated_at:string};
type DocumentReadRow = {document_id:string;viewed_at:string};
type TrainingRow = {id:string;course_code:string;course_title:string;starts_at:string;location:string;instructor:string;capacity:number;course_information:string;created_at:string;updated_at:string};
type TrainingSignupRow = {training_id:string;user_id:string;user_name:string;signed_up_at:string};
type TrainingReadRow = {training_id:string;viewed_at:string};
type InventoryItemRow = {id:string;name:string;quantity:number;created_at:string;updated_at:string};
type InventoryCheckoutRow = {item_id:string;user_id:string;user_name:string;quantity:number;checked_out_at:string;updated_at:string};
type VehicleTypeRow = {id:string;name:string};
type CompanyRow = { id: string; name: string; company_code: string; industry: string; crew_invite_limit: number };
type Access = {kind:'admin';userName:string}|{kind:'member';userName:string;companyId:string;role:UserRole};
type FleetChange = {collection:keyof FleetSnapshot;event:'insert'|'update'|'delete';recordId:string;data?:unknown;expectedVersion?:number};
type FleetChangeResult = {collection:keyof FleetSnapshot;event:'insert'|'update'|'delete';recordId:string;version:number};
type AccessCheckError = {code?:string;message?:string}|null;

const accessRetryDelays=[0,350,900];

export function accountAccessErrorMessage(adminError:AccessCheckError,membershipError:AccessCheckError){
  const missingMigration=[adminError,membershipError].some(error=>error?.code==='PGRST202'||error?.code==='42883');
  return missingMigration
    ? 'Account access check is unavailable. Apply latest database migrations.'
    : 'Account access could not be verified. Check your connection and try again.';
}

async function refreshFileUrl(file?:VehicleFile){
  if(!supabase||!file?.path)return file;
  const {data,error}=await supabase.storage.from('fleet-files').createSignedUrl(file.path,86400);
  return error?{...file,dataUrl:''}:{...file,dataUrl:data.signedUrl};
}

const vehicleFileKeys=['photo','contract','viprChecklist','registration','insurance','dotInspection'] as const;

async function hydrateFileUrls(snapshot:FleetSnapshot){
  const next=structuredClone(snapshot);
  await Promise.all(next.vehicles.flatMap(vehicle=>[
    ...vehicleFileKeys.map(async key=>{vehicle[key]=await refreshFileUrl(vehicle[key])}),
    ...(vehicle.documents??[]).map(async document=>{document.file=(await refreshFileUrl(document.file))!}),
    ...(vehicle.inspections??[]).flatMap(inspection=>inspection.items.map(async item=>{if(item.photo)item.photo=(await refreshFileUrl(item.photo))!}))
  ]));
  await Promise.all(next.crew.map(async member=>{
    member.credential=await refreshFileUrl(member.credential);
    if(member.credentials)member.credentials=await Promise.all(member.credentials.map(async credential=>credential.file?{...credential,file:(await refreshFileUrl(credential.file))!}:credential));
    if(member.experiences)member.experiences=await Promise.all(member.experiences.map(async experience=>experience.file?{...experience,file:(await refreshFileUrl(experience.file))!}:experience));
  }));
  return next;
}

export function stripSignedFileUrls(snapshot:FleetSnapshot){
  const next=structuredClone(snapshot);
  next.vehicles.forEach(vehicle=>{
    vehicleFileKeys.forEach(key=>{if(vehicle[key]?.path)vehicle[key]!.dataUrl=''});
    vehicle.documents?.forEach(document=>{if(document.file.path)document.file.dataUrl=''});
    vehicle.inspections?.forEach(inspection=>inspection.items.forEach(item=>{if(item.photo?.path)item.photo.dataUrl=''}));
  });
  next.crew.forEach(member=>{
    if(member.credential?.path)member.credential.dataUrl='';
    member.credentials?.forEach(credential=>{if(credential.file?.path)credential.file.dataUrl=''});
    member.experiences?.forEach(experience=>{if(experience.file?.path)experience.file.dataUrl=''});
  });
  return next;
}

function canonicalJsonValue(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonicalJsonValue);
  if(value&&typeof value==='object')return Object.fromEntries(
    Object.entries(value as Record<string,unknown>)
      .filter(([,entry])=>entry!==undefined)
      .sort(([left],[right])=>left.localeCompare(right))
      .map(([key,entry])=>[key,canonicalJsonValue(entry)])
  );
  return value;
}

export function fleetRecordsEqual(left:unknown,right:unknown){
  return JSON.stringify(canonicalJsonValue(left))===JSON.stringify(canonicalJsonValue(right));
}

export function snapshotFilePaths(snapshot:FleetSnapshot){
  const paths=new Set<string>();
  snapshot.vehicles.forEach(vehicle=>{
    vehicleFileKeys.forEach(key=>{const path=vehicle[key]?.path;if(path)paths.add(path)});
    vehicle.documents?.forEach(document=>{if(document.file.path)paths.add(document.file.path)});
    vehicle.inspections?.forEach(inspection=>inspection.items.forEach(item=>{if(item.photo?.path)paths.add(item.photo.path)}));
  });
  snapshot.crew.forEach(member=>{
    if(member.credential?.path)paths.add(member.credential.path);
    member.credentials?.forEach(credential=>{if(credential.file?.path)paths.add(credential.file.path)});
    member.experiences?.forEach(experience=>{if(experience.file?.path)paths.add(experience.file.path)});
  });
  return paths;
}

export default function FleetApp() {
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);

  useEffect(()=>{
    if(!supabase){setChecking(false);return}
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setChecking(false)});
    const {data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setChecking(false)});
    return()=>listener.subscription.unsubscribe();
  },[]);

  const loginPreview=import.meta.env.DEV&&typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('login-preview')==='1';
  if(loginPreview)return <FleetLogin/>;
  if(!supabaseConfigured)return import.meta.env.VITE_DEMO_MODE==='true'
    ? <App/>
    : <FleetConfigurationError/>;
  if(checking)return <FleetMessage text="Checking your session..."/>;
  if(!session)return <FleetLogin/>;
  return <AuthenticatedFleet session={session}/>;
}

function FleetLogin(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [resetMode,setResetMode]=useState(false);
  const [sentMethod,setSentMethod]=useState<'reset'|'magic'|null>(null);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!supabase)return;setBusy(true);setError('');const {error:signInError}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(signInError)setError(signInError.message);setBusy(false)};
  const requestEmail=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!supabase)return;
    const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const method=submitter?.value==='magic'?'magic':'reset';
    setBusy(true);setError('');
    if(method==='magic'){
      await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:new URL('/',window.location.origin).toString()}});
    }else{
      await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:new URL('/reset-password',window.location.origin).toString()});
    }
    setSentMethod(method);setBusy(false);
  };
  if(resetMode)return <div className="admin-auth"><form onSubmit={requestEmail}><h1>Reset your password</h1>{sentMethod?<div className="admin-success" role="status">If an account exists for {email.trim()}, {sentMethod==='magic'?'a secure sign-in link':'a password reset link'} is on its way. Check your inbox and spam folder.</div>:<><p>Enter your account email. Reset your password or receive a secure link to sign in without changing it.</p><input type="email" autoComplete="email" aria-label="Email" placeholder="Email" required value={email} onChange={event=>setEmail(event.target.value)}/><button type="submit" value="reset" disabled={busy}>{busy?'Sending...':'Send reset link'}</button><button type="submit" value="magic" className="admin-secondary" disabled={busy}>Email me a sign-in link</button></>}<button type="button" className="admin-text-action" onClick={()=>{setResetMode(false);setSentMethod(null)}}>Back to sign in</button></form></div>;
  return <div className="admin-auth admin-login-page">
    <main>
      <section className="login-hero" aria-labelledby="login-title">
        <div className="login-logo-wrap"><img className="login-hero-logo" src="/fireops-wordmark.png" width="2117" height="743" alt="FireOps"/></div>
        <div className="login-intro">
          <p className="login-eyebrow">Wildland operations, connected</p>
          <h1 id="login-title">Keep your crew ready. Keep operations moving.</h1>
          <p className="login-lede">FireOps brings people, equipment, training, and field intelligence into one clear operational picture.</p>
          <a className="login-discover" href="#features">See what FireOps covers <ArrowDown aria-hidden="true"/></a>
        </div>

        <form className="login-form" onSubmit={submit} aria-labelledby="login-form-title" aria-busy={busy}>
          <div className="login-form-heading">
            <span>Secure workspace</span>
            <h2 id="login-form-title">Welcome back</h2>
            <p>Sign in to your FireOps account.</p>
          </div>
          <div className="login-field">
            <label htmlFor="login-email">Work email</label>
            <input id="login-email" type="email" autoComplete="email" placeholder="name@company.com" required value={email} onChange={event=>setEmail(event.target.value)}/>
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={event=>setPassword(event.target.value)}/>
            <button type="button" className="admin-text-action admin-forgot-password" onClick={()=>{setResetMode(true);setError('')}}>Forgot password?</button>
          </div>
          {error&&<div className="admin-error" role="alert">{error}</div>}
          <button className="login-submit" disabled={busy}>{busy?'Signing in...':'Sign in to FireOps'}</button>
          <p className="login-access-note"><ShieldCheck aria-hidden="true"/> Authorized personnel only</p>
        </form>
      </section>

      <section className="login-features" id="features" aria-labelledby="features-title">
        <div className="login-section-heading">
          <p className="login-section-kicker">Inside FireOps</p>
          <h2 id="features-title">One view of your whole operation.</h2>
          <p>Fleet status, incidents, crew updates, and field records stay in one company workspace.</p>
        </div>
        <div className="login-feature-list">
          <article className="login-feature-card login-feature-card--dashboard">
            <div className="login-feature-copy"><span><Gauge aria-hidden="true"/> Dashboard</span><h3>Readiness at a glance</h3><p>See fleet blockers and recent company activity as soon as you sign in.</p></div>
            <figure><img src="/landing/dashboard.webp" width="1305" height="1205" loading="lazy" decoding="async" alt="FireOps dashboard showing fleet readiness, issues, and recent actions"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--operations">
            <div className="login-feature-copy"><span><MapPinned aria-hidden="true"/> Operations</span><h3>Active fires on one map</h3><p>Review NIFC incidents by location, then connect crews and vehicles to assignments.</p></div>
            <figure><img src="/landing/operations.webp" width="1600" height="996" loading="lazy" decoding="async" alt="FireOps operations map showing active wildfire incidents across the United States"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--fleet">
            <div className="login-feature-copy"><span><Truck aria-hidden="true"/> Fleet</span><h3>Know what can roll</h3><p>Track unit status, assignments, issues, photos, and records from one fleet list.</p></div>
            <figure><img src="/landing/fleet.webp" width="874" height="1183" loading="lazy" decoding="async" alt="FireOps fleet screen showing ready vehicles and current issues"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--training">
            <div className="login-feature-copy"><span><GraduationCap aria-hidden="true"/> Training</span><h3>Keep qualifications moving</h3><p>Publish courses, monitor capacity, and manage crew registration.</p></div>
            <figure><img src="/landing/training.webp" width="1448" height="1086" loading="lazy" decoding="async" alt="FireOps training screen showing scheduled courses and registration counts"/></figure>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy"><span><Boxes aria-hidden="true"/> Inventory</span><h3>Count field supplies</h3><p>Update equipment quantities as stock moves in or out.</p></div>
            <figure><img src="/landing/inventory.webp" width="1522" height="1033" loading="lazy" decoding="async" alt="FireOps inventory screen showing equipment and supply counts"/></figure>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy"><span><MessageSquareText aria-hidden="true"/> Communications</span><h3>Keep updates with your crew</h3><p>Post company threads and keep replies tied to each operational update.</p></div>
            <figure><img src="/landing/communications.webp" width="1387" height="1134" loading="lazy" decoding="async" alt="FireOps communications screen showing company threads and crew replies"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--receipts">
            <div className="login-feature-copy"><span><ReceiptText aria-hidden="true"/> Receipts</span><h3>Review field expenses</h3><p>Crew can upload receipts while owners filter, review, and maintain expense records.</p></div>
            <figure><img src="/landing/receipts.webp" width="1540" height="1021" loading="lazy" decoding="async" alt="FireOps receipts screen showing uploaded crew expenses"/></figure>
          </article>
        </div>
      </section>

      <section className="login-mobile" aria-labelledby="mobile-title">
        <div className="login-mobile-copy">
          <p className="login-mobile-kicker"><Smartphone aria-hidden="true"/> FireOps mobile</p>
          <h2 id="mobile-title">Your operation goes with you.</h2>
          <p>FireOps is available for iPhone and iPad. Sign in with your existing account to work from the same live company records used on the web.</p>
          <ul>
            <li><Check aria-hidden="true"/> Check fleet status and report issues</li>
            <li><Check aria-hidden="true"/> Review assigned resources and active fires</li>
            <li><Check aria-hidden="true"/> Open company documents and training</li>
            <li><BellRing aria-hidden="true"/> Get notified when your crew has an update</li>
          </ul>
          <a href="https://apps.apple.com/app/id6808795667" target="_blank" rel="noreferrer" aria-label="Download FireOps Fleet on the App Store"><Download aria-hidden="true"/><span><small>Available on the</small>App Store</span></a>
        </div>
        <div className="login-mobile-device" aria-hidden="true">
          <div className="login-mobile-phone">
            <div className="login-mobile-speaker"/>
            <div className="login-mobile-screen">
              <div className="login-mobile-appbar"><img src="/fireops-icon.png" alt=""/><span>FireOps</span><i>3</i></div>
              <p>Good morning</p>
              <h3>Ready for assignment</h3>
              <div className="login-mobile-stats"><span><b>6</b>Vehicles</span><span><b>1</b>Open issue</span></div>
              <div className="login-mobile-card"><span><Truck/></span><div><b>Engine 702</b><small>Ready · Assigned to you</small></div><i/></div>
              <div className="login-mobile-card"><span><MapPinned/></span><div><b>Operations</b><small>2 assigned incidents</small></div><i/></div>
              <div className="login-mobile-tabs"><span><Boxes/>Home</span><span><MapPinned/>Operations</span><span className="active"><Truck/>Fleet</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="login-mission">
        <h2>Less time managing systems. More time supporting crews.</h2>
        <p>FireOps keeps core workflows together, giving leaders confidence in the details and crews confidence that information will be there when needed.</p>
      </section>

      <section className="login-contact" aria-labelledby="contact-title">
        <h2 id="contact-title">Want to learn how FireOps can support your operation?</h2>
        <a href="mailto:thetinykings@icloud.com"><Mail aria-hidden="true"/> Contact us</a>
      </section>
    </main>

    <footer className="login-footer"><span>© {new Date().getFullYear()} FireOps</span><span>Built for teams who answer the call.</span></footer>
  </div>;
}

function AuthenticatedFleet({session}:{session:Session}){
  const [access,setAccess]=useState<Access|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');
  const [loadAttempt,setLoadAttempt]=useState(0);

  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    const load=async()=>{
      for(const delay of accessRetryDelays){
        if(delay)await new Promise(resolve=>window.setTimeout(resolve,delay));
        if(!active)return;
        const [adminResult,profileResult,membershipResult]=await Promise.all([
          client.rpc('is_system_admin'),
          client.from('profiles').select('full_name').eq('user_id',session.user.id).maybeSingle<Profile>(),
          client.from('company_members').select('company_id,role').eq('user_id',session.user.id).limit(1).maybeSingle<Membership>()
        ]);
        if(!active)return;
        const userName=profileResult.data?.full_name||session.user.email||'FireOps user';
        if(adminResult.data===true){setAccess({kind:'admin',userName});setLoaded(true);return}
        if(membershipResult.data){setAccess({kind:'member',userName,companyId:membershipResult.data.company_id,role:membershipResult.data.role});setLoaded(true);return}
        if(!adminResult.error&&!membershipResult.error){
          setError('Your account is not assigned to a company. Ask your company owner for access.');setLoaded(true);return;
        }
        const missingMigration=[adminResult.error,membershipResult.error].some(resultError=>resultError?.code==='PGRST202'||resultError?.code==='42883');
        if(missingMigration||delay===accessRetryDelays[accessRetryDelays.length-1]){
          if(adminResult.error)console.error('System admin access check failed:',adminResult.error);
          if(membershipResult.error)console.error('Company membership check failed:',membershipResult.error);
          setError(accountAccessErrorMessage(adminResult.error,membershipResult.error));setLoaded(true);return;
        }
      }
    };
    void load();
    return()=>{active=false};
  },[session.user.id,session.user.email,loadAttempt]);

  const retry=()=>{setAccess(null);setError('');setLoaded(false);setLoadAttempt(attempt=>attempt+1)};

  if(!loaded)return <FleetMessage text="Checking account access..."/>;
  if(error||!access)return <FleetError text={error} onRetry={retry}/>;
  if(access.kind==='admin')return <AdminCompanyAccess session={session} userName={access.userName}/>;
  return <CompanyWorkspace session={session} userName={access.userName} companyId={access.companyId} role={access.role}/>;
}

function AdminCompanyAccess({session,userName}:{session:Session;userName:string}){
  const [companies,setCompanies]=useState<CompanyRow[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      if(!supabase)return;
      const {data,error:companyError}=await supabase.from('companies').select('id,name,company_code,industry').order('name');
      if(!active)return;
      if(companyError)setError('Companies could not be loaded. Check database migration and connection.');
      else setCompanies((data??[]) as CompanyRow[]);
      setLoading(false);
    };
    void load();
    return()=>{active=false};
  },[]);

  const openCompany=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!supabase||!selectedId)return;
    setBusy(true);setError('');
    const {error:accessError}=await supabase.rpc('admin_access_company',{target_company_id:selectedId});
    if(accessError)setError(accessError.message);
    else setSelectedId(current=>`open:${current}`);
    setBusy(false);
  };

  if(selectedId.startsWith('open:')){
    const companyId=selectedId.slice(5);
    return <CompanyWorkspace session={session} userName={userName} companyId={companyId} role="owner" isAdmin onSwitchCompany={()=>setSelectedId('')}/>;
  }
  if(loading)return <FleetMessage text="Loading companies..."/>;
  return <div className="admin-auth admin-company-access"><form onSubmit={openCompany}><span className="admin-access-icon"><ShieldCheck/></span><h1>Administrator access</h1><p>Choose company to troubleshoot with company owner permissions. Access is recorded.</p><label>Company<select required value={selectedId} onChange={event=>setSelectedId(event.target.value)}><option value="">Select company</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name} · {company.company_code}</option>)}</select></label>{!companies.length&&!error&&<div className="admin-empty">No companies found.</div>}{error&&<div className="admin-error" role="alert">{error}</div>}<button disabled={busy||!selectedId}><Building2/>{busy?'Opening...':'Access company'}</button><button type="button" className="admin-secondary" onClick={()=>supabase?.auth.signOut()}><LogOut/>Sign out</button></form></div>;
}

type FleetCollection=keyof FleetSnapshot;
const fleetTables:Record<FleetCollection,string>={vehicles:'fleet_vehicles',issues:'fleet_issues',crew:'fleet_crew',activities:'fleet_activities'};
const emptySnapshot=():FleetSnapshot=>({vehicles:[],issues:[],crew:[],activities:[]});

function CompanyWorkspace({session,userName,companyId,role,isAdmin=false,onSwitchCompany}:{session:Session;userName:string;companyId:string;role:UserRole;isAdmin?:boolean;onSwitchCompany?:()=>void}){
  const [initialData,setInitialData]=useState<FleetSnapshot|undefined>();
  const [remoteChanges,setRemoteChanges]=useState<(FleetRemoteChange&{sequence:number})[]>([]);
  const [company,setCompany]=useState<CompanyInfo|null>(null);
  const [motiveConnection,setMotiveConnection]=useState<MotiveConnection>({connected:false});
  const [communicationThreads,setCommunicationThreads]=useState<CommunicationThread[]>([]);
  const [communicationError,setCommunicationError]=useState('');
  const [companyDocuments,setCompanyDocuments]=useState<CompanyDocument[]>([]);
  const [documentError,setDocumentError]=useState('');
  const [trainings,setTrainings]=useState<Training[]>([]);
  const [trainingError,setTrainingError]=useState('');
  const [inventoryItems,setInventoryItems]=useState<InventoryItem[]>([]);
  const [inventoryError,setInventoryError]=useState('');
  const [vehicleTypes,setVehicleTypes]=useState<VehicleTypeOption[]>([]);
  const [vehicleTypeError,setVehicleTypeError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');
  const persisted=useRef<FleetSnapshot>(emptySnapshot());
  const pendingUploads=useRef(new Set<string>());
  const committedUploads=useRef(new Set<string>());
  const cleanupQueue=useRef(new Set<string>());
  const remoteSequence=useRef(0);
  const versions=useRef<Record<FleetCollection,Map<string,number>>>({vehicles:new Map(),issues:new Map(),crew:new Map(),activities:new Map()});

  const loadCommunications=useCallback(async()=>{
    const client=supabase;
    if(!client)return;
    const [threadResult,replyResult,readResult]=await Promise.all([
      client.from('communication_threads').select('id,subject,description,created_by,created_by_name,created_by_role,created_at').eq('company_id',companyId).order('created_at',{ascending:false}),
      client.from('communication_replies').select('id,thread_id,body,created_by,created_by_name,created_at').eq('company_id',companyId).order('created_at',{ascending:true}),
      client.from('communication_reads').select('thread_id,seen_at').eq('company_id',companyId).eq('user_id',session.user.id)
    ]);
    if(threadResult.error||replyResult.error||readResult.error){setCommunicationError('Communications could not be loaded. Apply latest database migration, then try again.');return}
    const replies=(replyResult.data??[]) as CommunicationReplyRow[];
    const reads=new Map(((readResult.data??[]) as CommunicationReadRow[]).map(read=>[read.thread_id,read.seen_at]));
    setCommunicationThreads(((threadResult.data??[]) as CommunicationThreadRow[]).map(thread=>({
      id:thread.id,subject:thread.subject,description:thread.description,createdBy:thread.created_by_name,createdById:thread.created_by??'',createdByRole:thread.created_by_role,createdAt:thread.created_at,seenAt:reads.get(thread.id),
      replies:replies.filter(reply=>reply.thread_id===thread.id).map(reply=>({id:reply.id,body:reply.body,createdBy:reply.created_by_name,createdById:reply.created_by??'',createdAt:reply.created_at}))
    })));
    setCommunicationError('');
  },[companyId,session.user.id]);

  const loadDocuments=useCallback(async()=>{
    const client=supabase;if(!client)return;
    const [documentResult,readResult]=await Promise.all([
      client.from('company_documents').select('id,name,file_name,mime_type,storage_path,created_at,updated_at').eq('company_id',companyId).order('updated_at',{ascending:false}),
      client.from('company_document_reads').select('document_id,viewed_at').eq('company_id',companyId).eq('user_id',session.user.id)
    ]);
    if(documentResult.error||readResult.error){setDocumentError('Documents could not be loaded. Apply latest database migration, then try again.');return}
    const reads=new Map(((readResult.data??[]) as DocumentReadRow[]).map(read=>[read.document_id,read.viewed_at]));
    const documents=await Promise.all(((documentResult.data??[]) as CompanyDocumentRow[]).map(async row=>{
      const file=await refreshFileUrl({name:row.file_name,type:row.mime_type,dataUrl:'',path:row.storage_path});
      return {id:row.id,name:row.name,file:file!,createdAt:row.created_at,updatedAt:row.updated_at,viewedAt:reads.get(row.id)};
    }));
    setCompanyDocuments(documents);setDocumentError('');
  },[companyId,session.user.id]);

  const loadTrainings=useCallback(async()=>{
    const client=supabase;if(!client)return;
    const [trainingResult,signupResult,readResult]=await Promise.all([
      client.from('company_trainings').select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at').eq('company_id',companyId).order('starts_at',{ascending:true}),
      client.from('company_training_signups').select('training_id,user_id,user_name,signed_up_at').eq('company_id',companyId),
      client.from('company_training_reads').select('training_id,viewed_at').eq('company_id',companyId).eq('user_id',session.user.id)
    ]);
    if(trainingResult.error||signupResult.error||readResult.error){setTrainingError('Training could not be loaded. Apply latest database migration, then try again.');return}
    const signups=(signupResult.data??[]) as TrainingSignupRow[];
    const reads=new Map(((readResult.data??[]) as TrainingReadRow[]).map(read=>[read.training_id,read.viewed_at]));
    setTrainings(((trainingResult.data??[]) as TrainingRow[]).map(row=>({id:row.id,courseCode:row.course_code,courseTitle:row.course_title,date:row.starts_at,location:row.location,instructor:row.instructor,capacity:row.capacity,information:row.course_information,createdAt:row.created_at,updatedAt:row.updated_at,viewedAt:reads.get(row.id),signups:signups.filter(signup=>signup.training_id===row.id).map(signup=>({userId:signup.user_id,userName:signup.user_name,signedUpAt:signup.signed_up_at}))})));
    setTrainingError('');
  },[companyId,session.user.id]);

  const loadInventory=useCallback(async()=>{
    const client=supabase;if(!client)return;
    const [itemResult,checkoutResult]=await Promise.all([
      client.from('company_inventory_items').select('id,name,quantity,created_at,updated_at').eq('company_id',companyId).order('name'),
      client.from('company_inventory_checkouts').select('item_id,user_id,user_name,quantity,checked_out_at,updated_at').eq('company_id',companyId)
    ]);
    if(itemResult.error||checkoutResult.error){setInventoryError('Inventory could not be loaded. Apply latest database migration, then try again.');return}
    const checkouts=(checkoutResult.data??[]) as InventoryCheckoutRow[];
    setInventoryItems(((itemResult.data??[]) as InventoryItemRow[]).map(row=>({id:row.id,name:row.name,quantity:row.quantity,createdAt:row.created_at,updatedAt:row.updated_at,checkouts:checkouts.filter(checkout=>checkout.item_id===row.id).map(checkout=>({userId:checkout.user_id,userName:checkout.user_name,quantity:checkout.quantity,checkedOutAt:checkout.checked_out_at,updatedAt:checkout.updated_at}))})));setInventoryError('');
  },[companyId]);

  const loadVehicleTypes=useCallback(async()=>{
    const client=supabase;if(!client)return;
    const {data,error:loadError}=await client.from('company_vehicle_types').select('id,name').eq('company_id',companyId).order('name');
    if(loadError){setVehicleTypeError('Vehicle types could not be loaded. Apply latest database migration, then try again.');return}
    setVehicleTypes((data??[]) as VehicleTypeRow[]);setVehicleTypeError('');
  },[companyId]);

  const patchPersisted=useCallback((collection:FleetCollection,event:'upsert'|'delete',id:string,record?:unknown,version?:number)=>{
    const currentVersion=versions.current[collection].get(id)??0;
    if(version!==undefined&&version<currentVersion)return false;
    if(event==='delete')versions.current[collection].delete(id);else if(version!==undefined)versions.current[collection].set(id,version);
    const list=persisted.current[collection] as {id:string}[];
    const next=event==='delete'?list.filter(item=>item.id!==id):[record as {id:string},...list.filter(item=>item.id!==id)];
    persisted.current={...persisted.current,[collection]:next};
    return true;
  },[]);

  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    let fleetEventSequence=0;
    const handleChange=async(collection:FleetCollection,payload:{eventType:string;new:Record<string,unknown>;old:Record<string,unknown>})=>{
      fleetEventSequence+=1;
      const row=(payload.eventType==='DELETE'?payload.old:payload.new) as unknown as Partial<FleetRecordRow>;
      const id=row.record_id;
      if(!id)return;
      if(payload.eventType==='DELETE'){
        if(!patchPersisted(collection,'delete',id,undefined,row.version))return;
        if(active){const change={collection,event:'delete',id,sequence:++remoteSequence.current} as FleetRemoteChange&{sequence:number};setRemoteChanges(changes=>[...changes.slice(-99),change])}
        return;
      }
      if(!row.data||row.version===undefined)return;
      if(!patchPersisted(collection,'upsert',id,row.data,row.version)||row.updated_by===session.user.id)return;
      const shell=emptySnapshot();
      (shell[collection] as unknown[]).push(row.data);
      const hydrated=await hydrateFileUrls(shell);
      if(!active||versions.current[collection].get(id)!==row.version)return;
      const record=(hydrated[collection] as {id:string}[])[0];
      const change={collection,event:'upsert',record,sequence:++remoteSequence.current} as FleetRemoteChange&{sequence:number};
      setRemoteChanges(changes=>[...changes.slice(-99),change]);
    };
    let channel=client.channel(`fleet-records:${companyId}`);
    (Object.entries(fleetTables) as [FleetCollection,string][]).forEach(([collection,table])=>{
      channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},payload=>void handleChange(collection,payload as never));
    });
    channel.subscribe();
    let communicationChannel=client.channel(`communications:${companyId}`);
    ['communication_threads','communication_replies','communication_reads'].forEach(table=>{
      communicationChannel=communicationChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},()=>void loadCommunications());
    });
    communicationChannel.subscribe();
    let documentChannel=client.channel(`company-documents:${companyId}`);
    ['company_documents','company_document_reads'].forEach(table=>{
      documentChannel=documentChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},()=>void loadDocuments());
    });
    documentChannel.subscribe();
    let trainingChannel=client.channel(`company-training:${companyId}`);
    ['company_trainings','company_training_signups','company_training_reads'].forEach(table=>{
      trainingChannel=trainingChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},()=>void loadTrainings());
    });
    trainingChannel.subscribe();
    let inventoryChannel=client.channel(`company-inventory:${companyId}`);
    ['company_inventory_items','company_inventory_checkouts'].forEach(table=>{inventoryChannel=inventoryChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},()=>void loadInventory())});
    inventoryChannel.subscribe();
    const vehicleTypeChannel=client.channel(`company-vehicle-types:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'company_vehicle_types',filter:`company_id=eq.${companyId}`},()=>void loadVehicleTypes());
    vehicleTypeChannel.subscribe();
    const load=async()=>{
      const fleetSequenceAtStart=fleetEventSequence;
      const collections=(Object.entries(fleetTables) as [FleetCollection,string][]);
      const [companyResult,inviteUsageResult,motiveResult,...recordResults]=await Promise.all([
        client.from('companies').select('id,name,company_code,industry,crew_invite_limit').eq('id',companyId).single<CompanyRow>(),
        client.rpc('company_crew_seats_used',{target_company_id:companyId}),
        role==='owner'||isAdmin?client.functions.invoke<MotiveConnection>('motive-integration',{body:{companyId,action:'status'}}):Promise.resolve({data:{connected:false},error:null}),
        ...collections.map(([,table])=>client.from(table).select('record_id,data,version,updated_by,updated_at').eq('company_id',companyId).order('updated_at',{ascending:false}))
      ]);
      if(!active)return;
      if(companyResult.error||inviteUsageResult.error||recordResults.some(result=>result.error)){setError('Fleet data could not be loaded. Apply latest database migrations, then try again.');setLoaded(true);return}
      // Re-query when Realtime delivered a row while this snapshot was loading.
      // Otherwise an older SELECT response can replace its newer version token.
      if(fleetSequenceAtStart!==fleetEventSequence){void load();return}
      const snapshot=emptySnapshot();
      collections.forEach(([collection],index)=>{
        const rows=(recordResults[index].data??[]) as FleetRecordRow[];
        (snapshot[collection] as unknown[]).push(...rows.map(row=>row.data));
        versions.current[collection]=new Map(rows.map(row=>[row.record_id,row.version]));
      });
      if(!snapshot.crew.length&&!isAdmin)snapshot.crew=[{id:session.user.id,name:userName,email:session.user.email||'',phone:'',role,status:'Active'}];
      persisted.current=snapshot;
      const hydrated=await hydrateFileUrls(snapshot);
      if(!active)return;
      if(fleetSequenceAtStart!==fleetEventSequence){void load();return}
      setInitialData(hydrated);
      setCompany({name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry,crewInviteLimit:companyResult.data.crew_invite_limit,crewInvitedCount:Number(inviteUsageResult.data??0)});
      if(!motiveResult.error&&motiveResult.data)setMotiveConnection(motiveResult.data);
      setLoaded(true);
    };
    void load();
    void loadCommunications();
    void loadDocuments();
    void loadTrainings();
    void loadInventory();
    void loadVehicleTypes();
    return()=>{active=false;void client.removeChannel(channel);void client.removeChannel(communicationChannel);void client.removeChannel(documentChannel);void client.removeChannel(trainingChannel);void client.removeChannel(inventoryChannel);void client.removeChannel(vehicleTypeChannel)};
  },[companyId,isAdmin,loadCommunications,loadDocuments,loadInventory,loadTrainings,loadVehicleTypes,patchPersisted,role,session.user.email,session.user.id,userName]);

  const upload=useCallback(async(file:File)=>{
    if(!supabase)throw new Error('Company is unavailable');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const path=`${companyId}/${session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const {error:uploadError}=await supabase.storage.from('fleet-files').upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError)throw uploadError;
    const {data,error:urlError}=await supabase.storage.from('fleet-files').createSignedUrl(path,86400);
    if(urlError){await supabase.storage.from('fleet-files').remove([path]);throw urlError}
    pendingUploads.current.add(path);
    return {name:file.name,type:file.type,dataUrl:data.signedUrl,path};
  },[companyId,session.user.id]);

  const deleteFiles=useCallback(async(paths:string[])=>{
    if(!supabase||!paths.length)return;
    const {error:deleteError}=await supabase.functions.invoke('delete-fleet-files',{body:{companyId,paths}});
    if(deleteError)throw deleteError;
    paths.forEach(path=>{pendingUploads.current.delete(path);committedUploads.current.delete(path);cleanupQueue.current.delete(path)});
  },[companyId]);

  const commitFiles=useCallback((files:VehicleFile[])=>{
    files.forEach(file=>{if(file.path&&pendingUploads.current.delete(file.path))committedUploads.current.add(file.path)});
  },[]);

  const discardFiles=useCallback(async()=>{
    const paths=[...pendingUploads.current];
    paths.forEach(path=>cleanupQueue.current.add(path));
    try{await deleteFiles(paths)}catch{/* Retry queued cleanup on next save. */}
  },[deleteFiles]);

  const save=useCallback(async(data:FleetSnapshot)=>{
    const client=supabase;
    if(!client)throw new Error('Company is unavailable');
    const beforeSnapshot=persisted.current;
    const beforePaths=snapshotFilePaths(beforeSnapshot);
    const next=stripSignedFileUrls(data);
    const nextPaths=snapshotFilePaths(next);
    const collections=(Object.keys(fleetTables) as FleetCollection[]);
    const changes:FleetChange[]=[];
    const records=new Map<string,{collection:FleetCollection;record:{id:string}}>();

    collections.forEach(collection=>{
      const before=new Map((beforeSnapshot[collection] as {id:string}[]).map(record=>[record.id,record]));
      const after=new Map((next[collection] as {id:string}[]).map(record=>[record.id,record]));
      after.forEach((record,id)=>{
        const previous=before.get(id);
        if(previous&&fleetRecordsEqual(previous,record))return;
        const expectedVersion=versions.current[collection].get(id);
        changes.push({collection,event:expectedVersion===undefined?'insert':'update',recordId:id,data:record,...(expectedVersion===undefined?{}:{expectedVersion})});
        records.set(`${collection}:${id}`,{collection,record});
      });
      before.forEach((_record,id)=>{
        if(after.has(id))return;
        const expectedVersion=versions.current[collection].get(id);
        if(expectedVersion!==undefined)changes.push({collection,event:'delete',recordId:id,expectedVersion});
      });
    });

    let results:FleetChangeResult[]=[];
    if(changes.length){
      const {data:changed,error:changeError}=await client.rpc('apply_fleet_changes',{target_company_id:companyId,changes});
      if(changeError)throw new Error(changeError.code==='40001'||changeError.code==='PT409'?'Record changed elsewhere. Latest changes are syncing; retry once they appear.':changeError.message);
      results=(changed??[]) as FleetChangeResult[];
      results.forEach(result=>{
        const saved=records.get(`${result.collection}:${result.recordId}`);
        patchPersisted(result.collection,result.event==='delete'?'delete':'upsert',result.recordId,saved?.record,result.version);
      });
    }

    beforePaths.forEach(path=>{if(!nextPaths.has(path))cleanupQueue.current.add(path)});
    pendingUploads.current.forEach(path=>{if(!nextPaths.has(path))cleanupQueue.current.add(path)});
    nextPaths.forEach(path=>{pendingUploads.current.delete(path);committedUploads.current.delete(path)});
    const cleanup=[...cleanupQueue.current];
    if(cleanup.length)await deleteFiles(cleanup);
  },[companyId,deleteFiles,patchPersisted]);

  const inviteCrew=useCallback(async(member:CrewMember)=>{
    if(!supabase)throw new Error('Company is unavailable.');
    const {data,error:inviteError}=await supabase.functions.invoke<{member:CrewMember;version:number}>('invite-company-member',{body:{companyId,email:member.email,name:member.name,phone:member.phone}});
    if(inviteError){
      const context=(inviteError as {context?:Response}).context;
      const body=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;
      throw new Error(body?.error||'Invitation could not be sent. Check your connection and try again.');
    }
    if(!data?.member||!data.version)throw new Error('Invitation service returned an invalid response.');
    patchPersisted('crew','upsert',data.member.id,data.member,data.version);
    return data.member;
  },[companyId,patchPersisted]);

  const saveMotive=useCallback(async(apiKey:string)=>{
    if(!supabase)throw new Error('Company is unavailable.');
    const {data,error:saveError}=await supabase.functions.invoke<MotiveConnection>('motive-integration',{body:{companyId,action:'save',apiKey}});
    if(saveError){const context=(saveError as {context?:Response}).context;const body=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;throw new Error(body?.error||'Motive API key could not be saved.');}
    if(!data?.connected)throw new Error('Motive connection returned an invalid response.');
    setMotiveConnection(data);return data;
  },[companyId]);

  const disconnectMotive=useCallback(async()=>{
    if(!supabase)throw new Error('Company is unavailable.');
    const {data,error:disconnectError}=await supabase.functions.invoke<MotiveConnection>('motive-integration',{body:{companyId,action:'disconnect'}});
    if(disconnectError){const context=(disconnectError as {context?:Response}).context;const body=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;throw new Error(body?.error||'Motive connection could not be removed.');}
    const next=data??{connected:false};setMotiveConnection(next);return next;
  },[companyId]);

  const createCommunicationThread=useCallback(async(subject:string,description:string)=>{
    const client=supabase;
    if(!client)throw new Error('Company is unavailable.');
    const {data,error:createError}=await client.from('communication_threads').insert({company_id:companyId,subject,description}).select('id,subject,description,created_by,created_by_name,created_by_role,created_at').single<CommunicationThreadRow>();
    if(createError)throw new Error(createError.message);
    const thread:CommunicationThread={id:data.id,subject:data.subject,description:data.description,createdBy:data.created_by_name,createdById:data.created_by??'',createdByRole:data.created_by_role,createdAt:data.created_at,seenAt:data.created_at,replies:[]};
    setCommunicationThreads(items=>[thread,...items.filter(item=>item.id!==thread.id)]);
    return thread;
  },[companyId]);

  const replyToCommunicationThread=useCallback(async(threadId:string,body:string)=>{
    const client=supabase;
    if(!client)throw new Error('Company is unavailable.');
    const {data,error:replyError}=await client.from('communication_replies').insert({company_id:companyId,thread_id:threadId,body}).select('id,thread_id,body,created_by,created_by_name,created_at').single<CommunicationReplyRow>();
    if(replyError)throw new Error(replyError.message);
    const reply:CommunicationReply={id:data.id,body:data.body,createdBy:data.created_by_name,createdById:data.created_by??'',createdAt:data.created_at};
    setCommunicationThreads(items=>items.map(thread=>thread.id===threadId?{...thread,replies:[...thread.replies.filter(item=>item.id!==reply.id),reply],seenAt:reply.createdAt}:thread));
    return reply;
  },[companyId]);

  const markCommunicationThreadSeen=useCallback(async(threadId:string)=>{
    const client=supabase;
    if(!client)throw new Error('Company is unavailable.');
    const seenAt=new Date().toISOString();
    const {data,error:seenError}=await client.from('communication_reads').upsert({company_id:companyId,thread_id:threadId,user_id:session.user.id,seen_at:seenAt},{onConflict:'company_id,thread_id,user_id'}).select('seen_at').single<{seen_at:string}>();
    if(seenError)throw new Error(seenError.message);
    const savedAt=data.seen_at;
    setCommunicationThreads(items=>items.map(thread=>thread.id===threadId?{...thread,seenAt:savedAt}:thread));
    return savedAt;
  },[companyId,session.user.id]);

  const createDocument=useCallback(async(name:string,file:VehicleFile)=>{
    const client=supabase;if(!client||!file.path)throw new Error('Company is unavailable.');
    const {data,error:createError}=await client.from('company_documents').insert({company_id:companyId,name,file_name:file.name,mime_type:file.type||'application/octet-stream',storage_path:file.path}).select('id,name,file_name,mime_type,storage_path,created_at,updated_at').single<CompanyDocumentRow>();
    if(createError)throw new Error(createError.message);
    const document:CompanyDocument={id:data.id,name:data.name,file,createdAt:data.created_at,updatedAt:data.updated_at};
    setCompanyDocuments(items=>[document,...items.filter(item=>item.id!==document.id)]);return document;
  },[companyId]);

  const updateDocument=useCallback(async(document:CompanyDocument,name:string,file?:VehicleFile)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const values=file?.path?{name,file_name:file.name,mime_type:file.type||'application/octet-stream',storage_path:file.path}:{name};
    const {data,error:updateError}=await client.from('company_documents').update(values).eq('company_id',companyId).eq('id',document.id).select('id,name,file_name,mime_type,storage_path,created_at,updated_at').single<CompanyDocumentRow>();
    if(updateError)throw new Error(updateError.message);
    const next:CompanyDocument={id:data.id,name:data.name,file:file??document.file,createdAt:data.created_at,updatedAt:data.updated_at,viewedAt:document.viewedAt};
    setCompanyDocuments(items=>[next,...items.filter(item=>item.id!==next.id)]);
    if(file?.path&&document.file.path&&file.path!==document.file.path){try{await deleteFiles([document.file.path])}catch{cleanupQueue.current.add(document.file.path)}}
    return next;
  },[companyId,deleteFiles]);

  const deleteDocument=useCallback(async(document:CompanyDocument)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:deleteError}=await client.from('company_documents').delete().eq('company_id',companyId).eq('id',document.id);
    if(deleteError)throw new Error(deleteError.message);
    if(document.file.path){try{await deleteFiles([document.file.path])}catch{cleanupQueue.current.add(document.file.path)}}
    setCompanyDocuments(items=>items.filter(item=>item.id!==document.id));
  },[companyId,deleteFiles]);

  const markDocumentViewed=useCallback(async(documentId:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');const viewedAt=new Date().toISOString();
    const {data,error:viewError}=await client.from('company_document_reads').upsert({company_id:companyId,document_id:documentId,user_id:session.user.id,viewed_at:viewedAt},{onConflict:'company_id,document_id,user_id'}).select('viewed_at').single<{viewed_at:string}>();
    if(viewError)throw new Error(viewError.message);
    setCompanyDocuments(items=>items.map(document=>document.id===documentId?{...document,viewedAt:data.viewed_at}:document));return data.viewed_at;
  },[companyId,session.user.id]);

  const createTraining=useCallback(async(values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:createError}=await client.from('company_trainings').insert({company_id:companyId,course_code:values.courseCode,course_title:values.courseTitle,starts_at:values.date,location:values.location,instructor:values.instructor,capacity:values.capacity,course_information:values.information}).select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at').single<TrainingRow>();
    if(createError)throw new Error(createError.message);
    const training:Training={id:data.id,courseCode:data.course_code,courseTitle:data.course_title,date:data.starts_at,location:data.location,instructor:data.instructor,capacity:data.capacity,information:data.course_information,createdAt:data.created_at,updatedAt:data.updated_at,signups:[]};
    setTrainings(items=>[training,...items.filter(item=>item.id!==training.id)]);return training;
  },[companyId]);

  const updateTraining=useCallback(async(trainingId:string,values:Omit<Training,'id'|'createdAt'|'updatedAt'|'viewedAt'|'signups'>)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:updateError}=await client.from('company_trainings').update({course_code:values.courseCode,course_title:values.courseTitle,starts_at:values.date,location:values.location,instructor:values.instructor,capacity:values.capacity,course_information:values.information}).eq('company_id',companyId).eq('id',trainingId).select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at').single<TrainingRow>();
    if(updateError)throw new Error(updateError.message);
    const training:Training={id:data.id,courseCode:data.course_code,courseTitle:data.course_title,date:data.starts_at,location:data.location,instructor:data.instructor,capacity:data.capacity,information:data.course_information,createdAt:data.created_at,updatedAt:data.updated_at,signups:trainings.find(item=>item.id===data.id)?.signups??[]};
    setTrainings(items=>[training,...items.filter(item=>item.id!==training.id)]);return training;
  },[companyId,trainings]);

  const deleteTraining=useCallback(async(trainingId:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:deleteError}=await client.from('company_trainings').delete().eq('company_id',companyId).eq('id',trainingId);
    if(deleteError)throw new Error(deleteError.message);
    setTrainings(items=>items.filter(item=>item.id!==trainingId));
  },[companyId]);

  const signupTraining=useCallback(async(trainingId:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:signupError}=await client.from('company_training_signups').insert({company_id:companyId,training_id:trainingId,user_id:session.user.id,user_name:userName}).select('training_id,user_id,user_name,signed_up_at').single<TrainingSignupRow>();
    if(signupError)throw new Error(signupError.message.includes('full')?'Course is full.':signupError.message);
    const signup:TrainingSignup={userId:data.user_id,userName:data.user_name,signedUpAt:data.signed_up_at};
    setTrainings(items=>items.map(training=>training.id===trainingId?{...training,signups:[...training.signups.filter(item=>item.userId!==signup.userId),signup]}:training));return signup;
  },[companyId,session.user.id,userName]);

  const cancelTrainingSignup=useCallback(async(trainingId:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:cancelError}=await client.from('company_training_signups').delete().eq('company_id',companyId).eq('training_id',trainingId).eq('user_id',session.user.id);
    if(cancelError)throw new Error(cancelError.message);
    setTrainings(items=>items.map(training=>training.id===trainingId?{...training,signups:training.signups.filter(signup=>signup.userId!==session.user.id)}:training));
  },[companyId,session.user.id]);

  const markTrainingViewed=useCallback(async(trainingId:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');const viewedAt=new Date().toISOString();
    const {data,error:viewError}=await client.from('company_training_reads').upsert({company_id:companyId,training_id:trainingId,user_id:session.user.id,viewed_at:viewedAt},{onConflict:'company_id,training_id,user_id'}).select('viewed_at').single<{viewed_at:string}>();
    if(viewError)throw new Error(viewError.message);
    setTrainings(items=>items.map(training=>training.id===trainingId?{...training,viewedAt:data.viewed_at}:training));return data.viewed_at;
  },[companyId,session.user.id]);

  const createInventoryItem=useCallback(async(name:string,quantity:number)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:createError}=await client.from('company_inventory_items').insert({company_id:companyId,name,quantity}).select('id,name,quantity,created_at,updated_at').single<InventoryItemRow>();
    if(createError)throw new Error(createError.code==='23505'?'Item name already exists in inventory.':createError.message);
    const item:InventoryItem={id:data.id,name:data.name,quantity:data.quantity,createdAt:data.created_at,updatedAt:data.updated_at,checkouts:[]};setInventoryItems(items=>[item,...items.filter(entry=>entry.id!==item.id)]);return item;
  },[companyId]);

  const updateInventoryItem=useCallback(async(item:InventoryItem,quantity:number)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:updateError}=await client.from('company_inventory_items').update({quantity}).eq('company_id',companyId).eq('id',item.id).select('id,name,quantity,created_at,updated_at').single<InventoryItemRow>();
    if(updateError)throw new Error(updateError.message);
    const updated:InventoryItem={id:data.id,name:data.name,quantity:data.quantity,createdAt:data.created_at,updatedAt:data.updated_at,checkouts:item.checkouts};setInventoryItems(items=>items.map(entry=>entry.id===updated.id?updated:entry));return updated;
  },[companyId]);

  const deleteInventoryItem=useCallback(async(item:InventoryItem)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:deleteError}=await client.from('company_inventory_items').delete().eq('company_id',companyId).eq('id',item.id);
    if(deleteError)throw new Error(deleteError.message);setInventoryItems(items=>items.filter(entry=>entry.id!==item.id));
  },[companyId]);

  const checkoutInventoryItem=useCallback(async(item:InventoryItem,quantity:number)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:checkoutError}=await client.rpc('checkout_inventory_item',{target_item_id:item.id,checkout_quantity:quantity});
    if(checkoutError)throw new Error(checkoutError.message);
    await loadInventory();
  },[loadInventory]);

  const checkinInventoryItem=useCallback(async(item:InventoryItem,userId:string,quantity:number)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:checkinError}=await client.rpc('checkin_inventory_item',{target_item_id:item.id,borrower_user_id:userId,checkin_quantity:quantity});
    if(checkinError)throw new Error(checkinError.message);
    await loadInventory();
  },[loadInventory]);

  const createVehicleType=useCallback(async(name:string)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {data,error:createError}=await client.from('company_vehicle_types').insert({company_id:companyId,name:name.trim()}).select('id,name').single<VehicleTypeRow>();
    if(createError)throw new Error(createError.code==='23505'?'Vehicle type already exists.':createError.message);
    const type:VehicleTypeOption={id:data.id,name:data.name};setVehicleTypes(items=>[...items.filter(item=>item.id!==type.id),type].sort((left,right)=>left.name.localeCompare(right.name)));return type;
  },[companyId]);

  const deleteVehicleType=useCallback(async(type:VehicleTypeOption)=>{
    const client=supabase;if(!client)throw new Error('Company is unavailable.');
    const {error:deleteError}=await client.from('company_vehicle_types').delete().eq('company_id',companyId).eq('id',type.id);
    if(deleteError)throw new Error(deleteError.code==='23503'?'Vehicle type is used by an existing vehicle.':deleteError.message);
    setVehicleTypes(items=>items.filter(item=>item.id!==type.id));
  },[companyId]);

  const createCredential=useCallback(async(credential:CrewCredential)=>{
    const client=supabase;if(!client)throw new Error('Qualifications are unavailable.');
    const persistedCredential=credential.file?{...credential,file:{...credential.file,dataUrl:''}}:credential;
    const {data,error:createError}=await client.rpc('add_my_crew_credential',{target_company_id:companyId,credential:persistedCredential});
    if(createError)throw new Error(createError.message);
    const member=data as CrewMember;
    return {...member,credentials:crewCredentials(member).map(item=>item.id===credential.id?credential:item)};
  },[companyId]);

  const updateCredential=useCallback(async(credential:CrewCredential)=>{
    const client=supabase;if(!client)throw new Error('Qualifications are unavailable.');
    const persistedCredential=credential.file?{...credential,file:{...credential.file,dataUrl:''}}:credential;
    const {data,error:updateError}=await client.rpc('update_my_crew_credential',{target_company_id:companyId,credential:persistedCredential});
    if(updateError)throw new Error(updateError.message);
    const member=data as CrewMember;
    return {...member,credentials:crewCredentials(member).map(item=>item.id===credential.id?credential:item)};
  },[companyId]);

  const createExperience=useCallback(async(experience:CrewExperience)=>{
    const client=supabase;if(!client)throw new Error('Qualifications are unavailable.');
    const persistedExperience=experience.file?{...experience,file:{...experience.file,dataUrl:''}}:experience;
    const {data,error:createError}=await client.rpc('add_my_crew_experience',{target_company_id:companyId,experience:persistedExperience});
    if(createError)throw new Error(createError.message);
    const member=data as CrewMember;
    return {...member,experiences:(member.experiences??[]).map(item=>item.id===experience.id?experience:item)};
  },[companyId]);

  const updateExperience=useCallback(async(experience:CrewExperience)=>{
    const client=supabase;if(!client)throw new Error('Qualifications are unavailable.');
    const persistedExperience=experience.file?{...experience,file:{...experience.file,dataUrl:''}}:experience;
    const {data,error:updateError}=await client.rpc('update_my_crew_experience',{target_company_id:companyId,experience:persistedExperience});
    if(updateError)throw new Error(updateError.message);
    const member=data as CrewMember;
    return {...member,experiences:(member.experiences??[]).map(item=>item.id===experience.id?experience:item)};
  },[companyId]);

  const updateAnnualRecord=useCallback(async(annualRecord:AnnualQualificationRecord)=>{
    const client=supabase;if(!client)throw new Error('Qualifications are unavailable.');
    const {data,error:updateError}=await client.rpc('update_my_annual_qualification_record',{target_company_id:companyId,annual_record:annualRecord});
    if(updateError)throw new Error(updateError.message);
    return data as CrewMember;
  },[companyId]);

  const deleteCrew=useCallback(async(member:CrewMember)=>{
    if(!supabase)throw new Error('Company is unavailable.');
    const {data,error:deleteError}=await supabase.functions.invoke<{removed:boolean;accountDeleted:boolean;accountCleanupFailed:boolean;crewDeleted:boolean;attributionChanges:{collection:FleetCollection;record:{id:string};version:number}[]}>('remove-company-member',{body:{companyId,userId:member.id}});
    if(deleteError){
      const context=(deleteError as {context?:Response}).context;
      const body=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;
      throw new Error(body?.error||'Crew member could not be removed. Check your connection and try again.');
    }
    if(!data?.removed)throw new Error('Crew removal service returned an invalid response.');
    for(const change of data.attributionChanges??[]){
      if(change.record?.id)patchPersisted(change.collection,'upsert',change.record.id,change.record,change.version);
    }
    if(data.crewDeleted)patchPersisted('crew','delete',member.id);
    return {accountDeleted:data.accountDeleted,accountCleanupFailed:data.accountCleanupFailed};
  },[companyId,patchPersisted]);

  if(!loaded)return <FleetMessage text="Loading company fleet..."/>;
  if(error||!company)return <FleetError text={error}/>;
  const user:FireOpsUser={id:session.user.id,name:userName,role};
  return <App user={user} company={company} companyId={companyId} initialData={initialData} remoteChanges={remoteChanges} motiveConnection={motiveConnection} communicationThreads={communicationThreads} communicationError={communicationError} companyDocuments={companyDocuments} documentError={documentError} trainings={trainings} trainingError={trainingError} inventoryItems={inventoryItems} inventoryError={inventoryError} vehicleTypeOptions={vehicleTypes} vehicleTypeError={vehicleTypeError} onDataChange={save} onInviteCrew={inviteCrew} onDeleteCrew={deleteCrew} onSaveMotive={saveMotive} onDisconnectMotive={disconnectMotive} onCreateThread={createCommunicationThread} onReplyToThread={replyToCommunicationThread} onMarkThreadSeen={markCommunicationThreadSeen} onCreateDocument={createDocument} onUpdateDocument={updateDocument} onDeleteDocument={deleteDocument} onMarkDocumentViewed={markDocumentViewed} onCreateTraining={createTraining} onUpdateTraining={updateTraining} onDeleteTraining={deleteTraining} onSignupTraining={signupTraining} onCancelTrainingSignup={cancelTrainingSignup} onMarkTrainingViewed={markTrainingViewed} onCreateInventoryItem={createInventoryItem} onUpdateInventoryItem={updateInventoryItem} onDeleteInventoryItem={deleteInventoryItem} onCheckoutInventoryItem={checkoutInventoryItem} onCheckinInventoryItem={checkinInventoryItem} onCreateVehicleType={createVehicleType} onDeleteVehicleType={deleteVehicleType} onCreateCredential={createCredential} onUpdateCredential={updateCredential} onCreateExperience={createExperience} onUpdateExperience={updateExperience} onUpdateAnnualRecord={updateAnnualRecord} uploadFile={upload} onCommitFiles={commitFiles} onDiscardFiles={discardFiles} onSwitchCompany={onSwitchCompany} onSignOut={()=>supabase?.auth.signOut()}/>;
}

function FleetConfigurationError(){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>FireOps is not configured</h1><p>Supabase connection settings are missing. Contact FireOps support before entering fleet data.</p></div></div>}
function FleetError({text,onRetry}:{text:string;onRetry?:()=>void}){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{text}</p>{onRetry&&<button className="message-action" onClick={onRetry}>Try again</button>}<button className={onRetry?'admin-text-action':'message-action'} onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>}
function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><picture className="admin-message-brand"><img className="theme-logo-light" src="/fireops-wordmark-light.png" width="2117" height="743" alt="FireOps, powered by Fireco"/><img className="theme-logo-dark" src="/fireops-wordmark.png" width="2117" height="743" alt="FireOps, powered by Fireco"/></picture><p>{text}</p></div></div>}
