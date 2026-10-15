import 'react-native-url-polyfill/auto';
import {AppState,Platform} from 'react-native';
import {createClient} from '@supabase/supabase-js';
import {secureSessionStorage} from './secure-storage';
import {offlineAwareFetch} from '@/providers/network-provider';

const url=process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()??'';
const anonKey=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()??'';

export const supabaseConfigured=Boolean(url&&anonKey);
export const supabase=supabaseConfigured?createClient(url,anonKey,{
  auth:{
    storage:secureSessionStorage,
    autoRefreshToken:true,
    persistSession:true,
    detectSessionInUrl:false,
  },
  global:{fetch:offlineAwareFetch},
}):null;

if(supabase&&Platform.OS!=='web'){
  AppState.addEventListener('change',state=>{
    if(state==='active')supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
