import {createContext,useCallback,useContext,useEffect,useMemo,useState,type PropsWithChildren} from 'react';
import type {Session} from '@supabase/supabase-js';
import type {FireOpsUser,UserRole} from '@fireops/domain';
import {supabase,supabaseConfigured,startDemoClient,stopDemoClient} from '@/lib/supabase';
import {demoCompany,demoUser} from '@/lib/demo-backend';
import {unregisterFromPushNotifications} from '@/lib/notifications';
import {loadAccountAccess,setOfflineCacheUser,storeAccountAccess} from '@/lib/offline-cache';
import {checkIsOffline,isOffline} from './network-provider';

export type CompanyAccess={
  kind:'member';
  user:FireOpsUser;
  company:{id:string;name:string;code:string;industry:string;phone:string;location:string;logoPath:string|null;crewInviteLimit:number};
  isAdmin?:boolean;
};
type AdminAccess={kind:'admin';userName:string};
export type AdminCompany={id:string;name:string;code:string;industry:string;phone:string;location:string;logoPath:string|null;crewInviteLimit:number};
export type AccountAccess=CompanyAccess|AdminAccess;
type AccessState={status:'idle'|'loading'|'ready'|'error';value:null|AccountAccess;error:string};

type SessionContextValue={
  configured:boolean;loading:boolean;session:Session|null;access:AccessState;
  demoMode:boolean;startDemo:()=>void;
  retryAccess:()=>void;signOut:()=>Promise<void>;
  selectCompany:(company:AdminCompany)=>Promise<void>;clearCompany:()=>void;
  updateCompanyProfile:(profile:{name:string;phone:string;location:string;logoPath:string|null})=>Promise<void>;
};

const SessionContext=createContext<SessionContextValue|null>(null);

