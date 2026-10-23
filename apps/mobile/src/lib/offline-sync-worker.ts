import {isSyncReviewUnavailable,type SyncOperation} from '@fireops/domain';
import type {CachedOfflineRecord,OfflineOutboxSession,OutboxEntry,OutboxRebase} from './offline-outbox';
import {decodeFleetDownloadPage,type FleetDownloadProgress} from './offline-fleet-download';
import {decodeCanonicalSyncRecord,decodeSyncOutcome,decodeSyncReceipt,offlineSyncAdapterBlock} from './offline-sync-protocol';

export interface OfflineSyncTransport{
  deliver(operation:SyncOperation,signal:AbortSignal,history?:readonly OutboxRebase[]):Promise<unknown>;
  backfillHistory?(operation:SyncOperation,signal:AbortSignal,history:readonly OutboxRebase[]):Promise<unknown>;
  canonical(operation:SyncOperation,signal:AbortSignal):Promise<unknown>;
  outcome(operation:SyncOperation,signal:AbortSignal):Promise<unknown>;
  downloadPage?(progress:Pick<FleetDownloadProgress,'snapshotToken'|'cursor'>,signal:AbortSignal):Promise<unknown>;
  readRecord?(target:Pick<SyncOperation,'entityType'|'entityId'>,signal:AbortSignal):Promise<unknown>;
}
export type OfflineSyncState={readonly records:readonly CachedOfflineRecord[];readonly entries:readonly OutboxEntry[];readonly busy:boolean;readonly loaded:boolean;readonly error:string|null;readonly setupPending:boolean;readonly download?:FleetDownloadProgress|null;readonly downloadError?:string|null};
export const emptyOfflineSyncState:OfflineSyncState={records:[],entries:[],busy:false,loaded:false,error:null,setupPending:false,download:null,downloadError:null};
export function offlineSyncErrorCode(error:unknown):string{return error&&typeof error==='object'?String((error as {code?:unknown}).code??''):''}
const coded=(message:string,code:string)=>Object.assign(new Error(message),{code});
const retryDelay=(attempts:number)=>Math.min(300_000,1000*2**Math.min(attempts,8));
function errorMessage(error:unknown):string{
  if(offlineSyncErrorCode(error)==='SYNC_STORAGE')return 'Device sync storage could not be updated. Saved work has not been discarded.';
  if(isSyncReviewUnavailable(error))return 'Sync is waiting for database setup. Saved work has not been discarded.';
  if(['401','PGRST301','PGRST302'].includes(offlineSyncErrorCode(error)))return 'Sign in again to finish syncing. Saved work remains on this device.';
  if(offlineSyncErrorCode(error)==='42501')return 'Current permissions do not allow this sync action. Verify company access before retrying.';
  if(offlineSyncErrorCode(error)==='23505')return 'This record identity was already used. Saved work is retained; an existing or completed record was not replaced.';
  if(['22023','22P02','55000'].includes(offlineSyncErrorCode(error)))return 'This change needs validation or a fresh base revision before it can sync. Saved work remains on this device.';
  return 'Sync was interrupted. Saved work will be retried without creating a duplicate.';
}

