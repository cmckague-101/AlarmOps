import {useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {offlineSyncNotice,type OfflineSyncDecision} from '../lib/offline-sync-worker';
import {useOfflineSync} from '../providers/offline-sync-provider';
import {useFireOpsTheme} from '../theme';

const nouns:Record<string,string>={vehicle:'vehicle',issue:'issue',training:'training',inventory_item:'inventory item',inventory_checkout:'gear checkout',inventory_return:'gear check-in',
  receipt:'receipt',vehicle_note:'vehicle note',payroll_form:'payroll form',payroll_review:'payroll decision',invoice_form:'invoice',training_signup:'training sign-up',availability:'availability',
  vehicle_inspection:'inspection',vehicle_document:'vehicle document',crew_credential:'credential',crew_experience:'experience record',annual_record:'annual record',communication_reply:'Crew Chat reply'};
/** What a decision is about, for the banner and Saved changes & sync. */
export function offlineDecisionTitle(decision:OfflineSyncDecision){
  const noun=nouns[decision.entry.operation.entityType]??'change';
  return decision.kind==='conflict'?`Conflict on your ${noun} change`:`Your ${noun} change was not saved`;
}

export function OfflineSyncNotice({topInset=0}:{topInset?:number}){
  const {state,available,dismiss,attachmentState,decisions,resolveDecision,offline}=useOfflineSync();const theme=useFireOpsTheme();
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  if(available&&decisions.length){
    // Conflicts and refused changes come first: the user decides to submit again or cancel.
    const decision=decisions[0];
    const act=async(action:'resubmit'|'cancel')=>{if(busy)return;setBusy(true);setError('');try{await resolveDecision(decision,action)}catch(failure){setError(failure instanceof Error?failure.message:'This change could not be resolved. Try again.')}finally{setBusy(false)}};
    const needsConnection=decision.kind==='conflict'&&offline;
    return <View accessibilityLiveRegion="polite" style={[styles.notice,styles.decision,{backgroundColor:theme.dangerSurface,borderColor:theme.danger,paddingTop:8+topInset}]}>
      <View style={styles.copy}>
        <Text style={[styles.title,{color:theme.ink}]}>{offlineDecisionTitle(decision)}{decisions.length>1?` (1 of ${decisions.length})`:''}</Text>
        <Text style={{color:theme.ink,fontSize:12,lineHeight:17}}>{decision.label}</Text>
        {needsConnection?<Text style={{color:theme.secondary,fontSize:12}}>Connect to submit again or cancel.</Text>:null}
        {error?<Text accessibilityRole="alert" style={{color:theme.danger,fontSize:12}}>{error}</Text>:null}
      </View>
      <View style={styles.actions}>
        {decision.canResubmit?<Pressable accessibilityRole="button" disabled={busy||needsConnection} onPress={()=>void act('resubmit')} style={[styles.button,(busy||needsConnection)&&styles.disabled]}><Text style={{color:theme.ember,fontWeight:'800'}}>{busy?'Working…':'Submit again'}</Text></Pressable>:null}
        <Pressable accessibilityRole="button" disabled={busy||needsConnection} onPress={()=>void act('cancel')} style={[styles.button,(busy||needsConnection)&&styles.disabled]}><Text style={{color:theme.danger,fontWeight:'800'}}>Cancel change</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open saved changes and sync status" onPress={()=>router.push('/sync-status' as never)} style={styles.button}><Text style={{color:theme.secondary,fontWeight:'700'}}>Details</Text></Pressable>
      </View>
    </View>;
  }
  const files=attachmentState.items.filter(item=>item.state!=='discarded').length;
  const fileNotice=attachmentState.error?{message:'Attachment recovery needs attention',detail:attachmentState.error,dismissible:false}:files?{message:`${files} attachment ${files===1?'draft is':'drafts are'} on this device only`,detail:'No server backup or shared-record attachment is confirmed. See details before clearing app data.',dismissible:false}:null;
  const notice=available?(offlineSyncNotice(state)??fileNotice):null;if(!notice)return null;
  return <View accessibilityLiveRegion="polite" style={[styles.notice,{backgroundColor:theme.paper,borderColor:theme.divider,paddingTop:8+topInset}]}>
    <View style={styles.copy}><Text style={[styles.title,{color:theme.ink}]}>{notice.message}</Text>{notice.detail&&<Text style={{color:theme.secondary,fontSize:12}}>{notice.detail}</Text>}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="Open saved changes and sync status" onPress={()=>router.push('/sync-status' as never)} style={styles.button}><Text style={{color:theme.ember,fontWeight:'700'}}>Details</Text></Pressable>
    {notice.dismissible&&<Pressable accessibilityRole="button" accessibilityLabel="Dismiss completed sync notices without deleting saved history" onPress={()=>void dismiss()} style={styles.button}><Text style={{color:theme.secondary,fontWeight:'700'}}>Dismiss</Text></Pressable>}
  </View>;
}
const styles=StyleSheet.create({notice:{paddingHorizontal:16,paddingVertical:8,borderBottomWidth:1,flexDirection:'row',alignItems:'center',gap:10},decision:{flexDirection:'column',alignItems:'stretch'},
  copy:{flex:1,gap:3},title:{fontSize:13,lineHeight:19,fontWeight:'700'},actions:{flexDirection:'row',flexWrap:'wrap',gap:4},button:{minHeight:44,justifyContent:'center',paddingHorizontal:8},disabled:{opacity:.45}});
