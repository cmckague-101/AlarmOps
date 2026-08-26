import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import App, { type CompanyInfo, type CrewMember, type FireOpsUser, type FleetRemoteChange, type FleetSnapshot, type UserRole, type VehicleFile } from './App';
import { supabase, supabaseConfigured } from './supabase';
import './auth.css';

type Membership = { company_id: string; role: UserRole };
type Profile = { full_name: string };
type FleetRecordRow = { record_id: string; data: unknown; version: number; updated_by: string; updated_at: string };
type CompanyRow = { id: string; name: string; company_code: string; industry: string; crew_invite_limit: number };
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
  if(resetMode)return <div className="admin-auth"><form onSubmit={requestEmail}><img className="admin-login-logo" src="/fireops-logo.webp" width="320" height="258" alt="FireOps"/><h1>Reset your password</h1>{sentMethod?<div className="admin-success" role="status">If an account exists for {email.trim()}, {sentMethod==='magic'?'a secure sign-in link':'a password reset link'} is on its way. Check your inbox and spam folder.</div>:<><p>Enter your account email. Reset your password or receive a secure link to sign in without changing it.</p><input type="email" autoComplete="email" aria-label="Email" placeholder="Email" required value={email} onChange={event=>setEmail(event.target.value)}/><button type="submit" value="reset" disabled={busy}>{busy?'Sending...':'Send reset link'}</button><button type="submit" value="magic" className="admin-secondary" disabled={busy}>Email me a sign-in link</button></>}<button type="button" className="admin-text-action" onClick={()=>{setResetMode(false);setSentMethod(null)}}>Back to sign in</button></form></div>;
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

type FleetCollection=keyof FleetSnapshot;
const fleetTables:Record<FleetCollection,string>={vehicles:'fleet_vehicles',issues:'fleet_issues',crew:'fleet_crew',activities:'fleet_activities'};
const emptySnapshot=():FleetSnapshot=>({vehicles:[],issues:[],crew:[],activities:[]});

