import {useCallback,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Stack,useFocusEffect,useRouter} from 'expo-router';
import {SectionScreen} from '../components/section-screen';
import {useOfflineSync} from '../providers/offline-sync-provider';
import {offlineSyncEntryLabel,offlineSyncVisible} from '../lib/offline-sync-worker';
import {continuationReviewHref} from '../lib/offline-rebase-form';
import {OfflineAttachmentDrafts} from '../components/offline-attachment-drafts';
import {useFireOpsTheme} from '../theme';

export default function SyncStatusScreen(){
  const {state,available,loading,offline,refresh,retry,dismiss,detailEditor,downloadFleet,stopFleetDownload,attachmentController,attachmentState,decisions,resolveDecision}=useOfflineSync();
  const [deciding,setDeciding]=useState('');const [decisionError,setDecisionError]=useState('');
  const decide=async(operationId:string,action:'resubmit'|'cancel')=>{const decision=decisions.find(item=>item.entry.operation.operationId===operationId);if(!decision||deciding)return;setDeciding(operationId);setDecisionError('');try{await resolveDecision(decision,action)}catch(failure){setDecisionError(failure instanceof Error?failure.message:'This change could not be resolved.')}finally{setDeciding('')}};const theme=useFireOpsTheme();const router=useRouter();
  useFocusEffect(useCallback(()=>{if(!loading)void refresh()},[refresh,loading]));
  const [history,setHistory]=useState(false);
  const visible=history?state.entries:state.entries.filter(offlineSyncVisible);
  const completed=state.entries.some(entry=>!entry.noticeDismissed&&!entry.historyBackupPending&&(entry.status==='synced'||entry.status==='not_selected'||!!entry.reviewOutcome&&entry.status==='blocked'));
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={action} disabled={disabled} style={[styles.button,{borderColor:theme.divider},disabled&&{opacity:.5}]}><Text style={{color:theme.ink,fontWeight:'700'}}>{label}</Text></Pressable>;
  return <SectionScreen title="Saved changes & sync" description="Only this account's changes for the selected company. Closing the app does not discard saved work.">
    <Stack.Screen options={{title:'Saved changes & sync'}}/>
    {!available?<Text style={{color:theme.secondary}}>Sign in to a company on iOS or Android to view this device's saved changes.</Text>:<>
      <Text style={[styles.meta,{color:theme.secondary}]}>{offline?'Offline — uploads are paused.':'Sync resumes while the app is open and connected.'} Changes made offline are saved on this device and sync automatically once connected. Anything that can't be done offline will say it needs a connection.</Text>
      {loading&&<Text accessibilityLiveRegion="polite" style={{color:theme.secondary}}>Loading this account's saved changes…</Text>}
      {button(state.busy?'Checking sync…':'Check sync / retry due changes',()=>void refresh(),state.busy||loading)}
      {detailEditor&&<View style={[styles.entry,{borderColor:theme.divider}]}>
        <Text style={[styles.title,{color:theme.ink}]}>Vehicle / issue detail downloads</Text>
        <Text style={[styles.meta,{color:theme.secondary}]}>Full vehicle and issue records are stored on this device so they can be viewed and edited offline (crew: vehicles only). Attachment files are not downloaded.</Text>
        <Text style={[styles.meta,{color:theme.secondary}]}>{state.records.filter(row=>row.record!==null&&row.entityType==='vehicle').length} saved vehicles · {state.records.filter(row=>row.record!==null&&row.entityType==='issue').length} saved issues.</Text>
        {state.download?<Text style={[styles.meta,{color:theme.secondary}]}>{state.download.complete?'Verified inventory scan completed':'Inventory scan incomplete'} · {state.download.received}/{state.download.total} tracked records checked (includes proven deletions). Last completed scan server request time: {state.download.lastCompletedAt?new Date(state.download.lastCompletedAt).toLocaleString(undefined,{timeZoneName:'short'}):'Not recorded'}. A completed scan is not a promise that no newer shared edits exist.</Text>:<Text style={[styles.meta,{color:theme.secondary}]}>Vehicle and issue details download automatically while the app is online and refresh every 15 minutes.</Text>}
        {!!state.downloadError&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{state.downloadError}</Text>}
        {button(state.busy?'Checking downloads…':state.download&&!state.download.complete?'Resume verified download':'Download / refresh all vehicle and issue details',()=>void (state.download&&!state.download.complete?refresh():downloadFleet()),offline||state.busy||loading)}
        {(state.download||state.downloadError||state.error)&&button('Stop company-wide catch-up (keep saved data)',()=>void stopFleetDownload())}
      </View>}
      {!!state.error&&<View accessibilityRole="alert" style={styles.entry}><Text style={{color:theme.danger}}>{state.error}</Text></View>}
      {attachmentController&&<OfflineAttachmentDrafts key={`${attachmentController.scope.userId}:${attachmentController.scope.companyId}`} controller={attachmentController} state={attachmentState}/>}
      {!!state.entries.length&&button(history?'Hide completed history':'Show completed history',()=>setHistory(value=>!value))}
      {visible.map(entry=><View key={entry.operation.operationId} style={[styles.entry,{borderColor:theme.divider}]}>
        <Text style={[styles.title,{color:theme.ink}]}>{entry.operation.entityType} · {entry.operation.entityId.slice(-8)}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.status,{color:theme.ink}]}>{offlineSyncEntryLabel(entry,state.busy)}</Text>
        <Text style={[styles.meta,{color:theme.secondary}]}>Saved on device {new Date(entry.operation.provenance.savedAt).toLocaleString(undefined,{timeZoneName:'short'})} · {entry.operation.provenance.connectivity==='offline'?'Offline (reported by app)':entry.operation.provenance.connectivity==='online'?'Online (reported by app)':'Connection status unknown'}</Text>
        {entry.operation.dependsOn.length>0&&<Text style={[styles.meta,{color:theme.secondary}]}>This edit depends on earlier work. Rejected or partly kept predecessors require an explicit rebase; they will not be overwritten automatically.</Text>}
        {entry.reviewOutcome&&<Text style={[styles.meta,{color:theme.secondary}]}>Kept fields: {entry.reviewOutcome.keptFields.join(', ')||'None'}. Discarded fields: {entry.reviewOutcome.discardedFields.join(', ')||'None'}. Original submitted work remains in saved history.</Text>}
        {entry.historyBackupPending&&<Text style={[styles.meta,{color:theme.secondary}]}>Retained device versions are not confirmed backed up yet. Recovery checks the original server submission and never replays an unknown completed operation.</Text>}
        {entry.noticeDismissed&&<Text style={[styles.meta,{color:theme.secondary}]}>Notice dismissed — retained in this account's device history.</Text>}
        {detailEditor&&(entry.operation.entityType==='vehicle'||entry.operation.entityType==='issue')&&button('Inspect backed-up device history (online)',()=>router.push({pathname:'/sync-conflict',params:{entityType:entry.operation.entityType,entityId:entry.operation.entityId}} as never),offline)}
        {entry.error&&<Text style={[styles.meta,{color:theme.danger}]}>{entry.error}</Text>}
        {(()=>{const decision=decisions.find(item=>item.entry.operation.operationId===entry.operation.operationId);if(!decision)return null;const locked=!!deciding||(decision.kind==='conflict'&&offline);
          return <View style={{gap:6}}><Text style={[styles.meta,{color:theme.danger}]}>{decision.label}</Text>
            {decision.canResubmit&&button(deciding===entry.operation.operationId?'Working…':'Submit again',()=>void decide(entry.operation.operationId,'resubmit'),locked)}
            {button('Cancel change',()=>void decide(entry.operation.operationId,'cancel'),locked)}
            {deciding===''&&decisionError?<Text accessibilityRole="alert" style={[styles.meta,{color:theme.danger}]}>{decisionError}</Text>:null}</View>})()}
        {entry.status==='blocked'&&entry.continuation?.phase==='waiting'&&detailEditor&&button('Review / rebase later edit',()=>router.push(continuationReviewHref(entry.operation.operationId)),state.busy)}
        {entry.status==='blocked'&&!entry.reviewOutcome&&entry.continuation?.phase!=='waiting'&&button('Retry after fixing access or updating the app',()=>void retry(entry.operation.operationId),offline||state.busy)}
      </View>)}
      {!loading&&!visible.length&&!state.error&&<Text style={{color:theme.secondary}}>No pending changes or new sync results for this account and company.</Text>}
      {completed&&button('Dismiss completed notices (keep history)',()=>void dismiss())}
    </>}
  </SectionScreen>;
}
const styles=StyleSheet.create({entry:{paddingVertical:18,borderBottomWidth:1,gap:8},title:{fontSize:17,fontWeight:'800'},status:{fontSize:16,lineHeight:23,fontWeight:'700'},meta:{fontSize:14,lineHeight:21},button:{minHeight:48,justifyContent:'center',alignItems:'center',padding:13,borderWidth:1,borderRadius:10,marginVertical:10}});
