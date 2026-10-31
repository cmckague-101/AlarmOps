import { ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';
import './auth.css';

export function FleetConfigurationError(){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>FireOps is not configured</h1><p>Supabase connection settings are missing. Contact FireOps support before entering fleet data.</p></div></div>}
export function FleetError({text,onRetry}:{text:string;onRetry?:()=>void}){return <div className="admin-auth"><div className="admin-message" role="alert"><ShieldCheck/><h1>Fleet unavailable</h1><p>{text}</p>{onRetry&&<button className="message-action" onClick={onRetry}>Try again</button>}<button className={onRetry?'admin-text-action':'message-action'} onClick={()=>supabase?.auth.signOut()}>Sign out</button></div></div>}
// <source media> downloads only the logo for the active theme; two <img> tags would fetch both.
export function FleetMessage({text}:{text:string}){return <div className="admin-auth"><div className="admin-message" role="status"><picture className="admin-message-brand"><source media="(prefers-color-scheme: dark)" srcSet="/fireops-wordmark-440.webp"/><img src="/fireops-wordmark-light-440.webp" width="440" height="154" alt="FireOps, powered by Fireco"/></picture><p>{text}</p></div></div>}
