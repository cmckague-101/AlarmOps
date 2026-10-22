import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type PropsWithChildren} from 'react';
import {AppState,Platform} from 'react-native';
import {bindOfflineFleet,createFleetEditGate} from '../lib/offline-fleet-model';
import {createOfflineDetailEditor,type OfflineDetailEditor} from '../lib/offline-detail-editor';
import {getNativeOfflineOutbox} from '../lib/offline-outbox-native';
import {createOfflineSyncWorker,emptyOfflineSyncState,type OfflineSyncWorker,type OfflineSyncState} from '../lib/offline-sync-worker';
import {createNativeSyncTransport} from '../lib/offline-sync-transport';
import {createFleetId} from '../lib/fleet-store';
import {offlineSyncSessionPaused,registerOfflineSyncSession} from '../lib/offline-sync-session';
import {supabase} from '../lib/supabase';
import {useSession} from './session-provider';
import {isOffline,useNetworkStatus} from './network-provider';

type ContextValue={detailEditor:OfflineDetailEditor|null;hasSavedDetails:boolean;state:OfflineSyncState;available:boolean;loading:boolean;offline:boolean;refresh:()=>Promise<void>;retry:(operationId:string)=>Promise<void>;dismiss:()=>Promise<void>;downloadFleet:()=>Promise<void>;stopFleetDownload:()=>Promise<void>};
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
  useLayoutEffect(()=>{
    if(!key||!userId||!companyId)return;
    const placeholder=bindOfflineFleet({model:{scope:{userId,companyId},records:[],entries:[],offline:isOffline(),loaded:false},current:()=>runtime.current.key===key,visible:()=>false,
      legacy:async()=>{throw new Error('Device sync storage must be ready before fleet changes. Open Saved changes & sync to retry.')},refresh:()=>{}});
    return()=>placeholder.dispose();
  },[key,userId,companyId,bootAttempt]);
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
        const gate=createFleetEditGate(scoped,canAccess);
        const model=bindOfflineFleet({model:{scope:identity,records:[],entries:[],offline:isOffline(),loaded:false},current:canAccess,visible:()=>runtime.current.manager,
          legacy:gate.legacy,refresh:()=>{void created.wake()}});
        const publish=()=>{const snapshot=created.getSnapshot();model.publish({scope:identity,records:snapshot.records,entries:snapshot.entries,offline:isOffline(),loaded:snapshot.loaded})};
        const unpublish=created.subscribe(publish);
        const editor=createOfflineDetailEditor({session:scoped,readRecord:transport.readRecord,reserve:(target,owner)=>gate.acquire([target],owner),downloaded:()=>created.refresh(),canEdit:()=>canAccess()&&runtime.current.manager&&runtime.current.foreground&&!offlineSyncSessionPaused(identity.userId),offline:isOffline,id:createFleetId,
          changed:async()=>{await created.refresh();void created.wake()}});
        const unregister=registerOfflineSyncSession(identity.userId,{pause:()=>created.pause(),resume:()=>void created.resume()});
        const auth=client.auth.onAuthStateChange((_event,next)=>{
          if(!canAccess())return;
          if(next?.user.id!==identity.userId){model.dispose();editor.dispose();created.stop();store.pause();setBinding(previous=>previous?.worker===created?null:previous)}
        });
        cleanup=()=>{unpublish();model.dispose();editor.dispose();created.stop();store.pause();unregister();auth.data.subscription.unsubscribe();if(current.current?.worker===created)current.current=null};
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
  },[worker,offline,foreground,manager]);
  useEffect(()=>{
    if(!worker)return;
    const timer=setInterval(()=>{
      const snapshot=worker.getSnapshot();
      const pending=!!snapshot.download&&!snapshot.download.complete||snapshot.entries.some(entry=>entry.historyBackupPending||['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome));
      if(runtime.current.foreground&&!isOffline()&&(pending||snapshot.error))void worker.wake();
    },15_000);return()=>clearInterval(timer);
  },[worker]);
  const refresh=useCallback(async()=>{if(worker)await worker.resume();else if(key)setBootAttempt(value=>value+1)},[worker,key]);
  const retry=useCallback(async(id:string)=>{if(worker){await worker.retry(id);await worker.wake()}},[worker]);
  const dismiss=useCallback(async()=>{await worker?.dismiss()},[worker]);
  const downloadFleet=useCallback(async()=>{await worker?.startFleetDownload()},[worker]);
  const stopFleetDownload=useCallback(async()=>{await worker?.stopFleetDownload()},[worker]);
  const value=useMemo<ContextValue>(()=>({detailEditor:binding?.key===key&&manager?binding.editor:null,hasSavedDetails:binding?.key===key&&manager&&state.records.some(record=>record.record!==null),state:startupError?.key===key?{...state,error:startupError.message}:state,available:!!key,loading:!!key&&(!worker||!state.loaded)&&startupError?.key!==key,offline,refresh,retry,dismiss,downloadFleet,stopFleetDownload}),[binding,manager,state,startupError,key,worker,offline,refresh,retry,dismiss,downloadFleet,stopFleetDownload]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOfflineSync(){const value=useContext(Context);if(!value)throw new Error('useOfflineSync must be inside OfflineSyncProvider');return value}
