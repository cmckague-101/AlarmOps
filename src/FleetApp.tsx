import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import App, { type CompanyInfo, type FireOpsUser, type FleetSnapshot, type VehicleFile } from './App';
import { supabase, supabaseConfigured } from './supabase';
import './admin.css';

type Membership = { company_id: string; role: 'owner' | 'member' };
type Profile = { full_name: string };
type FleetStateRow = { data: FleetSnapshot };
type CompanyRow = { name: string; company_code: string; industry: string };

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
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!supabase)return;setBusy(true);setError('');const {error:signInError}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(signInError)setError(signInError.message);setBusy(false)};
  return <div className="admin-auth"><form onSubmit={submit}><span className="admin-shield"><ShieldCheck/></span><h1>Sign in to FireOps</h1><p>Use your company account to access fleet operations.</p><label>Email<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<div className="admin-error" role="alert">{error}</div>}<button disabled={busy}>{busy?'Signing in...':'Sign in'}</button></form></div>;
}

function AuthenticatedFleet({session}:{session:Session}){
  const [user,setUser]=useState<FireOpsUser|null>(null);
  const [companyId,setCompanyId]=useState('');
  const [initialData,setInitialData]=useState<FleetSnapshot|undefined>();
  const [company,setCompany]=useState<CompanyInfo|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    const load=async()=>{
      const [membershipResult,profileResult]=await Promise.all([
        client.from('company_members').select('company_id,role').eq('user_id',session.user.id).limit(1).maybeSingle<Membership>(),
        client.from('profiles').select('full_name').eq('user_id',session.user.id).maybeSingle<Profile>()
      ]);
      if(!active)return;
      if(membershipResult.error||!membershipResult.data){setError('Your account is not assigned to a company. Ask your company owner for access.');setLoaded(true);return}
      const membership=membershipResult.data;
      const [stateResult,companyResult]=await Promise.all([
        client.from('fleet_state').select('data').eq('company_id',membership.company_id).maybeSingle<FleetStateRow>(),
        client.from('companies').select('name,company_code,industry').eq('id',membership.company_id).single<CompanyRow>()
      ]);
      if(!active)return;
      if(stateResult.error||companyResult.error){setError('Fleet data could not be loaded. Check your connection and try again.');setLoaded(true);return}
      const userName=profileResult.data?.full_name||session.user.email||'FireOps user';
      setCompanyId(membership.company_id);
      setUser({id:session.user.id,name:userName,role:membership.role});
      const snapshot=stateResult.data?.data??{vehicles:[],issues:[],crew:[{id:session.user.id,name:userName,email:session.user.email||'',phone:'',role:membership.role,status:'Active' as const}],activities:[]};
      setInitialData(await hydrateFileUrls(snapshot));
      setCompany({name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry});
      setLoaded(true);
    };
    void load();
    return()=>{active=false};
  },[session.user.id,session.user.email]);

  const upload=useCallback(async(file:File)=>{
    if(!supabase||!companyId)throw new Error('Company is unavailable');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
    const path=`${companyId}/${session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const {error:uploadError}=await supabase.storage.from('fleet-files').upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError)throw uploadError;
    const {data,error:urlError}=await supabase.storage.from('fleet-files').createSignedUrl(path,86400);
    if(urlError)throw urlError;
    return {name:file.name,type:file.type,dataUrl:data.signedUrl,path};
  },[companyId,session.user.id]);

  const save=useCallback(async(data:FleetSnapshot)=>{
    if(!supabase||!companyId)throw new Error('Company is unavailable');
    const persistedData=stripSignedFileUrls(data);
    const {error:saveError}=await supabase.from('fleet_state').upsert({company_id:companyId,data:persistedData,updated_by:session.user.id},{onConflict:'company_id'});
    if(saveError)throw saveError;
  },[companyId,session.user.id]);

  if(!loaded)return <FleetMessage text="Loading company fleet..."/>;
  if(error||!user||!company)return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{error}</p><button className="message-action" onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>;
  return <App user={user} company={company} initialData={initialData} onDataChange={save} uploadFile={upload} onSignOut={()=>supabase?.auth.signOut()}/>;
}

function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><ShieldCheck/><h1>FireOps</h1><p>{text}</p></div></div>}
