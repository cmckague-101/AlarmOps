import {useEffect,useRef,useState} from 'react';
import {isSyncReviewUnavailable,type SyncRecord} from '@fireops/domain';
import {Stack,useLocalSearchParams,useRouter} from 'expo-router';
import {KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {detailRecordHref,offlineDetailFields,offlineDetailFormChanges,offlineDetailFormValues} from '@/lib/offline-detail-form';
import type {DetailTarget,OfflineDetailDraft,OfflineDetailEditor} from '@/lib/offline-detail-editor';
import {useOfflineSync} from '@/providers/offline-sync-provider';
import {OfflineVehicleDocumentForm} from '@/components/offline-vehicle-document-form';
import {OfflineVehicleFileSlots} from '@/components/offline-vehicle-file-slots';
import {OfflineVehicleStatus} from '@/components/offline-vehicle-status';
import {OfflineIssueUpdates} from '@/components/offline-issue-updates';
import {useFleetVehicles} from '@/lib/fleet-store';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

export default function SavedDetailsScreen(){
  const {entityType,entityId}=useLocalSearchParams<{entityType?:string;entityId?:string}>();
  const {access,session,demoMode}=useSession();const {detailEditor,loading,refresh}=useOfflineSync();const theme=useFireOpsTheme();
  const member=access.status==='ready'&&access.value?.kind==='member'&&access.value.user.id===session?.user.id?access.value:null;
  const manager=member?.user.role==='owner'||member?.user.role==='admin';
  const crew=member?.user.role==='fire_fighter'||member?.user.role==='shop_tech'||member?.user.role==='accounting';
  const valid=(entityType==='vehicle'||entityType==='issue')&&typeof entityId==='string'&&!!entityId;
  if(!(manager||crew)||!valid||!detailEditor||demoMode||Platform.OS==='web')return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]} edges={['bottom']}>
    <Stack.Screen options={{title:'Saved detail editor'}}/>
    <View style={styles.content}><Text accessibilityRole="alert" style={{color:theme.ink}}>{Platform.OS==='web'||demoMode?'Offline detail editing is available only in the installed mobile app with real company access.':!(manager||crew)?access.status==='loading'||access.status==='idle'?'Checking company access…':'Current company membership is required.':!valid?'Invalid record link.':loading?'Opening device sync storage…':'Device sync storage is unavailable. Existing online editors remain available. Saved work has not been discarded.'}</Text>
      {(manager||crew)&&valid&&!loading&&!demoMode&&Platform.OS!=='web'?<Pressable accessibilityRole="button" onPress={()=>void refresh()} style={styles.button}><Text style={{color:theme.ember}}>Retry device storage</Text></Pressable>:null}</View>
  </SafeAreaView>;
  return <DetailForm key={`${member.user.id}:${member.company.id}:${member.user.role}:${entityType}:${entityId}`} editor={detailEditor} target={{entityType,entityId}} user={{id:member.user.id,name:member.user.name}} companyId={member.company.id} crewMode={!manager}/>;
}

