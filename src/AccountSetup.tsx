import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import './admin.css';

let exchangeStarted = false;

export default function AccountSetup() {
  const [session,setSession] = useState<Session|null>(null);
  const [loading,setLoading] = useState(true);
  const [fullName,setFullName] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(()=>{
    const client=supabase;
    if(!client){setLoading(false);return}
    const initialize=async()=>{
      const code=new URLSearchParams(window.location.search).get('code');
      if(code&&!exchangeStarted){exchangeStarted=true;const {error:exchangeError}=await client.auth.exchangeCodeForSession(code);window.history.replaceState({},'',window.location.pathname);if(exchangeError)setError(exchangeError.message)}
      const {data}=await client.auth.getSession();setSession(data.session);setFullName(String(data.session?.user.user_metadata.full_name??''));setLoading(false)
    };
    void initialize();
    const {data:listener}=client.auth.onAuthStateChange((_event,next)=>{setSession(next);if(next)setLoading(false)});
    return()=>listener.subscription.unsubscribe();
  },[]);

  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!supabase)return;setBusy(true);setError('');const {error:updateError}=await supabase.auth.updateUser({password,data:{full_name:fullName.trim()}});if(updateError){setError(updateError.message);setBusy(false);return}window.location.assign('/')};
  if(!supabaseConfigured)return <SetupMessage text="Account setup is not configured."/>;
  if(loading)return <SetupMessage text="Verifying invitation..."/>;
  if(!session)return <SetupMessage text={error||'Invitation is invalid or expired. Ask system administrator for a new invitation.'}/>;
  return <div className="admin-auth"><form onSubmit={submit}><span className="admin-shield"><ShieldCheck/></span><h1>Set up your account</h1><p>{session.user.email}</p><label>Full name<input required value={fullName} onChange={event=>setFullName(event.target.value)}/></label><label>Password<input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<div className="admin-error">{error}</div>}<button disabled={busy}>{busy?'Saving...':'Complete setup'}</button></form></div>;
}

function SetupMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message"><ShieldCheck/><h1>Account setup</h1><p>{text}</p></div></div>}