/** One foreground worker per scoped outbox. Never writes stale responses after pause/stop. */
export function createOfflineSyncWorker(options:{
  session:OfflineOutboxSession;transport:OfflineSyncTransport;
  canAccess:()=>boolean;canRun:()=>boolean;canReadRecords?:()=>boolean;token:()=>string;now?:()=>number;timeoutMs?:number;
  /** Uploads/verifies/copies bound files before delivery. Without it, file-bearing work stays blocked on device. */
  prepareAttachments?:(entry:OutboxEntry,signal:AbortSignal)=>Promise<{kind:'ready'}|{kind:'pending'|'blocked';error:string}>;prepareTimeoutMs?:number;
}){
  const {session,transport}=options;const now=options.now??Date.now;
  let state:OfflineSyncState=emptyOfflineSyncState;let stopped=false;let epoch=0;let running:Promise<void>|null=null;
  let requestAbort:AbortController|null=null;let recovering:Promise<void>|null=null;
  const listeners=new Set<()=>void>();
  let cacheError:string|null=null;
  const emit=(patch:Partial<OfflineSyncState>)=>{state={...state,...patch};listeners.forEach(listener=>listener())};
  const valid=(version:number)=>!stopped&&version===epoch&&options.canAccess();
  const ready=(version:number)=>valid(version)&&options.canRun();
  async function refresh(){
    const version=epoch;if(!valid(version))return;
    try{const [entries,records,download]=await Promise.all([session.list(),options.canReadRecords?.()?session.listRecords():Promise.resolve([]),options.canReadRecords?.()?session.getFleetDownload():Promise.resolve(null)]);if(valid(version)){
      const unfinished=entries.some(entry=>entry.historyBackupPending||['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome));
      emit({entries,records,download,loaded:true,...(!unfinished&&!cacheError?{error:null,setupPending:false}:{})});
    }}
    catch{if(valid(version))emit({loaded:true,error:'Device sync storage could not be read. Saved work has not been discarded.'})}
  }
  async function rpc<T>(version:number,task:(signal:AbortSignal)=>Promise<T>,timeoutMs=options.timeoutMs??30_000):Promise<T>{
    if(!ready(version))throw coded('Worker paused','SYNC_PAUSED');
    const controller=new AbortController();requestAbort=controller;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let abortListener:()=>void=()=>{};
    try{
      const cancelled=new Promise<never>((_resolve,reject)=>{
        abortListener=()=>reject(coded('Worker paused','SYNC_PAUSED'));
        controller.signal.addEventListener('abort',abortListener,{once:true});
      });
      const expired=new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>{
        reject(coded('Sync request timed out','SYNC_TIMEOUT'));controller.abort();
      },timeoutMs)});
      const result=await Promise.race([task(controller.signal),cancelled,expired]);
      if(!ready(version))throw coded('Worker paused','SYNC_PAUSED');
      emit({setupPending:false,error:null});return result;
    }finally{
      if(timeout!==undefined)clearTimeout(timeout);controller.signal.removeEventListener('abort',abortListener);
      if(requestAbort===controller)requestAbort=null;
    }
  }
  async function persist<T>(task:()=>Promise<T>):Promise<T>{try{return await task()}catch{throw coded('Device storage update failed','SYNC_STORAGE')}}
  async function pollReviews(version:number):Promise<boolean>{
    const entries=await session.list();if(!ready(version))return false;
    for(const entry of entries){
      if(!ready(version))return false;
      if(entry.status!=='awaiting_review'||entry.receipt?.kind!=='awaiting_review')continue;
      try{
        let outcome=entry.reviewOutcome;
        if(!outcome){
          const raw=await rpc(version,signal=>transport.outcome(entry.operation,signal));
          outcome=decodeSyncOutcome(entry.operation,entry.receipt.conflictId,raw);
          if(!outcome)continue;
          if(!ready(version))return false;
          if(!await persist(()=>session.recordReviewOutcome(entry.operation.operationId,outcome!)))continue;
        }
        if(!ready(version))return false;
        try{
          const raw=await rpc(version,signal=>transport.canonical(entry.operation,signal));
          const current=decodeCanonicalSyncRecord(entry.operation,raw,outcome.revision);
          if(ready(version))await persist(()=>session.finishReview(entry.operation.operationId,current));
        }catch(error){
          if(!ready(version))return false;
          // A verified decision proves the submitter's outcome even after demotion.
          // Do not replace a forbidden record with a fabricated null/deletion.
          if(offlineSyncErrorCode(error)==='42501')await persist(()=>session.finishReview(entry.operation.operationId));
          else throw error;
        }
        await refresh();
      }catch(error){
        if(!ready(version))return false;
        emit({error:errorMessage(error),setupPending:isSyncReviewUnavailable(error)});
        // Permission/session/setup failures generally affect the whole company.
        return false;
      }
    }
    return true;
  }
  async function refreshCachedRecords(version:number){
    if(!transport.readRecord||!options.canReadRecords?.()){cacheError=null;return}
    try{
      for(const cached of await persist(()=>session.listRecords())){
        if(!ready(version)||!options.canReadRecords())return;
        try{
          const raw=await rpc(version,signal=>transport.readRecord!(cached,signal));
          const current=decodeCanonicalSyncRecord(cached,raw,cached.revision);
          if(ready(version))await persist(()=>session.putRecord(cached.entityType,cached.entityId,current));
        }catch(error){
          if(!ready(version))return;
          if(offlineSyncErrorCode(error)==='42501')await persist(()=>session.removeRecord(cached.entityType,cached.entityId));
          else throw error;
        }
      }
      if(ready(version)){cacheError=null;emit({error:null,setupPending:false})}
    }catch(error){if(ready(version)){cacheError=errorMessage(error);emit({error:cacheError,setupPending:isSyncReviewUnavailable(error)})}}
  }
  async function recoverHistory(version:number):Promise<boolean>{
    if(options.canReadRecords?.()===false)return true;
    let problem:{error:string;setupPending:boolean}|null=null;
    for(const entry of (await persist(()=>session.list())).filter(value=>value.historyBackupPending&&(value.delivery||value.reviewOutcome||['synced','not_selected'].includes(value.status))).slice(0,100)){
      if(!ready(version))return false;
      try{
        if(!transport.backfillHistory)throw coded('History recovery needs an updated sync transport','PGRST202');
        const history=await persist(()=>session.listRebases(entry.operation.operationId));
        if(!history.length)throw coded('Continuation history is missing','SYNC_STORAGE');
        const raw=await rpc(version,signal=>transport.backfillHistory!(entry.operation,signal,history));
        const proof=decodeSyncReceipt(entry.operation,raw);
        if(!ready(version))return false;
        await persist(()=>session.confirmHistoryBackup(entry.operation.operationId,history,proof));
      }catch(error){
        if(!ready(version))return false;
        problem={error:offlineSyncErrorCode(error)==='55000'?'Original server submission is unavailable. Device history is retained; completed business work was not replayed.':['22023','22P02'].includes(offlineSyncErrorCode(error))?'Retained history does not match the original submission. Kept on device; business work was not replayed.':errorMessage(error),setupPending:isSyncReviewUnavailable(error)};
        emit(problem);
        if(!['55000','22023','22P02'].includes(offlineSyncErrorCode(error)))return false;
      }
    }
    if(problem)emit(problem);
    return !problem;
  }
  async function downloadFleet(version:number):Promise<boolean>{
    if(!options.canReadRecords?.())return false;
    let progress=await persist(()=>session.getFleetDownload());if(!progress)return false;
    let restarts=0;
    try{
      if(!transport.downloadPage)throw coded('Fleet download needs pending database setup','PGRST202');
      if(progress.complete){if(!await persist(()=>session.restartFleetDownload(options.token(),progress!.generationId)))return true;progress=(await session.getFleetDownload())!;if(!progress)return true}
      emit({downloadError:null});
      for(let page=0;page<100&&ready(version)&&options.canReadRecords();page++){
        try{
          const request=progress;
          const raw=await rpc(version,signal=>transport.downloadPage!(request,signal));
          if(!ready(version)||!options.canReadRecords())return true;
          const value=decodeFleetDownloadPage(raw,session.scope.companyId,request);
          if(!await persist(()=>session.applyFleetDownloadPage(request,value)))return true;
          await refresh();progress=(await session.getFleetDownload())!;
          if(!progress||progress.complete)return true;
        }catch(error){
          if(!ready(version))return true;
          if(offlineSyncErrorCode(error)==='PT409'&&restarts++<2){if(!await persist(()=>session.restartFleetDownload(options.token(),progress!.generationId)))return true;progress=(await session.getFleetDownload())!;if(!progress)return true;await refresh();continue}
          throw error;
        }
      }
    }catch(error){
      if(ready(version)){
        if((await session.getFleetDownload())?.generationId!==progress?.generationId)return true;
        if(offlineSyncErrorCode(error)==='42501'&&!await persist(()=>session.invalidateFleetDownload(options.token(),progress!.generationId)))return true;
        emit({downloadError:isSyncReviewUnavailable(error)?'Fleet download needs pending database migrations.':offlineSyncErrorCode(error)==='PT409'?'Fleet kept changing during download. Verified pages are retained; resume the scan.':'Fleet download is incomplete. Verify connection, access and device storage. Saved edits have not been discarded.'});
      }
    }
    return true;
  }
  async function run(version:number){
    try{
      await refresh();if(!ready(version))return;emit({busy:true});
      if(!await pollReviews(version)||!ready(version))return;
      for(let count=0;count<100&&ready(version);count++){
        await persist(()=>session.materializeContinuations());if(!ready(version))break;
        const claimed=await session.claimNext(options.token(),now());if(!ready(version)||!claimed)break;
        const {entry,attempt}=claimed;
        try{
          const block=entry.attachmentIds?.length&&!options.prepareAttachments?'This attachment workflow is not enabled for upload. Attachment intent is retained on this device; no files were uploaded.':offlineSyncAdapterBlock(entry.operation,entry.continuation?.phase==='ready');
          if(block){await persist(()=>session.finishAttempt(attempt,{kind:'blocked',error:block}));await refresh();continue}
          let delivery=entry.delivery;
          // Files first: the record change is sent only after the server proved each referenced copy.
          if(!delivery&&entry.attachmentIds?.length){
            const prepared=await rpc(version,signal=>options.prepareAttachments!(entry,signal),options.prepareTimeoutMs??300_000);
            if(prepared.kind!=='ready'){
              await persist(()=>session.finishAttempt(attempt,prepared.kind==='blocked'?{kind:'blocked',error:prepared.error}:{kind:'retry',error:prepared.error,retryAt:now()+retryDelay(entry.attempts)}));
              await refresh();continue;
            }
          }
          if(!delivery){
            const history=await persist(()=>session.listRebases(entry.operation.operationId));
            if(entry.continuation?.phase==='ready'&&!history.length)throw coded('Continuation history is missing','SYNC_STORAGE');
            const raw=await rpc(version,signal=>transport.deliver(entry.operation,signal,history));
            delivery=decodeSyncReceipt(entry.operation,raw);
            if(!ready(version))break;
            if(history.length)await persist(()=>session.confirmHistoryBackup(entry.operation.operationId,history,delivery!));
            if(!await persist(()=>session.recordDelivery(attempt,delivery!)))continue;
          }
          if(delivery.kind==='awaiting_review'){await refresh();continue;}
          const raw=await rpc(version,signal=>transport.canonical(entry.operation,signal));
          const current=decodeCanonicalSyncRecord(entry.operation,raw,delivery.revision);
          if(ready(version))await persist(()=>session.finishAttempt(attempt,{kind:'applied',receivedAt:delivery!.receivedAt,...current}));
          await refresh();
        }catch(error){
          if(!ready(version))break;
          const message=errorMessage(error);
          if(offlineSyncErrorCode(error)==='SYNC_STORAGE'){emit({error:message});break}
          const blocked=['42501','22023','22P02','23505','55000'].includes(offlineSyncErrorCode(error));
          await session.finishAttempt(attempt,blocked?{kind:'blocked',error:message}:{kind:'retry',error:message,retryAt:now()+retryDelay(entry.attempts)});
          emit({error:message,setupPending:isSyncReviewUnavailable(error)});
          if(isSyncReviewUnavailable(error)||['42501','401','PGRST301','PGRST302'].includes(offlineSyncErrorCode(error)))break;
        }
      }
      if(ready(version)){
        const recovered=await recoverHistory(version);const historyIssue=!recovered?{error:state.error,setupPending:state.setupPending}:null;
        if(ready(version)&&!await downloadFleet(version))await refreshCachedRecords(version);
        if(ready(version)&&historyIssue)emit(historyIssue);
      }
    }catch{
      if(valid(version))emit({error:'Device sync storage could not be updated. Saved work has not been discarded.'});
    }finally{
      if(valid(version)){emit({busy:false});await refresh()}
    }
  }
  function startRun():Promise<void>{
    if(stopped||!options.canAccess())return Promise.resolve();
    if(running)return running;
    const promise=run(epoch);running=promise;void promise.finally(()=>{if(running===promise)running=null});return promise;
  }
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    refresh,
    wake():Promise<void>{return recovering??startRun()},
    /** Cold start/reconnect: recover interrupted attempts and reset old wall-clock deadlines. */
    resume():Promise<void>{
      if(stopped||!options.canAccess())return Promise.resolve();
      if(recovering)return recovering;
      const version=epoch;
      const promise=(async()=>{try{
        if(running)await running;if(!valid(version))return;
        await session.recoverInterrupted();if(valid(version))await startRun();
      }catch{if(valid(version))emit({loaded:true,error:'Device sync storage could not be recovered. Saved work has not been discarded.'})}})();
      recovering=promise;void promise.finally(()=>{if(recovering===promise)recovering=null});return promise;
    },
    pause(){epoch+=1;recovering=null;requestAbort?.abort();requestAbort=null;emit({busy:false})},
    stop(){stopped=true;epoch+=1;recovering=null;requestAbort?.abort();requestAbort=null},
    async startFleetDownload(){
      if(!ready(epoch)||!options.canReadRecords?.())return;
      const version=epoch;try{await session.restartFleetDownload(options.token());if(running)await running;if(ready(version))await startRun()}
      catch{if(valid(version))emit({downloadError:'Device storage could not start the download. Saved work has not been discarded.'})}
    },
    async stopFleetDownload(){
      const version=epoch;if(!valid(version))return;
      try{await session.stopFleetDownload();if(valid(version)){emit({downloadError:null});await refresh()}}
      catch{if(valid(version))emit({downloadError:'Download settings could not be saved. Saved work has not been discarded.'})}
    },
    async retry(operationId:string){
      const version=epoch;if(!valid(version))return;
      try{await session.retryBlocked(operationId);if(valid(version))await refresh()}catch{if(valid(version))emit({error:'Device sync storage could not be updated. Saved work has not been discarded.'})}
    },
    async dismiss(){
      const version=epoch;if(!valid(version))return;
      try{await session.dismissCompletedNotices();if(valid(version))await refresh()}catch{if(valid(version))emit({error:'Completed notices could not be dismissed. Saved history has not been deleted.'})}
    },
  };
}
export type OfflineSyncWorker=ReturnType<typeof createOfflineSyncWorker>;

