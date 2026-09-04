import {supabase} from './supabase';

export async function completeAuthLink(url:string){
  if(!supabase)return {error:new Error('Supabase is not configured.')};
  const normalized=url.replace('#','?');
  const params=new URL(normalized).searchParams;
  const code=params.get('code');
  if(code)return supabase.auth.exchangeCodeForSession(code);
  const accessToken=params.get('access_token');
  const refreshToken=params.get('refresh_token');
  if(accessToken&&refreshToken)return supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
  return {data:null,error:new Error('Authentication link is invalid or expired.')};
}