export function SessionProvider({children}:PropsWithChildren){
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(supabaseConfigured);
  const [access,setAccess]=useState<AccessState>({status:'idle',value:null,error:''});
  const [attempt,setAttempt]=useState(0);
  const [demoAccess,setDemoAccess]=useState<CompanyAccess|null>(null);
  useEffect(()=>()=>stopDemoClient(),[]);
  const startDemo=useCallback(()=>{
    if(session||loading||demoAccess)return;
    const company={...demoCompany,id:`demo-company-${Date.now()}`};
    startDemoClient(company.id);
    setDemoAccess({kind:'member',user:{...demoUser},company});
  },[session,loading,demoAccess]);

  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    void supabase.auth.getSession()
      .then(({data,error})=>{
        if(!active)return;
        if(error)console.error('Session restoration failed',error);
        setOfflineCacheUser(data.session?.user.id??null);
        setSession(data.session);
        setLoading(false);
      })
      .catch(error=>{
        if(!active)return;
        console.error('Session restoration failed',error);
        setSession(null);
        setLoading(false);
      });
    const {data}=supabase.auth.onAuthStateChange((_event,nextSession)=>{setOfflineCacheUser(nextSession?.user.id??null);setSession(nextSession);setLoading(false);if(!nextSession)setAccess({status:'idle',value:null,error:''})});
    return()=>{active=false;data.subscription.unsubscribe()};
  },[]);

  const sessionUserId=session?.user.id??null;
  const sessionUserEmail=session?.user.email??null;
  useEffect(()=>{
    if(!supabase||!sessionUserId)return;
    let active=true;
    void (async()=>{
      await Promise.resolve();
      if(!active)return;
      setAccess({status:'loading',value:null,error:''});
      const cached=await loadAccountAccess<AccountAccess>(sessionUserId);
      if(!active)return;
      try{
        if(await checkIsOffline()){
          if(cached)setAccess({status:'ready',value:cached.value,error:''});
          else setAccess({status:'error',value:null,error:'Connect once to verify your company access before using FireOps offline.'});
          return;
        }
      }catch{/* Network request below provides final availability check. */}
      const [adminResult,profileResult,membershipResult]=await Promise.all([
        supabase.rpc('is_system_admin'),
        supabase.from('profiles').select('full_name').eq('user_id',sessionUserId).maybeSingle<{full_name:string}>(),
        supabase.from('company_members').select('company_id,role').eq('user_id',sessionUserId).limit(1).maybeSingle<{company_id:string;role:UserRole}>(),
      ]);
      if(!active)return;
      const userName=profileResult.data?.full_name||sessionUserEmail||'FireOps user';
      if(adminResult.data===true){
        const value:AdminAccess={kind:'admin',userName};
        setAccess({status:'ready',value,error:''});
        void storeAccountAccess(sessionUserId,value);
        return;
      }
      if(adminResult.error||membershipResult.error){
        console.error('Account access check failed',adminResult.error??membershipResult.error);
        if(cached)setAccess({status:'ready',value:cached.value,error:''});
        else setAccess({status:'error',value:null,error:'Account access could not be verified. Check your connection and try again.'});
        return;
      }
      const membership=membershipResult.data;
      if(!membership){setAccess({status:'error',value:null,error:'Your account is not assigned to a company. Ask your company owner for access.'});return}
      const companyResult=await supabase.from('companies').select('id,name,company_code,industry,phone,location,logo_path,crew_invite_limit').eq('id',membership.company_id).single<{id:string;name:string;company_code:string;industry:string;phone:string;location:string;logo_path:string|null;crew_invite_limit:number}>();
      if(!active)return;
      if(companyResult.error){
        console.error('Company access check failed',companyResult.error);
        if(cached)setAccess({status:'ready',value:cached.value,error:''});
        else setAccess({status:'error',value:null,error:'Company details could not be loaded. Check your connection and try again.'});
        return;
      }
      const value:CompanyAccess={kind:'member',user:{id:sessionUserId,name:userName,role:membership.role},company:{id:companyResult.data.id,name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry,phone:companyResult.data.phone,location:companyResult.data.location,logoPath:companyResult.data.logo_path,crewInviteLimit:companyResult.data.crew_invite_limit}};
      setAccess({status:'ready',value,error:''});
      void storeAccountAccess(sessionUserId,value);
    })();
    return()=>{active=false};
  },[sessionUserId,sessionUserEmail,attempt]);

  const retryAccess=useCallback(()=>setAttempt(value=>value+1),[]);
  const signOut=useCallback(async()=>{
    if(demoAccess){
      setDemoAccess(null);
      stopDemoClient();
      return;
    }
    if(!supabase)return;
    try{await unregisterFromPushNotifications()}catch(error){console.warn('Push notification cleanup failed:',error)}
    await supabase.auth.signOut(isOffline()?{scope:'local'}:undefined);
  },[demoAccess]);
  const selectCompany=useCallback(async(company:AdminCompany)=>{
    if(!supabase||access.value?.kind!=='admin')throw new Error('Administrator access is unavailable.');
    const {error}=await supabase.rpc('admin_access_company',{target_company_id:company.id});
    if(error)throw new Error(error.message);
    const value:CompanyAccess={kind:'member',user:{id:sessionUserId!,name:access.value.userName,role:'owner'},company,isAdmin:true};
    setAccess({status:'ready',value,error:''});
    void storeAccountAccess(sessionUserId!,value);
  },[access.value,sessionUserId]);
  const clearCompany=useCallback(()=>setAttempt(value=>value+1),[]);
  const updateCompanyProfile=useCallback(async(profile:{name:string;phone:string;location:string;logoPath:string|null})=>{
    if(demoAccess){setDemoAccess({...demoAccess,company:{...demoAccess.company,...profile,logoPath:null}});return}
    if(!supabase||access.value?.kind!=='member')throw new Error('Company is unavailable.');
    const current=access.value;
    const {data,error}=await supabase.rpc('update_company_profile',{target_company_id:current.company.id,company_name:profile.name,company_phone:profile.phone,company_location:profile.location,company_logo_path:profile.logoPath});
    if(error)throw new Error(error.message);
    const row=data as {name:string;phone:string;location:string;logo_path:string|null};
    const value:CompanyAccess={...current,company:{...current.company,name:row.name,phone:row.phone,location:row.location,logoPath:row.logo_path}};
    setAccess({status:'ready',value,error:''});
    void storeAccountAccess(sessionUserId!,value);
  },[access.value,sessionUserId,demoAccess]);
  // This session is a UI access marker only; it is never installed in Supabase auth.
  const demoSession=useMemo<Session|null>(()=>demoAccess?{access_token:'demo-only',refresh_token:'',expires_in:0,token_type:'bearer',user:{id:demoUser.id,aud:'demo',role:'demo',email:'jordan@example.com',app_metadata:{},user_metadata:{},created_at:''}}:null,[demoAccess]);
  const value=useMemo(()=>({configured:supabaseConfigured||Boolean(demoAccess),loading,session:demoSession??session,access:demoAccess?{status:'ready' as const,value:demoAccess,error:''}:access,demoMode:Boolean(demoAccess),startDemo,retryAccess,signOut,selectCompany,clearCompany,updateCompanyProfile}),[loading,session,access,demoAccess,demoSession,startDemo,retryAccess,signOut,selectCompany,clearCompany,updateCompanyProfile]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(){
  const value=useContext(SessionContext);
  if(!value)throw new Error('useSession must be used inside SessionProvider');
  return value;
}