export function offlineSyncEntryLabel(entry:OutboxEntry,busy=false):string{
  if(entry.historyBackupPending&&(entry.delivery||entry.reviewOutcome||['synced','not_selected'].includes(entry.status)))return 'Earlier shared result recorded — device history backup pending';
  if(entry.continuation?.phase==='waiting')return entry.status==='blocked'?'Saved later edit — explicit rebase needed':'Saved later edit — waiting for earlier changes';
  if(entry.reviewOutcome?.outcome==='partially_kept')return 'Reviewed — some changes were kept';
  if(entry.reviewOutcome?.outcome==='not_selected'||entry.status==='not_selected')return 'Reviewed — another version was kept';
  if(entry.status==='synced'&&(entry.delivery as {keptCurrent?:unknown}|null)?.keptCurrent===true)return 'Synced — a newer change by someone else was kept';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='thread_deleted')return 'Not posted — the conversation was deleted before this reply synced';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='vehicle_deleted')return 'Not saved — the vehicle was deleted before this note synced';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='insufficient_stock')return 'Not checked out — not enough stock was left when it synced';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='item_deleted')return 'Not checked out — the item was deleted before it synced';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='course_full')return 'Not signed up — the course was full when your sign-up arrived';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='training_deleted')return 'Not signed up — the training was deleted before your sign-up arrived';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='already_submitted')return 'Not saved — this payroll was already submitted';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='form_deleted')return 'Not saved — this payroll form was deleted';
  if(entry.status==='synced'&&(entry.delivery as {notApplied?:unknown}|null)?.notApplied==='other_draft')return 'Not saved — another payroll form is already in progress';
  if(entry.status==='synced')return entry.operation.provenance.connectivity==='offline'?'Offline changes synced':'Changes synced';
  if(entry.reviewOutcome?.outcome==='kept')return 'Reviewed — changes accepted; shared-data refresh pending';
  if(entry.status==='awaiting_review')return 'Uploaded — awaiting owner/admin review';
  if(entry.status==='blocked')return entry.delivery?.kind==='applied'?'Uploaded — shared-data refresh blocked':'Saved on device — action needed';
  if(entry.delivery?.kind==='applied')return 'Uploaded — confirming shared data';
  return busy?'Syncing saved changes':'Saved on device — waiting for connection or retry';
}
export function offlineSyncNotice(state:OfflineSyncState):{message:string;detail:string|null;dismissible:boolean}|null{
  const visible=state.entries.filter(offlineSyncVisible);
  const history=visible.filter(entry=>entry.historyBackupPending&&(entry.delivery||entry.reviewOutcome||['synced','not_selected'].includes(entry.status)));
  const completed=visible.filter(entry=>!entry.historyBackupPending&&(entry.status==='synced'||entry.status==='not_selected'||!!entry.reviewOutcome&&entry.status==='blocked'));
  const blocked=visible.filter(entry=>entry.status==='blocked'&&!entry.reviewOutcome);
  const review=visible.filter(entry=>entry.status==='awaiting_review'&&!entry.reviewOutcome);
  const pending=visible.filter(entry=>entry.status==='pending'||entry.status==='syncing'||entry.status==='awaiting_review'&&!!entry.reviewOutcome);
  let message='';
  if(blocked.length)message=blocked.length===1?offlineSyncEntryLabel(blocked[0]):`${blocked.length} saved changes need attention`;
  else if(review.length)message=`Uploaded — ${review.length} ${review.length===1?'change awaits':'changes await'} owner/admin review`;
  else if(history.length)message=`${history.length} device ${history.length===1?'history backup is':'history backups are'} pending`;
  else if(pending.length)message=pending.every(entry=>entry.delivery?.kind==='applied'||entry.reviewOutcome?.outcome==='kept')?'Uploaded — confirming shared data':state.busy?`Syncing ${pending.length} saved ${pending.length===1?'change':'changes'}`:`${pending.length} saved ${pending.length===1?'change is':'changes are'} waiting to sync`;
  else if(completed.length)message=completed.length===1?offlineSyncEntryLabel(completed[0]):`${completed.length} changes finished syncing or review — see details`;
  else if(state.downloadError)message='Fleet download needs attention';
  else if(state.download&&!state.download.complete)message=state.busy?'Downloading verified fleet details':'Fleet detail download incomplete';
  else if(state.error)message='Sync needs attention';
  if(state.error&&/storage|notices could not be dismissed/i.test(state.error))return {message:'Sync status needs attention',detail:state.error,dismissible:false};
  return message?{message,detail:state.error??state.downloadError??(state.setupPending?'Waiting for database sync setup. Saved work has not been discarded.':null),dismissible:!!completed.length&&!blocked.length&&!review.length&&!pending.length&&!history.length&&!state.downloadError&&(!state.download||state.download.complete)}:null;
}
export function offlineSyncVisible(entry:OutboxEntry):boolean{
  return !!entry.historyBackupPending||!entry.noticeDismissed||['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
}
