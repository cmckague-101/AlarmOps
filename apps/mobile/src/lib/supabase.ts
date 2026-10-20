import 'react-native-url-polyfill/auto';
import {AppState,Platform} from 'react-native';
import {createClient} from '@supabase/supabase-js';
import {secureSessionStorage} from './secure-storage';
import {offlineAwareFetch} from '@/providers/network-provider';
import {createDemoClient} from './demo-client';

const url=process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()??'';
const anonKey=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()??'';

export const supabaseConfigured=Boolean(url&&anonKey);
const liveSupabase=supabaseConfigured?createClient(url,anonKey,{
  auth:{
    storage:secureSessionStorage,
    autoRefreshToken:true,
    persistSession:true,
    detectSessionInUrl:false,
  },
  global:{fetch:async(input,init)=>{
    const request=input instanceof Request?input:null;
    const requestUrl=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    const body=typeof init?.body==='string'?init.body:request?await request.clone().text():'';
    // A native operation can outlive its screen. Never send a late demo write
    // through the restored production client after Exit demo.
    if(demoBackend||/demo-company-|demo-owner/.test(`${requestUrl}\n${body}`))throw new Error('Demo requests cannot access production services.');
    return offlineAwareFetch(input,init);
  }},
}):null;

export let supabase=liveSupabase;
let demoBackend:ReturnType<typeof createDemoClient>|null=null;
export function isDemoActive(){return demoBackend!==null}

export function startDemoClient(companyId:string){
  demoBackend?.dispose();
  demoBackend=createDemoClient(companyId);
  supabase=demoBackend.client;
}
export function stopDemoClient(){
  demoBackend?.dispose();
  demoBackend=null;
  supabase=liveSupabase;
}

if(liveSupabase&&Platform.OS!=='web'){
  AppState.addEventListener('change',state=>{
    if(state==='active')liveSupabase.auth.startAutoRefresh();
    else liveSupabase.auth.stopAutoRefresh();
  });
}
