import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import './auth.css';

let exchangeStarted = false;

export default function PasswordReset() {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    const client=supabase;
    if(!client){setLoading(false);return}
    const initialize=async()=>{
      const params=new URLSearchParams(window.location.search);
      const code=params.get('code');
      const linkError=new URLSearchParams(window.location.hash.slice(1)).get('error_description');
      if(linkError)setError(linkError.replace(/\+/g,' '));
      if(code&&!exchangeStarted){
        exchangeStarted=true;
        const {error:exchangeError}=await client.auth.exchangeCodeForSession(code);
        window.history.replaceState({},'',window.location.pathname);
        if(exchangeError)setError(exchangeError.message);
      }
      const {data}=await client.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };
    void initialize();
    const {data:listener}=client.auth.onAuthStateChange((_event,next)=>{setSession(next);setLoading(false)});
    return()=>listener.subscription.unsubscribe();
  },[]);

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!supabase)return;
    if(password!==confirmation){setError('Passwords do not match.');return}
    setBusy(true);setError('');
    const {error:updateError}=await supabase.auth.updateUser({password});
    if(updateError){setError(updateError.message);setBusy(false);return}
    window.location.assign('/');
  };

  if(!supabaseConfigured)return <ResetMessage text="Password reset is not configured."/>;
  if(loading)return <ResetMessage text="Verifying reset link..."/>;
  if(!session)return <ResetMessage text={error||'This password reset link is invalid or expired. Request a new link from the sign-in page.'} action/>;
  return <div className="admin-auth"><form onSubmit={submit}><span className="admin-shield"><ShieldCheck/></span><h1>Choose a new password</h1><p>{session.user.email}</p><label>New password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirm new password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>{error&&<div className="admin-error" role="alert">{error}</div>}<button disabled={busy}>{busy?'Saving...':'Update password'}</button></form></div>;
}

function ResetMessage({text,action=false}:{text:string;action?:boolean}){return <div className="admin-auth"><div className="admin-message" role="status"><ShieldCheck/><h1>Password reset</h1><p>{text}</p>{action&&<button className="message-action" onClick={()=>window.location.assign('/')}>Return to sign in</button>}</div></div>}
