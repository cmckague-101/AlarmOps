import { Suspense, lazy, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import FleetLogin from './FleetLanding';
import { FleetConfigurationError, FleetMessage } from './FleetStatus';
import { supabase, supabaseConfigured } from './supabase';

// The landing page stays light: the workspace and demo app load only when needed.
const App = lazy(() => import('./App'));
const AuthenticatedFleet = lazy(() => import('./FleetApp').then(module => ({ default: module.AuthenticatedFleet })));

export function demoRequested(search:string){
  return new URLSearchParams(search).get('demo')==='1';
}

// Signed-out visitors have no stored Supabase token and no auth callback in the URL,
// so the landing page can render immediately instead of flashing a session check.
export function mayHaveSession(storage:Pick<Storage,'length'|'key'>|null,location:Pick<Location,'search'|'hash'>){
  if(/(^|[?&#])(code|access_token|refresh_token|error_description)=/.test(location.search+location.hash))return true;
  if(!storage)return true;
  try{
    for(let index=0;index<storage.length;index++){if(/^sb-.+-auth-token/.test(storage.key(index)??''))return true}
    return false;
  }catch{return true}
}

function storedSessionLikely(){
  if(typeof window==='undefined')return true;
  let storage:Storage|null=null;
  try{storage=window.localStorage}catch{storage=null}
  return mayHaveSession(storage,window.location);
}

export default function FleetRoot() {
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(storedSessionLikely);
  const [demoMode,setDemoMode]=useState(()=>typeof window!=='undefined'&&demoRequested(window.location.search));

  useEffect(()=>{
    if(!supabase){setChecking(false);return}
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setChecking(false)});
    const {data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setChecking(false)});
    return()=>listener.subscription.unsubscribe();
  },[]);

  const loginPreview=import.meta.env.DEV&&typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('login-preview')==='1';
  const enterDemo=()=>setDemoMode(true);
  const exitDemo=()=>{
    const url=new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState(null,'',url);
    setDemoMode(false);
  };
  const loading=<FleetMessage text="Loading FireOps..."/>;
  if(demoMode)return <Suspense fallback={loading}><App demoMode onSignOut={exitDemo}/></Suspense>;
  if(loginPreview||new URLSearchParams(window.location.search).get('info')==='1')return <FleetLogin onDemo={enterDemo}/>;
  if(!supabaseConfigured)return import.meta.env.VITE_DEMO_MODE==='true'
    ? <Suspense fallback={loading}><App demoMode/></Suspense>
    : <FleetConfigurationError/>;
  if(checking)return <FleetMessage text="Checking your session..."/>;
  if(!session)return <FleetLogin onDemo={enterDemo}/>;
  return <Suspense fallback={loading}><AuthenticatedFleet session={session}/></Suspense>;
}
