import {useCallback,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Stack,useFocusEffect,useRouter} from 'expo-router';
import {SectionScreen} from '../components/section-screen';
import {useOfflineSync} from '../providers/offline-sync-provider';
import {offlineSyncEntryLabel} from '../lib/offline-sync-worker';
import {continuationReviewHref} from '../lib/offline-rebase-form';
import {OfflineAttachmentDrafts} from '../components/offline-attachment-drafts';
import {offlineChangeNoun} from '../components/offline-sync-notice';
import {useFireOpsTheme} from '../theme';

export default function SyncStatusScreen(){
  const {state,available,loading,offline,refresh,retry,detailEditor,attachmentController,attachmentState,decisions,resolveDecision}=useOfflineSync();
  const [deciding,setDeciding]=useState('');const [decisionError,setDecisionError]=useState('');
  const decide=async(operationId:string,action:'resubmit'|'cancel')=>{const decision=decisions.find(item=>item.entry.operation.operationId===operationId);if(!decision||deciding)return;setDeciding(operationId);setDecisionError('');try{await resolveDecision(decision,action)}catch(failure){setDecisionError(failure instanceof Error?failure.message:'This change could not be resolved.')}finally{setDeciding('')}};const theme=useFireOpsTheme();const router=useRouter();
  useFocusEffect(useCallback(()=>{if(!loading)void refresh()},[refresh,loading]));
  const entries=[...state.entries].sort((a,b)=>Date.parse(b.operation.provenance.savedAt)-Date.parse(a.operation.provenance.savedAt));
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={action} disabled={disabled} style={[styles.button,{borderColor:theme.divider},disabled&&{opacity:.5}]}><Text style={{color:theme.ink,fontWeight:'700'}}>{label}</Text></Pressable>;
  return <SectionScreen title="Saved changes & sync" description="Changes saved on this device and whether they have synced.">
    <Stack.Screen options={{title:'Saved changes & sync'}}/>
    {!available?<Text style={{color:theme.secondary}}>Sign in to a company on iOS or Android to view this device's saved changes.</Text>:<>
      {offline&&<Text style={[styles.meta,{color:theme.secondary}]}>Offline — changes will sync when connected.</Text>}
      {loading&&<Text accessibilityLiveRegion="polite" style={{color:theme.secondary}}>Loading saved changes…</Text>}
      {button(state.busy?'Syncing…':'Sync now',()=>void refresh(),offline||state.busy||loading)}
      {!!state.error&&<View accessibilityRole="alert" style={styles.entry}><Text style={{color:theme.danger}}>{state.error}</Text></View>}
      {attachmentController&&<OfflineAttachmentDrafts key={`${attachmentController.scope.userId}:${attachmentController.scope.companyId}`} controller={attachmentController} state={attachmentState}/>}
      {entries.map(entry=>{const noun=offlineChangeNoun(entry.operation.entityType);const decision=decisions.find(item=>item.entry.operation.operationId===entry.operation.operationId);const locked=!!deciding||(decision?.kind==='conflict'&&offline);
        return <View key={entry.operation.operationId} style={[styles.entry,{borderColor:theme.divider}]}>
          <Text style={[styles.title,{color:theme.ink}]}>{noun.charAt(0).toUpperCase()+noun.slice(1)}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.status,{color:theme.ink}]}>{offlineSyncEntryLabel(entry,state.busy)}</Text>
          <Text style={[styles.meta,{color:theme.secondary}]}>Saved {new Date(entry.operation.provenance.savedAt).toLocaleString()}</Text>
          {entry.error&&<Text style={[styles.meta,{color:theme.danger}]}>{entry.error}</Text>}
          {decision&&<View style={{gap:6}}><Text style={[styles.meta,{color:theme.danger}]}>{decision.label}</Text>
            {decision.canResubmit&&button(deciding===entry.operation.operationId?'Working…':'Submit again',()=>void decide(entry.operation.operationId,'resubmit'),locked)}
            {button('Cancel change',()=>void decide(entry.operation.operationId,'cancel'),locked)}
            {deciding===''&&decisionError?<Text accessibilityRole="alert" style={[styles.meta,{color:theme.danger}]}>{decisionError}</Text>:null}</View>}
          {entry.status==='blocked'&&entry.continuation?.phase==='waiting'&&detailEditor&&button('Review later edit',()=>router.push(continuationReviewHref(entry.operation.operationId)),state.busy)}
          {entry.status==='blocked'&&!entry.reviewOutcome&&entry.continuation?.phase!=='waiting'&&button('Retry',()=>void retry(entry.operation.operationId),offline||state.busy)}
        </View>})}
      {!loading&&!entries.length&&!state.error&&<Text style={{color:theme.secondary}}>No changes saved on this device yet.</Text>}
    </>}
  </SectionScreen>;
}
const styles=StyleSheet.create({entry:{paddingVertical:18,borderBottomWidth:1,gap:8},title:{fontSize:17,fontWeight:'800'},status:{fontSize:16,lineHeight:23,fontWeight:'700'},meta:{fontSize:14,lineHeight:21},button:{minHeight:48,justifyContent:'center',alignItems:'center',padding:13,borderWidth:1,borderRadius:10,marginVertical:10}});
