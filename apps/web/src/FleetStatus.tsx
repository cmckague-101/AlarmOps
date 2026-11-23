import { ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';
import './auth.css';

export function FleetConfigurationError(){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>AlarmOps is not configured</h1><p>Supabase connection settings are missing. Contact AlarmOps support before entering fleet data.</p></div></div>}
export function FleetError({text,onRetry}:{text:string;onRetry?:()=>void}){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{text}</p>{onRetry&&<button className="message-action" onClick={onRetry}>Try again</button>}<button className={onRetry?'admin-text-action':'message-action'} onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>}
// Both theme logos render; base.css hides the one that doesn't match data-theme.
export function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><span className="admin-message-brand"><img className="theme-logo-light" src="/alarmops-wordmark-light-440.webp" width="440" height="147" alt="AlarmOps"/><img className="theme-logo-dark" src="/alarmops-wordmark-440.webp" width="440" height="147" alt="AlarmOps"/></span><p>{text}</p></div></div>}
