import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import App, { type CompanyInfo, type FireOpsUser, type FleetSnapshot, type UserRole, type VehicleFile } from './App';
import { supabase, supabaseConfigured } from './supabase';
import './auth.css';

type Membership = { company_id: string; role: UserRole };
type Profile = { full_name: string };
type FleetStateRow = { data: FleetSnapshot };
type CompanyRow = { id: string; name: string; company_code: string; industry: string };
type Access = {kind:'admin';userName:string}|{kind:'member';userName:string;companyId:string;role:UserRole};

async function refreshFileUrl(file?:VehicleFile){
  if(!supabase||!file?.path)return file;
  const {data,error}=await supabase.storage.from('fleet-files').createSignedUrl(file.path,86400);
  return error?{...file,dataUrl:''}:{...file,dataUrl:data.signedUrl};
}

const vehicleFileKeys=['photo','contract','viprChecklist','registration','insurance','dotInspection'] as const;

async function hydrateFileUrls(snapshot:FleetSnapshot){
  const next=structuredClone(snapshot);
  await Promise.all(next.vehicles.flatMap(vehicle=>vehicleFileKeys.map(async key=>{vehicle[key]=await refreshFileUrl(vehicle[key])})));
  await Promise.all(next.crew.map(async member=>{member.credential=await refreshFileUrl(member.credential)}));
  return next;
}

function stripSignedFileUrls(snapshot:FleetSnapshot){
  const next=structuredClone(snapshot);
  next.vehicles.forEach(vehicle=>vehicleFileKeys.forEach(key=>{if(vehicle[key]?.path)vehicle[key]!.dataUrl=''}));
  next.crew.forEach(member=>{if(member.credential?.path)member.credential.dataUrl=''});
  return next;
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

  if(!supabaseConfigured)return <App/>;
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
  const [resetSent,setResetSent]=useState(false);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!supabase)return;setBusy(true);setError('');const {error:signInError}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(signInError)setError(signInError.message);setBusy(false)};
  const requestReset=async(event:React.FormEvent)=>{event.preventDefault();if(!supabase)return;setBusy(true);setError('');await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:new URL('/reset-password',window.location.origin).toString()});setResetSent(true);setBusy(false)};
  if(resetMode)return <div className="admin-auth"><form onSubmit={requestReset}><img className="admin-login-logo" src="/fireops-logo.webp" width="320" height="258" alt="FireOps"/><h1>Reset your password</h1>{resetSent?<div className="admin-success" role="status">If an account exists for {email.trim()}, a password reset link is on its way. Check your inbox and spam folder.</div>:<><p>Enter your account email. We’ll send a secure password reset link.</p><input type="email" autoComplete="email" aria-label="Email" placeholder="Email" required value={email} onChange={event=>setEmail(event.target.value)}/><button disabled={busy}>{busy?'Sending...':'Send reset link'}</button></>}<button type="button" className="admin-text-action" onClick={()=>{setResetMode(false);setResetSent(false)}}>Back to sign in</button></form></div>;
  return <div className="admin-auth"><form onSubmit={submit}><img className="admin-login-logo" src="/fireops-logo.webp" width="320" height="258" alt="FireOps"/><h1>Sign in to FireOps</h1><input type="email" autoComplete="email" aria-label="Email" placeholder="Email" required value={email} onChange={event=>setEmail(event.target.value)}/><input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" required value={password} onChange={event=>setPassword(event.target.value)}/><button type="button" className="admin-text-action admin-forgot-password" onClick={()=>{setResetMode(true);setError('')}}>Forgot password?</button>{error&&<div className="admin-error" role="alert">{error}</div>}<button disabled={busy}>{busy?'Signing in...':'Sign in'}</button></form></div>;
}

