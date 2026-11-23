// Load app-wide styles before component styles so the existing cascade order is kept.
import './styles.css';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import './auth.css';

let exchangeStarted = false;

export default function AccountSetup() {
  const [session,setSession] = useState<Session|null>(null);
  const [loading,setLoading] = useState(true);
  const [invitationValid,setInvitationValid] = useState(false);
  const [fullName,setFullName] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(()=>{
    const client=supabase;
    if(!client){setLoading(false);return}
    let active=true;
    const initialize=async()=>{
      const code=new URLSearchParams(window.location.search).get('code');
      if(code&&!exchangeStarted){
        exchangeStarted=true;
        const {error:exchangeError}=await client.auth.exchangeCodeForSession(code);
        window.history.replaceState({},'',window.location.pathname);
        if(exchangeError){if(active){setError('Invitation is invalid or expired. Ask the AlarmOps operator for a new invitation.');setLoading(false)}return}
      }
      const {data:sessionData}=await client.auth.getSession();
      if(!active)return;
      const nextSession=sessionData.session;
      setSession(nextSession);
      if(!nextSession){setLoading(false);return}
      const {data:pending,error:pendingError}=await client.rpc('has_pending_company_invite');
      if(!active)return;
      if(pendingError){setError('Invitation could not be verified. Apply latest database migrations and try again.')}
      else if(pending!==true)setError('Invitation is invalid or already completed.');
      else{setInvitationValid(true);setFullName(String(nextSession.user.user_metadata.full_name??''))}
      setLoading(false);
    };
    void initialize();
    return()=>{active=false};
  },[]);

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!supabase||!invitationValid)return;
    setBusy(true);setError('');
    const {data:pending,error:pendingError}=await supabase.rpc('has_pending_company_invite');
    if(pendingError||pending!==true){setInvitationValid(false);setError(pendingError?'Invitation could not be verified. Try again.':'Invitation is invalid or already completed.');setBusy(false);return}
    const {error:updateError}=await supabase.auth.updateUser({password,data:{full_name:fullName.trim()}});
    if(updateError){setError(updateError.message);setBusy(false);return}
    const {data:activated,error:completeError}=await supabase.rpc('complete_company_invite');
    if(completeError||activated!==1){setError('Account was secured, but company access could not be activated. Ask the AlarmOps operator for help.');setBusy(false);return}
    window.location.assign('/');
  };
  if(!supabaseConfigured)return <SetupMessage text="Account setup is not configured."/>;
  if(loading)return <SetupMessage text="Verifying invitation..."/>;
  if(!session||!invitationValid)return <SetupMessage text={error||'Invitation is invalid or expired. Ask the AlarmOps operator for a new invitation.'} action/>;
  return <div className="admin-auth"><form onSubmit={submit}><span className="admin-shield"><ShieldCheck/></span><h1>Set up your account</h1><p>{session.user.email}</p><label>Full name<input required maxLength={120} value={fullName} onChange={event=>setFullName(event.target.value)}/></label><label>Password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<div className="admin-error" role="alert">{error}</div>}<button disabled={busy}>{busy?'Saving...':'Complete setup'}</button></form></div>;
}

function SetupMessage({text,action=false}:{text:string;action?:boolean}){return <div className="admin-auth"><div className="admin-message" role={action?'alert':'status'}><ShieldCheck/><h1>Account setup</h1><p>{text}</p>{action&&<button className="message-action" onClick={()=>window.location.assign('/')}>Return to AlarmOps</button>}</div></div>}