function DetailForm({editor,target,user,companyId,crewMode}:{editor:OfflineDetailEditor;target:DetailTarget;user:{id:string;name:string};companyId:string;crewMode:boolean}){
  const {crew}=useFleetVehicles(companyId);const activeCrew=crew.filter(member=>member.status==='Active');
  const theme=useFireOpsTheme();const router=useRouter();const {offline,state:syncState,attachmentController,syncAttachments,userSync}=useOfflineSync();
  const hasDownload=syncState.records.some(record=>record.entityType===target.entityType&&record.entityId===target.entityId&&record.record!==null);
  const [downloadedOnly,setDownloadedOnly]=useState(false);
  const [draft,setDraft]=useState<OfflineDetailDraft|null>(null);const [form,setForm]=useState<Record<string,string>>({});
  const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [attempt,setAttempt]=useState(0);
  const [saving,setSaving]=useState(false);const [frozen,setFrozen]=useState(false);const [saved,setSaved]=useState(false);
  const [retryValues,setRetryValues]=useState<SyncRecord|null>(null);const busy=useRef(false);const generation=useRef(0);
  useEffect(()=>{
    const version=++generation.current;const current=()=>generation.current===version;
    busy.current=false;setSaving(false);setDraft(null);setForm({});setError('');setLoading(true);setFrozen(false);setSaved(false);setRetryValues(null);
    void editor.prepare(target,{downloadedOnly}).then(value=>{if(current()){setDraft(value);setForm(offlineDetailFormValues(value))}}).catch(failure=>{
      if(!current())return;
      setError(isSyncReviewUnavailable(failure)?'Database sync setup pending. Existing online editors remain available. A previously verified download can be used for device-only work; upload waits for setup.':failure instanceof Error?failure.message:typeof failure?.message==='string'?failure.message:'Verified details could not be downloaded.');
    }).finally(()=>{if(current())setLoading(false)});
    return()=>{generation.current++};
  },[editor,target.entityType,target.entityId,attempt,downloadedOnly]);
  const save=async()=>{
    if(!draft||busy.current||saved)return;
    let values:SyncRecord;
    try{values=retryValues??offlineDetailFormChanges(draft,form)}catch(failure){setError(failure instanceof Error?failure.message:'Check detail fields.');return}
    const version=generation.current;const current=()=>generation.current===version;
    busy.current=true;setSaving(true);setFrozen(true);setRetryValues(values);setError('');
    try{await editor.save(draft,values);if(current())setSaved(true)}
    catch(failure){if(current())setError(failure instanceof Error?failure.message:'Save could not be confirmed. Keep original values and retry.')}
    finally{if(current()){busy.current=false;setSaving(false)}}
  };
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]} edges={['bottom']}>
    <Stack.Screen options={{title:`${target.entityType==='vehicle'?'Vehicle':'Issue'} saved details`,gestureEnabled:!saving}}/>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={90}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={[styles.title,{color:theme.ink}]}>{saved?'Submitted detail copy':'Saved detail editor'}</Text>
        <Text style={{color:theme.secondary}}>{crewMode?(target.entityType==='vehicle'?'Claim, release or clear the fire on this vehicle offline.':'Add notes offline to issues you reported, and resolve or reopen them with a note.'):<>Owner/admin details, {target.entityType==='vehicle'?'status/assignment, vehicle files and new vehicle documents':'notes and resolve/reopen'} only.</>} Open this editor online once per record before using it offline. Fire assignment, inspections and other workflows require a connection.</Text>
        {saved?<Text accessibilityRole="alert" style={[styles.label,{color:theme.ink}]}>Saved on device. Values below are your submitted version, not confirmed shared data.</Text>:null}
        {loading?<Text style={{color:theme.secondary}}>Loading verified details…</Text>:null}
        {draft&&!crewMode?<>
          <Text style={{color:theme.secondary}}>{draft.pendingParentId?'Local continuation; downloaded server revision':'Edit base: verified revision'} {draft.revision} · Downloaded {new Date(draft.verifiedAt).toLocaleString()} (device time). {offline||downloadedOnly?'Using downloaded values; current server data may differ.':'Independent online changes can merge; overlaps require review.'}</Text>
          {offlineDetailFields[target.entityType].map(([field,label])=><View key={field} style={styles.field}>
            <Text style={[styles.label,{color:theme.ink}]}>{label}</Text>
            {field==='priority'?<View style={styles.choices}>{['Low','Medium','High','Critical'].map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:form[field]===value,disabled:frozen}} disabled={frozen} onPress={()=>setForm(current=>({...current,[field]:value}))} style={[styles.choice,{borderColor:form[field]===value?theme.ember:theme.divider}]}><Text style={{color:form[field]===value?theme.ember:theme.ink}}>{value}</Text></Pressable>)}</View>:<TextInput accessibilityLabel={label} editable={!frozen} value={form[field]??''} onChangeText={value=>setForm(current=>({...current,[field]:value}))} keyboardType={field==='year'?'number-pad':'default'} autoCapitalize={field==='vin'||field==='plate'?'characters':'sentences'} multiline={field==='notes'||field==='description'} maxLength={field==='year'?4:field==='notes'||field==='description'?10000:field==='vin'?17:field==='plate'?20:200} textAlignVertical="top" style={[styles.input,{color:theme.ink,borderColor:theme.divider,backgroundColor:theme.paper},(field==='notes'||field==='description')&&styles.multiline]}/>}
          </View>)}
        </>:null}
        {draft&&target.entityType==='vehicle'?<OfflineVehicleStatus editor={editor} entityId={target.entityId} record={draft.record} crew={crewMode?[]:activeCrew} self={crewMode?user:undefined}/>:null}
        {draft&&target.entityType==='issue'&&(!crewMode||draft.record.createdById===user.id)?<OfflineIssueUpdates editor={editor} entityId={target.entityId} record={draft.record} user={user} notesOnly={crewMode}/>:null}
        {draft&&crewMode&&target.entityType==='issue'&&draft.record.createdById!==user.id?<Text style={{color:theme.secondary}}>You can add offline notes only to issues you reported.</Text>:null}
        {draft&&!crewMode&&target.entityType==='vehicle'&&attachmentController?<OfflineVehicleFileSlots editor={editor} controller={attachmentController} entityId={target.entityId} record={draft.record} onSaved={syncAttachments}/>:null}
        {draft&&!crewMode&&target.entityType==='vehicle'&&attachmentController?<OfflineVehicleDocumentForm controller={attachmentController} entityId={target.entityId} onSaved={syncAttachments} documents={Array.isArray(draft.record.documents)?(draft.record.documents as SyncRecord[]).filter(document=>typeof document.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(document.id)):[]} onRemove={userSync?document=>userSync.removeVehicleDocument(target.entityId,document):undefined}/>:null}
        {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
        {crewMode?null:saved?<View style={styles.field}><Text style={{color:theme.secondary}}>Check Saved changes & sync for uploading, review or completion. Review may keep another version. Return to the record for current shared data.</Text><Pressable accessibilityRole="button" onPress={()=>router.replace('/sync-status' as never)} style={styles.button}><Text style={{color:theme.ember}}>Saved changes & sync</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>router.dismissTo(detailRecordHref(target))} style={styles.button}><Text style={{color:theme.ember}}>Back to record</Text></Pressable></View>:draft?<>
          <Text style={{color:theme.secondary}}>Changes are not saved until Save on device completes. Leaving before Save discards entered values. Do not uninstall or clear app data before changes sync. Later edits wait for earlier changes. Conflicting changes or a changed review outcome require explicit rebase before upload.</Text>
          {frozen&&!saving?<Text style={{color:theme.secondary}}>Original values are locked for safe retry. This save is not confirmed; keep this editor open to retry. Reopen editor to start a different edit.</Text>:null}
          <Pressable accessibilityRole="button" disabled={saving} onPress={()=>void save()} style={[styles.button,{backgroundColor:theme.ember},saving&&styles.disabled]}><Text style={styles.buttonLabel}>{saving?'Saving on device…':frozen?'Retry original save':'Save on device'}</Text></Pressable>
        </>:!loading?<Pressable accessibilityRole="button" onPress={()=>{setDownloadedOnly(false);setAttempt(value=>value+1)}} style={styles.button}><Text style={{color:theme.ember}}>Retry verified download</Text></Pressable>:null}
        {!loading&&!draft&&hasDownload&&!downloadedOnly?<Pressable accessibilityRole="button" onPress={()=>setDownloadedOnly(true)} style={styles.button}><Text style={{color:theme.ember}}>Use verified download instead</Text></Pressable>:null}
        {!saved?<Pressable accessibilityRole="button" onPress={()=>router.push('/sync-status' as never)} style={styles.button}><Text style={{color:theme.ember}}>Saved changes & sync</Text></Pressable>:null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1},content:{padding:20,gap:16,paddingBottom:40},title:{fontSize:24,fontWeight:'800'},field:{gap:8},label:{fontSize:15,fontWeight:'700'},input:{borderWidth:1,borderRadius:10,minHeight:48,padding:12,fontSize:16},multiline:{minHeight:120},choices:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{borderWidth:1,borderRadius:8,padding:12},button:{minHeight:48,padding:12,borderRadius:10,alignItems:'center',justifyContent:'center'},buttonLabel:{color:'#FFFFFF',fontWeight:'700'},disabled:{opacity:.5}});
