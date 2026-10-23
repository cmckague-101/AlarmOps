import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type PropsWithChildren} from 'react';
import {AppState,Platform} from 'react-native';
import {bindOfflineFleet,createFleetEditGate} from '../lib/offline-fleet-model';
import {createOfflineDetailEditor,type OfflineDetailEditor} from '../lib/offline-detail-editor';
import {createOfflineAttachmentController,emptyAttachmentDraftState,type OfflineAttachmentController} from '../lib/offline-attachment-controller';
import {createOfflineAttachmentVault} from '../lib/offline-attachment-vault';
import {createNativeAttachmentFiles} from '../lib/offline-attachment-files-native';
import {createOfflineAttachmentUploader} from '../lib/offline-attachment-upload';
import {createOfflineAttachmentDocumentSync} from '../lib/offline-attachment-documents';
import {createNativeAttachmentUploadTransport} from '../lib/offline-attachment-upload-transport';
import {createSlotAttachmentPreparer,createSlotAttachmentSettler} from '../lib/offline-attachment-slots';
import {createOfflineUserSync,deviceReplies,pendingNotificationPreferences,pendingNotificationReads,pendingThreadSeen,scopedUserEntries,type OfflineUserSync} from '../lib/offline-user-sync';
import {publishOfflineChatInbox} from '../lib/offline-chat-inbox';
import {createUserSnapshotSync,type UserSnapshotState,type UserSnapshotSync} from '../lib/offline-user-snapshot';
import {File} from 'expo-file-system';
import {getNativeOfflineOutbox} from '../lib/offline-outbox-native';
import {createOfflineSyncWorker,emptyOfflineSyncState,offlineSyncDecisions,type OfflineSyncDecision,type OfflineSyncWorker,type OfflineSyncState} from '../lib/offline-sync-worker';
import {createNativeSyncTransport} from '../lib/offline-sync-transport';
import {resolveOfflineDecision} from '../lib/offline-sync-decisions';
import {fetchNifcIncidents} from '../lib/nifc';
import {readFireList,saveFireList} from '../lib/offline-fire-list';
import {createCompanySnapshotSync,type CompanySnapshotSync} from '../lib/offline-company-snapshot';
import {publishOfflineCompanyLists} from '../lib/offline-company-lists';
import {createNativeReceiptFiles,type OfflineReceiptFiles} from '../lib/offline-receipt-files';
import {createFleetId} from '../lib/fleet-store';
import {offlineSyncSessionPaused,registerOfflineSyncSession} from '../lib/offline-sync-session';
import {supabase} from '../lib/supabase';
import {useSession} from './session-provider';
import {isOffline,useNetworkStatus} from './network-provider';

type ContextValue={userSync:OfflineUserSync|null;
  /** Conflicted or refused changes waiting for this user's decision (see offlineSyncDecisions). */
  decisions:readonly OfflineSyncDecision[];resolveDecision:(decision:OfflineSyncDecision,action:'resubmit'|'cancel')=>Promise<void>;
  /** Receipt files kept on this device until their receipts sync. */
  receiptFiles:OfflineReceiptFiles|null;
  /** Verified own tasks/settings download for this account; null outside the native provider binding. */
  userSnapshot:UserSnapshotState|null;refreshUserSnapshot:()=>Promise<void>;attachmentController:OfflineAttachmentController|null;syncAttachments:()=>void;attachmentState:ReturnType<OfflineAttachmentController['getSnapshot']>;detailEditor:OfflineDetailEditor|null;hasSavedDetails:boolean;state:OfflineSyncState;available:boolean;loading:boolean;offline:boolean;refresh:()=>Promise<void>;retry:(operationId:string)=>Promise<void>;dismiss:()=>Promise<void>;downloadFleet:()=>Promise<void>;stopFleetDownload:()=>Promise<void>};
