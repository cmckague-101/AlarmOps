import {useEffect,useMemo,useState,useCallback} from 'react';
import {BackHandler,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Stack,useFocusEffect,useLocalSearchParams,useRouter} from 'expo-router';
import {
  syncReviewAuthorText,syncReviewCanApprove,syncReviewFieldLabel,syncReviewLocked,syncReviewValueText,
  type SyncFieldValue,type SyncReviewFieldProvenance,type SyncReviewTarget,
} from '@fireops/domain';
import {useSyncConflictReview} from '@/lib/use-sync-conflict-review';
import {SyncDeviceHistory} from '../components/sync-device-history';
import {refreshFleet} from '@/lib/fleet-store';
import {useFireOpsTheme} from '@/theme';

const date=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(undefined,{timeZoneName:'short'}):'Not recorded';
function Author({value,receivedAt}:{value?:SyncReviewFieldProvenance;receivedAt?:string}){
  const theme=useFireOpsTheme();
  return <View style={{gap:6}}><Text style={{color:theme.secondary,lineHeight:21}}>{syncReviewAuthorText(value)}</Text>
    <Text style={{color:theme.secondary}}>Device save time (reported): {date(value?.savedAt)}</Text>
    <Text style={{color:theme.secondary}}>Server {receivedAt?'received':'recorded'}: {date(receivedAt??value?.serverRecordedAt)}</Text>
    {value?.deviceId&&<Text style={{color:theme.secondary}}>Device: {value.deviceId}</Text>}
    {value?.approvedBy&&<Text style={{color:theme.secondary}}>Approved by {value.approvedByName||value.approvedBy} · {date(value.approvedAt)}</Text>}
    {value?.origin==='baseline'&&<Text style={{color:theme.secondary}}>Original author and change time were not recorded for this legacy baseline.</Text>}
  </View>;
}
export default function SyncConflictScreen(){
  const theme=useFireOpsTheme();const router=useRouter();
  const params=useLocalSearchParams<{entityType?:string;entityId?:string}>();
  const {controller,state,allowed,offline,demoMode}=useSyncConflictReview();
  const [confirmed,setConfirmed]=useState(false);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const target=useMemo<SyncReviewTarget|null>(()=>typeof params.entityId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.entityId)&&(params.entityType==='vehicle'||params.entityType==='issue')
    ?{entityId:params.entityId.toLowerCase(),entityType:params.entityType}:null,[params.entityId,params.entityType]);
  const locked=syncReviewLocked(state);const review=state.review;
  useEffect(()=>{if(allowed&&target)void controller.openReview(target)},[controller,allowed,target]);
  useEffect(()=>setConfirmed(false),[state.choices,review?.reviewToken]);
  useEffect(()=>setExpanded({}),[review?.reviewToken]);
  useEffect(()=>{if(state.decision)void refreshFleet({showIndicator:false})},[state.decision?.decisionId]);
  useFocusEffect(useCallback(()=>{if(!locked)return;const handler=BackHandler.addEventListener('hardwareBackPress',()=>true);return()=>handler.remove()},[locked]));
  const styles=useMemo(()=>StyleSheet.create({
    safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:20},title:{fontSize:28,fontWeight:'800',color:theme.ink},heading:{fontSize:20,fontWeight:'800',color:theme.ink},body:{fontSize:16,lineHeight:24,color:theme.ink},meta:{fontSize:14,lineHeight:21,color:theme.secondary},notice:{padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper,gap:10},field:{gap:12},option:{padding:16,borderWidth:2,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper,gap:12},selected:{borderColor:theme.ember},radio:{fontSize:16,fontWeight:'800',color:theme.ink},button:{minHeight:48,paddingVertical:13,paddingHorizontal:16,borderWidth:1,borderColor:theme.divider,borderRadius:10,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:16,fontWeight:'700',color:theme.ink},primary:{backgroundColor:theme.ember,borderColor:theme.ember},white:{color:'#FFFFFF'},disabled:{opacity:.5},confirm:{minHeight:48,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper,gap:8},error:{color:theme.danger},pressed:{opacity:.65},value:{fontSize:17,lineHeight:25,color:theme.ink},
  }),[theme]);
  const button=(label:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,primary&&styles.primary,disabled&&styles.disabled,pressed&&styles.pressed]}><Text style={[styles.buttonText,primary&&styles.white]}>{label}</Text></Pressable>;
  const back=()=>{if(controller.closeReview()){if(router.canGoBack())router.back();else router.replace('/(tabs)')}};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Data conflict review',gestureEnabled:!locked,headerBackVisible:!locked}}/>
    <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Text accessibilityRole="header" style={styles.title}>Data conflict review</Text>
      {!allowed?<Text style={styles.meta}>{demoMode?'Conflict review is not available in demo mode.':'Only current company owners and admins can review conflicts.'}</Text>:!target?<Text style={styles.error}>This conflict link is invalid.</Text>:<>
        <Text style={styles.meta}>{target.entityType==='vehicle'?'Vehicle':'Issue'} · {target.entityId}</Text>
        <Text style={styles.body}>Choose the value to keep for each field. Independent changes may be preselected. Approval checks for newer changes.</Text>
        {offline&&<View accessibilityRole="alert" style={styles.notice}><Text style={styles.meta}>Connect to refresh or approve. Any displayed review may be outdated.</Text></View>}
        {state.reviewLoading&&<Text accessibilityLiveRegion="polite" style={styles.meta}>Loading the latest versions…</Text>}
        {!!state.reviewError&&<View accessibilityRole="alert" style={styles.notice}><Text style={styles.error}>{state.reviewError}</Text>{state.approval==='uncertain'?button('Retry approval confirmation',()=>void controller.approve(),offline):!locked&&button('Refresh review',()=>void controller.openReview(target),offline)}</View>}
        {state.decision&&<View accessibilityLiveRegion="polite" style={styles.notice}><Text accessibilityRole="header" style={styles.heading}>Conflict resolved</Text><Text style={styles.body}>{state.decision.outcomes.filter(item=>item.outcome==='kept').length} proposals kept · {state.decision.outcomes.filter(item=>item.outcome==='partially_kept').length} partly kept · {state.decision.outcomes.filter(item=>item.outcome==='not_selected').length} not kept.</Text><Text style={styles.meta}>Approved {date(state.decision.decidedAt)}. Other versions remain in audit history.</Text>{button('Return to dashboard',back)}</View>}
        <SyncDeviceHistory key={`${target.entityType}:${target.entityId}`} controller={controller.history} offline={offline}/>
        {review&&<>
          <View style={styles.notice}><Text style={styles.body}>{review.candidates.length} competing {review.candidates.length===1?'proposal':'proposals'} · Shared revision {review.currentRevision}</Text><Text style={styles.meta}>Device times and connection labels are reported by the app. Server times are listed separately.</Text></View>
          {(review.currentRecord===null||review.candidates.some(item=>item.lifecycleChanged||item.reason!=='fields'))&&<View style={styles.notice}><Text style={styles.heading}>Record lifecycle changed</Text><Text style={styles.body}>{review.currentRecord===null?'This record was deleted. It can only be kept deleted here; restoring it requires a separate workflow.':'This record was deleted or re-created. Review every choice explicitly; only selected detail fields will change.'}</Text>{review.currentRecord===null&&button('Keep record deleted',()=>{setConfirmed(false);Object.keys(review.fields).forEach(key=>controller.choose(key,'current'))},locked)}</View>}
          {Object.entries(review.fields).map(([key,field])=><View style={styles.field} key={key}><Text accessibilityRole="header" style={styles.heading}>{syncReviewFieldLabel(key)}</Text>
            <Pressable accessibilityRole="radio" accessibilityLabel={`${syncReviewFieldLabel(key)}: keep current shared value`} accessibilityState={{checked:state.choices[key]==='current',disabled:locked}} disabled={locked} onPress={()=>{setConfirmed(false);controller.choose(key,'current')}} style={({pressed})=>[styles.option,state.choices[key]==='current'&&styles.selected,pressed&&styles.pressed]}><Text style={styles.radio}>{state.choices[key]==='current'?'◉':'○'} Current shared value</Text><Text selectable style={styles.value}>{review.currentRecord===null?'Record deleted':syncReviewValueText(field.current)}</Text><Author value={review.currentProvenance[key]}/></Pressable>
            {field.options.map(option=>{
              const candidate=review.candidates.find(item=>item.id===option.source)!;
              const original:SyncFieldValue=Object.prototype.hasOwnProperty.call(candidate.baseRecord,key)?{present:true,value:candidate.baseRecord[key]}:{present:false};
              const id=`${key}:${option.source}`;const disabled=locked||review.currentRecord===null;
              return <View key={option.source} style={[styles.option,state.choices[key]===option.source&&styles.selected]}><Pressable accessibilityRole="radio" accessibilityLabel={`${syncReviewFieldLabel(key)}: keep proposed value by ${option.provenance.actorName||'company user'}`} accessibilityState={{checked:state.choices[key]===option.source,disabled}} disabled={disabled} onPress={()=>{setConfirmed(false);controller.choose(key,option.source)}} style={{minHeight:48,justifyContent:'center',gap:10}}><Text style={[styles.radio,disabled&&styles.disabled]}>{state.choices[key]===option.source?'◉':'○'} Proposed value · {option.source.slice(-8)}</Text><Text selectable style={styles.value}>{syncReviewValueText(option.value)}</Text></Pressable><Author value={option.provenance} receivedAt={candidate.receivedAt}/>{button(expanded[id]?'Hide submitted base':'Show submitted base',()=>setExpanded(previous=>({...previous,[id]:!previous[id]})))}{expanded[id]&&<Text selectable style={styles.meta}>Submitted verified base: {syncReviewValueText(original)}. Later device edits may use a rebased download, not their original local view. Earlier device versions are recorded separately as device-reported history.</Text>}</View>;
            })}
          </View>)}
          {!Object.keys(review.fields).length&&<Text style={styles.body}>No field values differ. Review the record lifecycle before approving.</Text>}
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked:confirmed,disabled:locked}} disabled={locked} onPress={()=>setConfirmed(value=>!value)} style={styles.confirm}><Text style={styles.radio}>{confirmed?'☑':'☐'} Confirm selections</Text><Text style={styles.body}>I approve the selected values. Other proposed values will be discarded from active data and kept in audit history.</Text></Pressable>
          {button(state.approval==='saving'?'Confirming approval…':'Approve selected values',()=>{if(confirmed)void controller.approve()},offline||!confirmed||!syncReviewCanApprove(state),true)}
          {!syncReviewCanApprove(state)&&!locked&&<Text accessibilityLiveRegion="polite" style={styles.meta}>Choose a source for every field before approving.</Text>}
          {locked&&<Text accessibilityLiveRegion="polite" style={styles.meta}>Keep this review open until approval is confirmed. Retrying uses the same request and cannot approve twice.</Text>}
        </>}
        {!locked&&!state.decision&&button('Return to dashboard',back)}
      </>}
      {(!allowed||!target)&&button('Return to dashboard',()=>router.replace('/(tabs)'))}
    </ScrollView>
  </SafeAreaView>;
}
