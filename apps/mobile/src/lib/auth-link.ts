import {parseAuthLink} from './auth-link-params';
import {supabase} from './supabase';

export async function completeAuthLink(url:string){
  if(!supabase)return {error:new Error('Supabase is not configured.')};
  const parameters=parseAuthLink(url);
  if(parameters?.type==='code')return supabase.auth.exchangeCodeForSession(parameters.code);
  if(parameters?.type==='tokens')return supabase.auth.setSession({access_token:parameters.accessToken,refresh_token:parameters.refreshToken});
  return {data:null,error:new Error('Authentication link is invalid or expired.')};
}