const Context=createContext<ContextValue|null>(null);
const emptySubscribe=()=>()=>{};
const emptySnapshot=()=>emptyOfflineSyncState;
const emptyAttachments=()=>emptyAttachmentDraftState;
const emptyUserSnapshot=()=>null;
const emptyCompanyLists=()=>null;
export function OfflineSyncProvider({children}:PropsWithChildren){
  const {access,session,demoMode}=useSession();const {isOffline:offline}=useNetworkStatus();
  const member=access.status==='ready'&&access.value?.kind==='member'?access.value:null;
  const native=Platform.OS==='ios'||Platform.OS==='android';
  const userId=native&&!demoMode&&member&&session?.user.id===member.user.id?member.user.id:null;
  const companyId=userId?member?.company.id??null:null;
  const key=userId&&companyId?`${userId}:${companyId}`:null;
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const manager=member?.user.role==='owner'||member?.user.role==='admin';
  // Crew may sync vehicle claims/release and notes on their own issues; attachments stay owner/admin.
  const crew=member?.user.role==='fire_fighter'||member?.user.role==='shop_tech';const syncRole=manager||crew;
  const shopTech=member?.user.role==='shop_tech';
  const runtime=useRef({key,foreground,manager,syncRole,shopTech});runtime.current={key,foreground,manager,syncRole,shopTech};
  const [binding,setBinding]=useState<{key:string;worker:OfflineSyncWorker;editor:OfflineDetailEditor;attachments:OfflineAttachmentController;syncAttachments:()=>void;userSync:OfflineUserSync;userSnapshots:UserSnapshotSync;receiptFiles:OfflineReceiptFiles;companySnapshots:CompanySnapshotSync}|null>(null);
  const [bootAttempt,setBootAttempt]=useState(0);
  const [startupError,setStartupError]=useState<{key:string;message:string}|null>(null);
  const worker=binding?.key===key?binding.worker:null;
  const current=useRef<{key:string;worker:OfflineSyncWorker;attachments:OfflineAttachmentController}|null>(null);
  // Shop techs stage inspection photos; vehicle files/documents stay owner/admin in the editor.
  const attachmentUser=manager||member?.user.role==='shop_tech';
  const attachmentController=binding?.key===key&&attachmentUser?binding.attachments:null;
  const attachmentState=useSyncExternalStore(attachmentController?.subscribe??emptySubscribe,attachmentController?.getSnapshot??emptyAttachments,emptyAttachments);
  const state=useSyncExternalStore(worker?.subscribe??emptySubscribe,worker?.getSnapshot??emptySnapshot,emptySnapshot);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',value=>{
      runtime.current.foreground=value==='active';
      if(value!=='active'&&current.current?.key===runtime.current.key){current.current.worker.pause();current.current.attachments.pause()}
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
        const receiptFiles=createNativeReceiptFiles(identity);const transport=createNativeSyncTransport(client,identity,canRun,receiptFiles);
        const canUseAttachments=()=>canAccess()&&(runtime.current.manager||runtime.current.shopTech)&&runtime.current.foreground&&!offlineSyncSessionPaused(identity.userId);
        const vault=createOfflineAttachmentVault({session:scoped,files:createNativeAttachmentFiles(identity),canAccess:canUseAttachments,createId:createFleetId,connectivity:()=>isOffline()?'offline':'online'});
        // Same scoped session; uploads also require a connection. Results never mark business work synced.
        const canUploadAttachments=()=>canUseAttachments()&&!isOffline();
        const attachmentTransport=createNativeAttachmentUploadTransport(client,identity,canUploadAttachments,uri=>new File(uri).arrayBuffer());
        const uploader=createOfflineAttachmentUploader({session:scoped,vault,transport:attachmentTransport,canRun:canUploadAttachments});
        // Vehicle file slots: files are uploaded and proven before the worker sends the record change.
        const created=createOfflineSyncWorker({session:scoped,transport,canAccess,canRun,canReadRecords:()=>runtime.current.syncRole,token:createFleetId,fleetRefreshMs:15*60_000,
          prepareAttachments:createSlotAttachmentPreparer({session:scoped,uploader,transport:attachmentTransport})});
        const documents=createOfflineAttachmentDocumentSync({session:scoped,uploader,transport:attachmentTransport,canRun:canUploadAttachments,discard:id=>vault.discard(id),
          settle:createSlotAttachmentSettler({session:scoped,discard:id=>vault.discard(id)})});
        const attachmentAbort=new AbortController();
        const attachments=createOfflineAttachmentController({session:scoped,vault,canAccess:canUseAttachments,documents,changed:()=>{void created.wake()}});
        const syncAttachments=()=>{if(canUploadAttachments())void attachments.sync(attachmentAbort.signal)};
        const gate=createFleetEditGate(scoped,canAccess);
        const model=bindOfflineFleet({model:{scope:identity,records:[],entries:[],offline:isOffline(),loaded:false},current:canAccess,visible:()=>runtime.current.syncRole,
          legacy:gate.legacy,refresh:()=>{void created.wake()}});
        // Issues cached under an earlier owner/admin role stay hidden from crew until refresh removes them.
        const visibleRecords=(records:ReturnType<typeof created.getSnapshot>['records'])=>runtime.current.manager?records:records.filter(row=>row.entityType==='vehicle'||(row.record as {createdById?:unknown}|null)?.createdById===identity.userId);
        const publish=()=>{const snapshot=created.getSnapshot();model.publish({scope:identity,records:visibleRecords(snapshot.records),entries:snapshot.entries,offline:isOffline(),loaded:snapshot.loaded})};
        const unpublish=created.subscribe(publish);
        const editor=createOfflineDetailEditor({session:scoped,readRecord:transport.readRecord,reserve:(target,owner)=>gate.acquire([target],owner),downloaded:()=>created.refresh(),canEdit:()=>canAccess()&&runtime.current.syncRole&&runtime.current.foreground&&!offlineSyncSessionPaused(identity.userId),offline:isOffline,id:createFleetId,
          restrictFields:()=>runtime.current.manager?null:{vehicle:runtime.current.shopTech?['status','assignedTo','assignedFire','inspections']:['status','assignedTo','assignedFire'],issue:runtime.current.shopTech?['updates','status','resolvedAt','create']:['updates','status','resolvedAt']},
          changed:async()=>{await created.refresh();void created.wake()}});
        // Tasks, own availability and dashboard layout: any current member, same scoped session.
        const userSync=createOfflineUserSync({session:scoped,id:createFleetId,offline:isOffline,canEdit:()=>canAccess()&&runtime.current.foreground&&!offlineSyncSessionPaused(identity.userId),changed:async()=>{await created.refresh();void created.wake()},receiptFiles});
        // Verified own tasks/settings: loaded from the device, refreshed only online.
        const userSnapshots=createUserSnapshotSync({session:scoped,download:signal=>transport.userSnapshot(signal),canRun});
        void userSnapshots.load().then(()=>userSnapshots.refresh());
        // Verified company lists (inventory, training, payroll, invoices, receipts) for offline display.
        const companySnapshots=createCompanySnapshotSync({session:scoped,download:(section,signal)=>transport.companySnapshot(section,signal),canRun});
        void companySnapshots.load().then(()=>companySnapshots.refresh());
        const unregister=registerOfflineSyncSession(identity.userId,{pause:()=>{created.pause();attachments.pause()},resume:()=>{void created.resume();void attachments.resume()}});
        const auth=client.auth.onAuthStateChange((_event,next)=>{
          if(!canAccess())return;
          if(next?.user.id!==identity.userId){model.dispose();editor.dispose();created.stop();attachments.stop();store.pause();setBinding(previous=>previous?.worker===created?null:previous)}
        });
        cleanup=()=>{userSnapshots.stop();companySnapshots.stop();attachmentAbort.abort();unpublish();model.dispose();editor.dispose();created.stop();attachments.stop();store.pause();unregister();auth.data.subscription.unsubscribe();if(current.current?.worker===created)current.current=null};
        current.current={key,worker:created,attachments};setBinding({key,worker:created,editor,attachments,syncAttachments,userSync,userSnapshots,receiptFiles,companySnapshots});setStartupError(null);
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
  const syncAttachments=binding?.key===key&&attachmentUser?binding.syncAttachments:null;
  useEffect(()=>{if(!attachmentController)return;if(foreground&&attachmentUser)void attachmentController.resume().then(()=>{if(!offline)syncAttachments?.()});else attachmentController.pause();return()=>attachmentController.pause()},[attachmentController,syncAttachments,foreground,attachmentUser,offline]);
  useEffect(()=>{
    if(!attachmentController||!syncAttachments)return;
    const timer=setInterval(()=>{if(runtime.current.foreground&&!isOffline()&&attachmentController.getSnapshot().items.some(item=>item.document?.stage==='pending'||(item.document?.stage==='applied'&&!['discarding','discarded'].includes(item.state))||item.remoteRelease?.state==='pending'||(item.operationIds.length>0&&item.state==='ready')))syncAttachments()},15_000);
    return()=>clearInterval(timer);
  },[attachmentController,syncAttachments]);
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
  const decisions=useMemo(()=>offlineSyncDecisions(state),[state]);
  const resolveDecision=useCallback(async(decision:OfflineSyncDecision,action:'resubmit'|'cancel')=>{
    if(!worker||!binding||binding.key!==key)throw new Error('Saved changes are unavailable for this account.');
    await resolveOfflineDecision(decision,action,{worker,editor:binding.editor,userSync:binding.userSync});
    await worker.refresh();void worker.wake();
  },[worker,binding,key]);
  const downloadFleet=useCallback(async()=>{await worker?.startFleetDownload()},[worker]);
  // Background download: vehicle/issue details are kept on the device automatically (no opt-in), once per
  // account binding; later runs refresh them every 15 minutes. "Stop" in Saved changes & sync lasts until the next launch.
  const autoDownloaded=useRef<string|null>(null);
  useEffect(()=>{
    if(!worker||!key||offline||!foreground||!syncRole||!state.loaded||autoDownloaded.current===key)return;
    autoDownloaded.current=key;if(!worker.getSnapshot().download)void worker.startFleetDownload();
  },[worker,key,offline,foreground,syncRole,state.loaded]);
  // Fire list for offline fire assignment: refreshed in the background at most hourly while online.
  useEffect(()=>{
    if(!key||offline||!foreground)return;const controller=new AbortController();
    void readFireList().then(saved=>{if(saved&&Date.now()-Date.parse(saved.savedAt)<60*60_000)return;return fetchNifcIncidents(controller.signal).then(incidents=>{if(!controller.signal.aborted)saveFireList(incidents)})}).catch(()=>{/* Kept list stays; retried next time online. */});
    return()=>controller.abort();
  },[key,offline,foreground]);
  const stopFleetDownload=useCallback(async()=>{await worker?.stopFleetDownload()},[worker]);
  // Inbox/Crew Chat stores are module-level; hand them this account's commands and overlays.
  const userSync=binding?.key===key?binding.userSync:null;
  const userSnapshots=binding?.key===key?binding.userSnapshots:null;
  const userSnapshot=useSyncExternalStore(userSnapshots?.subscribe??emptySubscribe,userSnapshots?.getSnapshot??emptyUserSnapshot,emptyUserSnapshot);
  // Refresh on reconnect/foreground and after this account's own commands are confirmed.
  const confirmedUserCommands=state.entries.filter(entry=>entry.status==='synced'&&entry.operation.mutation.kind==='command').length;
  useEffect(()=>{if(userSnapshots&&!offline&&foreground)void userSnapshots.refresh()},[userSnapshots,offline,foreground,confirmedUserCommands]);
  const refreshUserSnapshot=useCallback(async()=>{await userSnapshots?.refresh()},[userSnapshots]);
  const companySnapshots=binding?.key===key?binding.companySnapshots:null;
  const companyLists=useSyncExternalStore(companySnapshots?.subscribe??emptySubscribe,companySnapshots?.getSnapshot??emptyCompanyLists,emptyCompanyLists);
  useEffect(()=>{if(companySnapshots&&!offline&&foreground)void companySnapshots.refresh()},[companySnapshots,offline,foreground,confirmedUserCommands]);
  useEffect(()=>{
    if(!companySnapshots||!userSync||!companyLists){publishOfflineCompanyLists(null);return}
    publishOfflineCompanyLists({companyId:userSync.scope.companyId,userId:userSync.scope.userId,sections:companyLists.sections});
  },[companySnapshots,companyLists,userSync]);
  useEffect(()=>()=>publishOfflineCompanyLists(null),[]);
  useEffect(()=>{
    if(!userSync){publishOfflineChatInbox(null);return}
    const {userId:owner,companyId:tenant}=userSync.scope;const entries=scopedUserEntries(state.entries,owner,tenant);
    publishOfflineChatInbox({companyId:tenant,userId:owner,markNotificationRead:id=>userSync.markNotificationRead(id),markThreadSeen:(id,seenThrough)=>userSync.markThreadSeen(id,seenThrough),reads:pendingNotificationReads(entries),seen:pendingThreadSeen(entries),
      postReply:reply=>userSync.postReply(reply),newId:createFleetId,replies:deviceReplies(entries),
      savePreferences:changes=>userSync.setNotificationPreferences(changes),preferences:pendingNotificationPreferences(entries)});
  },[userSync,state.entries]);
  useEffect(()=>()=>publishOfflineChatInbox(null),[]);
  const value=useMemo<ContextValue>(()=>({decisions,resolveDecision,userSync:binding?.key===key?binding.userSync:null,receiptFiles:binding?.key===key?binding.receiptFiles:null,attachmentController,syncAttachments:()=>{if(!offline)syncAttachments?.()},attachmentState,detailEditor:binding?.key===key&&syncRole?binding.editor:null,hasSavedDetails:binding?.key===key&&syncRole&&state.records.some(record=>record.record!==null),state:startupError?.key===key?{...state,error:startupError.message}:state,available:!!key,loading:!!key&&(!worker||!state.loaded)&&startupError?.key!==key,offline,refresh,retry,dismiss,downloadFleet,stopFleetDownload,userSnapshot,refreshUserSnapshot}),[decisions,resolveDecision,userSnapshot,refreshUserSnapshot,attachmentController,syncAttachments,attachmentState,binding,manager,state,startupError,key,worker,offline,refresh,retry,dismiss,downloadFleet,stopFleetDownload]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** For shared hooks that may render outside the native provider (tests, web builds). */
export function useOptionalOfflineSync(){return useContext(Context)}
export function useOfflineSync(){const value=useContext(Context);if(!value)throw new Error('useOfflineSync must be inside OfflineSyncProvider');return value}