function CompanyWorkspace({session,userName,companyId,role,isAdmin=false,onSwitchCompany}:{session:Session;userName:string;companyId:string;role:UserRole;isAdmin?:boolean;onSwitchCompany?:()=>void}){
  const [initialData,setInitialData]=useState<FleetSnapshot|undefined>();
  const [remoteChanges,setRemoteChanges]=useState<(FleetRemoteChange&{sequence:number})[]>([]);
  const [company,setCompany]=useState<CompanyInfo|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');
  const persisted=useRef<FleetSnapshot>(emptySnapshot());
  const remoteSequence=useRef(0);
  const versions=useRef<Record<FleetCollection,Map<string,number>>>({vehicles:new Map(),issues:new Map(),crew:new Map(),activities:new Map()});

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
    const handleChange=async(collection:FleetCollection,payload:{eventType:string;new:Record<string,unknown>;old:Record<string,unknown>})=>{
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
    const load=async()=>{
      const collections=(Object.entries(fleetTables) as [FleetCollection,string][]);
      const [companyResult,inviteUsageResult,...recordResults]=await Promise.all([
        client.from('companies').select('id,name,company_code,industry,crew_invite_limit').eq('id',companyId).single<CompanyRow>(),
        client.rpc('company_crew_seats_used',{target_company_id:companyId}),
        ...collections.map(([,table])=>client.from(table).select('record_id,data,version,updated_by,updated_at').eq('company_id',companyId).order('updated_at',{ascending:false}))
      ]);
      if(!active)return;
      if(companyResult.error||inviteUsageResult.error||recordResults.some(result=>result.error)){setError('Fleet data could not be loaded. Apply latest database migrations, then try again.');setLoaded(true);return}
      const snapshot=emptySnapshot();
      collections.forEach(([collection],index)=>{
        const rows=(recordResults[index].data??[]) as FleetRecordRow[];
        (snapshot[collection] as unknown[]).push(...rows.map(row=>row.data));
        versions.current[collection]=new Map(rows.map(row=>[row.record_id,row.version]));
      });
      persisted.current=snapshot;
      const hydrated=await hydrateFileUrls(snapshot);
      if(!active)return;
      if(!hydrated.crew.length&&!isAdmin)hydrated.crew=[{id:session.user.id,name:userName,email:session.user.email||'',phone:'',role,status:'Active'}];
      setInitialData(hydrated);
      setCompany({name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry,crewInviteLimit:companyResult.data.crew_invite_limit,crewInvitedCount:Number(inviteUsageResult.data??0)});
      setLoaded(true);
    };
    void load();
    return()=>{active=false;void client.removeChannel(channel)};
  },[companyId,isAdmin,patchPersisted,role,session.user.email,session.user.id,userName]);

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
    const client=supabase;
    if(!client)throw new Error('Company is unavailable');
    const next=stripSignedFileUrls(data);
    const collections=(Object.entries(fleetTables) as [FleetCollection,string][]);
    const operations:Promise<void>[]=[];
    collections.forEach(([collection,table])=>{
      const before=new Map((persisted.current[collection] as {id:string}[]).map(record=>[record.id,record]));
      const after=new Map((next[collection] as {id:string}[]).map(record=>[record.id,record]));
      after.forEach((record,id)=>{
        const previous=before.get(id);
        if(previous&&JSON.stringify(previous)===JSON.stringify(record))return;
        const expectedVersion=versions.current[collection].get(id);
        operations.push((async()=>{
          if(expectedVersion===undefined){
            const {data:created,error:createError}=await client.from(table).insert({company_id:companyId,record_id:id,data:record,version:1,updated_by:session.user.id}).select('version').single<{version:number}>();
            if(createError)throw createError;
            patchPersisted(collection,'upsert',id,record,created.version);
          }else{
            const {data:updated,error:updateError}=await client.from(table).update({data:record,version:expectedVersion+1,updated_by:session.user.id}).eq('company_id',companyId).eq('record_id',id).eq('version',expectedVersion).select('version').maybeSingle<{version:number}>();
            if(updateError)throw updateError;
            if(!updated)throw new Error('Record changed by another user. Latest version has been loaded.');
            patchPersisted(collection,'upsert',id,record,updated.version);
          }
        })());
      });
      before.forEach((_record,id)=>{
        if(after.has(id))return;
        const expectedVersion=versions.current[collection].get(id);
        if(expectedVersion===undefined)return;
        operations.push((async()=>{
          const {data:deleted,error:deleteError}=await client.from(table).delete().eq('company_id',companyId).eq('record_id',id).eq('version',expectedVersion).select('record_id').maybeSingle<{record_id:string}>();
          if(deleteError)throw deleteError;
          if(!deleted)throw new Error('Record changed by another user. Latest version has been loaded.');
          patchPersisted(collection,'delete',id,undefined,expectedVersion);
        })());
      });
    });
    await Promise.all(operations);
  },[companyId,patchPersisted,session.user.id]);

  const deleteCrew=useCallback(async(member:CrewMember)=>{
    if(!supabase)throw new Error('Company is unavailable');
    const {error:deleteError}=await supabase.rpc('remove_company_member',{target_company_id:companyId,target_user_id:member.id});
    if(deleteError)throw deleteError;
  },[companyId]);

  if(!loaded)return <FleetMessage text="Loading company fleet..."/>;
  if(error||!company)return <FleetError text={error}/>;
  const user:FireOpsUser={id:session.user.id,name:userName,role};
  return <App user={user} company={company} initialData={initialData} remoteChanges={remoteChanges} onDataChange={save} onDeleteCrew={deleteCrew} uploadFile={upload} onSwitchCompany={onSwitchCompany} onSignOut={()=>supabase?.auth.signOut()}/>;
}

function FleetError({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{text}</p><button className="message-action" onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>}
function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><ShieldCheck/><h1>FireOps</h1><p>{text}</p></div></div>}
