import {createContext,useCallback,useContext,useEffect,useMemo,useState,type PropsWithChildren} from 'react';
import type {Session} from '@supabase/supabase-js';
import type {FireOpsUser,UserRole} from '@fireops/domain';
import {supabase,supabaseConfigured} from '@/lib/supabase';
import {unregisterFromPushNotifications} from '@/lib/notifications';

export type CompanyAccess={
  kind:'member';
  user:FireOpsUser;
  company:{id:string;name:string;code:string;industry:string;crewInviteLimit:number};
  isAdmin?:boolean;
};
type AdminAccess={kind:'admin';userName:string};
export type AdminCompany={id:string;name:string;code:string;industry:string;crewInviteLimit:number};
export type AccountAccess=CompanyAccess|AdminAccess;
type AccessState={status:'idle'|'loading'|'ready'|'error';value:null|AccountAccess;error:string};

type SessionContextValue={
  configured:boolean;loading:boolean;session:Session|null;access:AccessState;
  retryAccess:()=>void;signOut:()=>Promise<void>;
  selectCompany:(company:AdminCompany)=>Promise<void>;clearCompany:()=>void;
};

const SessionContext=createContext<SessionContextValue|null>(null);

export function SessionProvider({children}:PropsWithChildren){
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(supabaseConfigured);
  const [access,setAccess]=useState<AccessState>({status:'idle',value:null,error:''});
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    void supabase.auth.getSession()
      .then(({data,error})=>{
        if(!active)return;
        if(error)console.error('Session restoration failed',error);
        setSession(data.session);
        setLoading(false);
      })
      .catch(error=>{
        if(!active)return;
        console.error('Session restoration failed',error);
        setSession(null);
        setLoading(false);
      });
    const {data}=supabase.auth.onAuthStateChange((_event,nextSession)=>{setSession(nextSession);setLoading(false);if(!nextSession)setAccess({status:'idle',value:null,error:''})});
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
      const [adminResult,profileResult,membershipResult]=await Promise.all([
        supabase.rpc('is_system_admin'),
        supabase.from('profiles').select('full_name').eq('user_id',sessionUserId).maybeSingle<{full_name:string}>(),
        supabase.from('company_members').select('company_id,role').eq('user_id',sessionUserId).limit(1).maybeSingle<{company_id:string;role:UserRole}>(),
      ]);
      if(!active)return;
      const userName=profileResult.data?.full_name||sessionUserEmail||'FireOps user';
      if(adminResult.data===true){setAccess({status:'ready',value:{kind:'admin',userName},error:''});return}
      if(adminResult.error||membershipResult.error){
        console.error('Account access check failed',adminResult.error??membershipResult.error);
        setAccess({status:'error',value:null,error:'Account access could not be verified. Check your connection and try again.'});
        return;
      }
      const membership=membershipResult.data;
      if(!membership){setAccess({status:'error',value:null,error:'Your account is not assigned to a company. Ask your company owner for access.'});return}
      const companyResult=await supabase.from('companies').select('id,name,company_code,industry,crew_invite_limit').eq('id',membership.company_id).single<{id:string;name:string;company_code:string;industry:string;crew_invite_limit:number}>();
      if(!active)return;
      if(companyResult.error){
        console.error('Company access check failed',companyResult.error);
        setAccess({status:'error',value:null,error:'Company details could not be loaded. Check your connection and try again.'});
        return;
      }
      setAccess({status:'ready',value:{kind:'member',user:{id:sessionUserId,name:userName,role:membership.role},company:{id:companyResult.data.id,name:companyResult.data.name,code:companyResult.data.company_code,industry:companyResult.data.industry,crewInviteLimit:companyResult.data.crew_invite_limit}},error:''});
    })();
    return()=>{active=false};
  },[sessionUserId,sessionUserEmail,attempt]);

  const retryAccess=useCallback(()=>setAttempt(value=>value+1),[]);
  const signOut=useCallback(async()=>{
    if(!supabase)return;
    try{await unregisterFromPushNotifications()}catch(error){console.warn('Push notification cleanup failed:',error)}
    await supabase.auth.signOut();
  },[]);
  const selectCompany=useCallback(async(company:AdminCompany)=>{
    if(!supabase||access.value?.kind!=='admin')throw new Error('Administrator access is unavailable.');
    const {error}=await supabase.rpc('admin_access_company',{target_company_id:company.id});
    if(error)throw new Error(error.message);
    setAccess({status:'ready',value:{kind:'member',user:{id:sessionUserId!,name:access.value.userName,role:'owner'},company,isAdmin:true},error:''});
  },[access.value,sessionUserId]);
  const clearCompany=useCallback(()=>setAttempt(value=>value+1),[]);
  const value=useMemo(()=>({configured:supabaseConfigured,loading,session,access,retryAccess,signOut,selectCompany,clearCompany}),[loading,session,access,retryAccess,signOut,selectCompany,clearCompany]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(){
  const value=useContext(SessionContext);
  if(!value)throw new Error('useSession must be used inside SessionProvider');
  return value;
}
