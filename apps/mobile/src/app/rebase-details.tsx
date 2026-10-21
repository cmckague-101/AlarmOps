import {useEffect,useRef,useState} from 'react';
import {Alert,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {Stack,useLocalSearchParams,useRouter} from 'expo-router';
import {SectionScreen} from '../components/section-screen';
import {useOfflineSync} from '../providers/offline-sync-provider';
import {useSession} from '../providers/session-provider';
import {useFireOpsTheme} from '../theme';
import {rebaseChoicesComplete,rebaseFieldText} from '../lib/offline-rebase-form';
import type {OfflineDetailEditor} from '../lib/offline-detail-editor';
import type {ContinuationReview} from '../lib/offline-outbox';

export default function RebaseDetailsScreen(){
  const {operationId}=useLocalSearchParams<{operationId?:string}>();const {detailEditor}=useOfflineSync();const {access,session,demoMode}=useSession();
  const member=access.status==='ready'&&access.value?.kind==='member'&&access.value.user.id===session?.user.id?access.value:null;
  const manager=member?.user.role==='owner'||member?.user.role==='admin';
  if(Platform.OS==='web'||demoMode||!manager||!detailEditor||typeof operationId!=='string'||!operationId)return <SectionScreen title="Later saved edit" description="This review requires current company owner/admin access in the installed mobile app."/>;
  return <RebaseForm key={`${member.user.id}:${member.company.id}:${member.user.role}:${operationId}`} editor={detailEditor} operationId={operationId}/>;
}
function RebaseForm({editor,operationId}:{editor:OfflineDetailEditor;operationId:string}){
  const theme=useFireOpsTheme();const router=useRouter();const {offline,state}=useOfflineSync();
  const [review,setReview]=useState<ContinuationReview|null>(null);const [choices,setChoices]=useState<Record<string,'current'|'saved'>>({});
  const [downloadedOnly,setDownloadedOnly]=useState(false);const [attempt,setAttempt]=useState(0);const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);const [error,setError]=useState('');const generation=useRef(0);const saving=useRef(false);
  useEffect(()=>{
    const version=++generation.current;const current=()=>generation.current===version;setReview(null);setChoices({});setLoading(true);setError('');setSaved(false);setBusy(false);saving.current=false;
    void editor.prepareRebase(operationId,{downloadedOnly}).then(value=>{if(current())setReview(value)}).catch(failure=>{if(current())setError(failure instanceof Error?failure.message:'Rebase review could not be loaded.')}).finally(()=>{if(current())setLoading(false)});
    return()=>{generation.current++};
  },[editor,operationId,attempt,downloadedOnly]);
  const save=async()=>{
    if(!review||saving.current||saved||!rebaseChoicesComplete(review,choices))return;
    const version=generation.current;const current=()=>generation.current===version;saving.current=true;setBusy(true);setError('');
    try{await editor.rebase(review,choices);if(current())setSaved(true)}catch(failure){if(current())setError(failure instanceof Error?failure.message:'Rebase could not be confirmed. Keep your choices and retry.')}finally{if(current()){saving.current=false;setBusy(false)}}
  };
  const confirm=()=>Alert.alert('Rebase this later edit?','Chosen values will replace pending device work. Discarded saved values remain in local rebase history. This is not server approval; permissions and conflicts are checked again on upload.',[{text:'Cancel',style:'cancel'},{text:'Rebase on device',onPress:()=>void save()}]);
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={[styles.button,{borderColor:theme.divider},disabled&&{opacity:.5}]}><Text style={{color:theme.ember,fontWeight:'700'}}>{label}</Text></Pressable>;
  const parent=review?state.entries.find(entry=>entry.operation.operationId===review.parentId):null;
  return <SectionScreen title="Review later device edit" description="Explicit local rebase, not conflict approval. Nothing is uploaded until this device decision is committed and sync runs.">
    <Stack.Screen options={{title:'Review later edit'}}/>
    {loading?<Text style={{color:theme.secondary}}>Loading verified values…</Text>:null}
    {!!error&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>}
    {review?<>
      <Text style={{color:theme.secondary}}>Your later edit: {new Date(review.operation.provenance.savedAt).toLocaleString()} (device time), {review.operation.provenance.connectivity} (reported by app). Shared download revision {review.current.revision}. {offline||downloadedOnly?'Downloaded values may be stale; server will recheck.':'Live values were downloaded for this review.'}</Text>
      {parent?.reviewOutcome?<Text style={{color:theme.secondary}}>Earlier review: {parent.reviewOutcome.outcome}. Kept: {parent.reviewOutcome.keptFields.join(', ')||'None'}. Discarded: {parent.reviewOutcome.discardedFields.join(', ')||'None'}. Those discarded parent fields are not automatically resubmitted.</Text>:null}
      {Object.entries(review.fields).map(([field,values])=><View key={field} style={[styles.field,{borderColor:theme.divider}]}>
        <Text style={[styles.title,{color:theme.ink}]}>{field}</Text>
        <Text selectable style={{color:theme.secondary}}>Local view when saved: {rebaseFieldText(values.before)}</Text>
        <Text selectable style={{color:theme.ink}}>Downloaded shared value: {rebaseFieldText(values.current)}</Text>
        <Text selectable style={{color:theme.ink}}>Your saved value: {rebaseFieldText(values.saved)}</Text>
        {button(choices[field]==='current'?'✓ Keep downloaded value':'Keep downloaded value',()=>setChoices(previous=>({...previous,[field]:'current'})),busy||saved)}
        {button(choices[field]==='saved'?'✓ Keep saved value':'Keep saved value',()=>setChoices(previous=>({...previous,[field]:'saved'})),busy||saved)}
      </View>)}
      {saved?<Text accessibilityRole="alert" style={{color:theme.ink,fontWeight:'700'}}>Rebased on device. Original values remain in local history. See sync status for the shared result.</Text>:button(busy?'Saving local decision…':'Confirm chosen values / rebase',confirm,busy||!rebaseChoicesComplete(review,choices))}
    </>:null}
    {!saved&&button('Refresh rebase review',()=>{setDownloadedOnly(false);setAttempt(value=>value+1)},busy||loading)}
    {!review&&!loading&&!downloadedOnly&&button('Use verified download instead',()=>setDownloadedOnly(true),busy)}
    {button('Saved changes & sync',()=>router.replace('/sync-status' as never),busy)}
  </SectionScreen>;
}
const styles=StyleSheet.create({field:{paddingVertical:16,borderBottomWidth:1,gap:8},title:{fontSize:17,fontWeight:'800'},button:{minHeight:48,padding:12,borderWidth:1,borderRadius:10,justifyContent:'center',alignItems:'center',marginVertical:6}});
