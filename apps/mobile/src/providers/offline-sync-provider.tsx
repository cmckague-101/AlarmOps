import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type PropsWithChildren} from 'react';
import {AppState,Platform} from 'react-native';
import {createOfflineDetailEditor,type OfflineDetailEditor} from '../lib/offline-detail-editor';
import {getNativeOfflineOutbox} from '../lib/offline-outbox-native';
import {createOfflineSyncWorker,emptyOfflineSyncState,type OfflineSyncWorker,type OfflineSyncState} from '../lib/offline-sync-worker';
import {createNativeSyncTransport} from '../lib/offline-sync-transport';
import {createFleetId} from '../lib/fleet-store';
import {offlineSyncSessionPaused,registerOfflineSyncSession} from '../lib/offline-sync-session';
import {supabase} from '../lib/supabase';
import {useSession} from './session-provider';
import {isOffline,useNetworkStatus} from './network-provider';

type ContextValue={detailEditor:OfflineDetailEditor|null;state:OfflineSyncState;available:boolean;loading:boolean;offline:boolean;refresh:()=>Promise<void>;retry:(operationId:string)=>Promise<void>;dismiss:()=>Promise<void>};
const Context=createContext<ContextValue|null>(null);
const emptySubscribe=()=>()=>{};
const emptySnapshot=()=>emptyOfflineSyncState;
export function OfflineSyncProvider({children}:PropsWithChildren){
  const {access,session,demoMode}=useSession();const {isOffline:offline}=useNetworkStatus();
  const member=access.status==='ready'&&access.value?.kind==='member'?access.value:null;
  const native=Platform.OS==='ios'||Platform.OS==='android';
  const userId=native&&!demoMode&&member&&session?.user.id===member.user.id?member.user.id:null;
  const companyId=userId?member?.company.id??null:null;
  const key=userId&&companyId?`${userId}:${companyId}`:null;
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const manager=member?.user.role==='owner'||member?.user.role==='admin';
  const runtime=useRef({key,foreground,manager});runtime.current={key,foreground,manager};
  const [binding,setBinding]=useState<{key:string;worker:OfflineSyncWorker;editor:OfflineDetailEditor}|null>(null);
  const [bootAttempt,setBootAttempt]=useState(0);
  const [startupError,setStartupError]=useState<{key:string;message:string}|null>(null);
  const worker=binding?.key===key?binding.worker:null;
  const current=useRef<{key:string;worker:OfflineSyncWorker}|null>(null);
  const state=useSyncExternalStore(worker?.subscribe??emptySubscribe,worker?.getSnapshot??emptySnapshot,emptySnapshot);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',value=>{
      runtime.current.foreground=value==='active';
      if(value!=='active'&&current.current?.key===runtime.current.key)current.current?.worker.pause();
      setForeground(value==='active');
    });return()=>subscription.remove();
  },[]);
  useEffect(()=>{
    if(!key||!userId||!companyId||!supabase)return;
    const identity={userId,companyId};const client=supabase;
    let cancelled=false;let cleanup:()=>void=()=>{};
    void (async()=>{
      try{
        const store=await getNativeOfflineOutbox();
        if(cancelled||runtime.current.key!==key)return;
        const scoped=store.activate(identity);
        const canAccess=()=>!cancelled&&runtime.current.key===key;
        const canRun=()=>canAccess()&&runtime.current.foreground&&!isOffline()&&!offlineSyncSessionPaused(identity.userId);
        const transport=createNativeSyncTransport(client,identity,canRun);
        const created=createOfflineSyncWorker({session:scoped,transport,canAccess,canRun,canReadRecords:()=>runtime.current.manager,token:createFleetId});
        const editor=createOfflineDetailEditor({session:scoped,readRecord:transport.readRecord,canEdit:()=>canAccess()&&runtime.current.manager&&runtime.current.foreground&&!offlineSyncSessionPaused(identity.userId),offline:isOffline,id:createFleetId,
          changed:async()=>{await created.refresh();void created.wake()}});
        const unregister=registerOfflineSyncSession(identity.userId,{pause:()=>created.pause(),resume:()=>void created.resume()});
        const auth=client.auth.onAuthStateChange((_event,next)=>{
          if(!canAccess())return;
          if(next?.user.id!==identity.userId){editor.dispose();created.stop();store.pause();setBinding(previous=>previous?.worker===created?null:previous)}
        });
        cleanup=()=>{editor.dispose();created.stop();store.pause();unregister();auth.data.subscription.unsubscribe();if(current.current?.worker===created)current.current=null};
        current.current={key,worker:created};setBinding({key,worker:created,editor});setStartupError(null);
        await created.refresh();
      }catch{
        if(!cancelled&&runtime.current.key===key)setStartupError({key,message:'Device sync storage is unavailable. Saved work has not been discarded.'});
      }
    })();
    return()=>{cancelled=true;cleanup();setBinding(previous=>previous?.key===key?null:previous)};
  },[key,userId,companyId,bootAttempt]);
  useEffect(()=>{
    if(!worker)return;
    if(offline||!foreground){worker.pause();void worker.refresh()}else void worker.resume();
  },[worker,offline,foreground]);
  useEffect(()=>{
    if(!worker)return;
    const timer=setInterval(()=>{
      const snapshot=worker.getSnapshot();
      const pending=snapshot.entries.some(entry=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome));
      if(runtime.current.foreground&&!isOffline()&&(pending||snapshot.error))void worker.wake();
    },15_000);return()=>clearInterval(timer);
  },[worker]);
  const refresh=useCallback(async()=>{if(worker)await worker.resume();else if(key)setBootAttempt(value=>value+1)},[worker,key]);
  const retry=useCallback(async(id:string)=>{if(worker){await worker.retry(id);await worker.wake()}},[worker]);
  const dismiss=useCallback(async()=>{await worker?.dismiss()},[worker]);
  const value=useMemo<ContextValue>(()=>({detailEditor:binding?.key===key&&manager?binding.editor:null,state:startupError?.key===key?{...state,error:startupError.message}:state,available:!!key,loading:!!key&&(!worker||!state.loaded)&&startupError?.key!==key,offline,refresh,retry,dismiss}),[binding,manager,state,startupError,key,worker,offline,refresh,retry,dismiss]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOfflineSync(){const value=useContext(Context);if(!value)throw new Error('useOfflineSync must be inside OfflineSyncProvider');return value}