function AuthenticatedFleet({session}:{session:Session}){
  const [access,setAccess]=useState<Access|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    const load=async()=>{
      const [adminResult,profileResult]=await Promise.all([
        client.rpc('is_system_admin'),
        client.from('profiles').select('full_name').eq('user_id',session.user.id).maybeSingle<Profile>()
      ]);
      if(!active)return;
      if(adminResult.error){setError('Account access could not be verified. Apply latest database migrations.');setLoaded(true);return}
      const userName=profileResult.data?.full_name||session.user.email||'FireOps user';
      if(adminResult.data===true){setAccess({kind:'admin',userName});setLoaded(true);return}
      const membershipResult=await client.from('company_members').select('company_id,role').eq('user_id',session.user.id).limit(1).maybeSingle<Membership>();
      if(!active)return;
      if(membershipResult.error||!membershipResult.data){setError('Your account is not assigned to a company. Ask your company owner for access.');setLoaded(true);return}
      setAccess({kind:'member',userName,companyId:membershipResult.data.company_id,role:membershipResult.data.role});
      setLoaded(true);
    };
    void load();
    return()=>{active=false};
  },[session.user.id,session.user.email]);

  if(!loaded)return <FleetMessage text="Checking account access..."/>;
  if(error||!access)return <FleetError text={error}/>;
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

function CompanyWorkspace({session,userName,companyId,role,isAdmin=false,onSwitchCompany}:{session:Session;userName:string;companyId:string;role:UserRole;isAdmin?:boolean;onSwitchCompany?:()=>void}){
  const [initialData,setInitialData]=useState<FleetSnapshot|undefined>();
  const [company,setCompany]=useState<CompanyInfo|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    const load=async()=>{
      const [stateResult,companyResult]=await Promise.all([
        client.from('fleet_state').select('data').eq('company_id',companyId).maybeSingle<FleetStateRow>(),
        client.from('companies').select('id,name,company_code,industry').eq('id',companyId).single<CompanyRow>()
      ]);
      if(!active)return;
      if(stateResult.error||companyResult.error){setError('Fleet data could not be loaded. Check your connection and try again.');setLoaded(true);return}
      const fallbackCrew=isAdmin?[]:[{id:session.user.id,name:userName,email:session.user.email||'',phone:'',role,status:'Active' as const}];
      const snapshot=stateResult.data?.data??{vehicles:[],issues:[],crew:fallbackCrew,activities:[]};
      const hydratedSnapshot=await hydrateFileUrls(snapshot);
      if(!active)return;
      setInitialData(hydratedSnapshot);
      setCompany({name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry});
      setLoaded(true);
    };
    void load();
    return()=>{active=false};
  },[companyId,isAdmin,role,session.user.email,session.user.id,userName]);

  const upload=useCallback(async(file:File)=>{
    if(!supabase)throw new Error('Company is unavailable');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const path=`${companyId}/${session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const {error:uploadError}=await supabase.storage.from('fleet-files').upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError)throw uploadError;
    const {data,error:urlError}=await supabase.storage.from('fleet-files').createSignedUrl(path,86400);
    if(urlError)throw urlError;
    return {name:file.name,type:file.type,dataUrl:data.signedUrl,path};
  },[companyId,session.user.id]);

  const save=useCallback(async(data:FleetSnapshot)=>{
    if(!supabase)throw new Error('Company is unavailable');
    const persistedData=stripSignedFileUrls(data);
    const {error:saveError}=await supabase.from('fleet_state').upsert({company_id:companyId,data:persistedData,updated_by:session.user.id},{onConflict:'company_id'});
    if(saveError)throw saveError;
  },[companyId,session.user.id]);

  if(!loaded)return <FleetMessage text="Loading company fleet..."/>;
  if(error||!company)return <FleetError text={error}/>;
  const user:FireOpsUser={id:session.user.id,name:userName,role};
  return <App user={user} company={company} initialData={initialData} onDataChange={save} uploadFile={upload} onSwitchCompany={onSwitchCompany} onSignOut={()=>supabase?.auth.signOut()}/>;
}

function FleetError({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{text}</p><button className="message-action" onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>}
function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><ShieldCheck/><h1>FireOps</h1><p>{text}</p></div></div>}
