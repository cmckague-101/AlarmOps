import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,Text,TextInput,View} from 'react-native';
import type {SyncRecord} from '@fireops/domain';
import {createDetailChangeActions} from '../lib/offline-attachment-actions';
import {offlineVehicleChange,offlineVehicleChangeKey,type OfflineVehicleChange} from '../lib/offline-vehicle-changes';
import type {OfflineDetailEditor} from '../lib/offline-detail-editor';
import {readFireList,type DownloadedFire,type DownloadedFireList} from '../lib/offline-fire-list';
import {useFireOpsTheme} from '../theme';

type Member={id:string;name:string};
const present=(record:SyncRecord,field:string)=>Object.prototype.hasOwnProperty.call(record,field);

/** Saved status/assignment changes; if someone else changed them meanwhile, the user is warned and decides. */
/** With `self`, crew mode: claim a Ready vehicle, release one's own, clear its fire (the server role trigger decides). */
export function OfflineVehicleStatus({editor,entityId,record,crew,self,onSaved}:{editor:OfflineDetailEditor;entityId:string;record:SyncRecord;crew:readonly Member[];self?:Member;onSaved?:()=>void}){
  const theme=useFireOpsTheme();const live=useRef(true);const current=useRef(editor);current.current=editor;
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current===editor;
  const actions=useMemo(()=>createDetailChangeActions({isCurrent,prepare:()=>editor.prepare({entityType:'vehicle',entityId}),save:(draft,values,extras)=>editor.save(draft,values,extras)}),[editor,entityId]);
  // Fires come from the last list loaded online (decided policy); the server still checks the assignment.
  const [fires,setFires]=useState<DownloadedFireList|null>(null);const [fireQuery,setFireQuery]=useState('');
  useEffect(()=>{let live=true;void readFireList().then(list=>{if(live)setFires(list)});return()=>{live=false}},[]);
  const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [saved,setSaved]=useState('');const [error,setError]=useState('');
  const run=async(label:string,task:()=>Promise<boolean>)=>{
    if(busy)return;setBusy(true);setError('');
    try{if(await task()&&isCurrent()){setFailed(false);setSaved(label);onSaved?.()}}
    catch(failure){if(isCurrent()){setFailed(!!actions.pendingKey);setError(failure instanceof Error?failure.message:'Change could not be saved. Retry keeps the same change.')}}
    finally{if(isCurrent())setBusy(false)}
  };
  const change=(label:string,next:OfflineVehicleChange)=>run(label,()=>actions.start(offlineVehicleChangeKey(next),draft=>offlineVehicleChange(next,draft.record)));
  const setStatus=(status:'Ready'|'Out of service')=>change(`Status: ${status}`,{kind:'status',status});
  const assign=(member:Member)=>change(`Assigned to ${member.name}`,{kind:'assign',memberId:member.id});
  const unassign=()=>change('Assignment cleared',{kind:'unassign'});
  const assignFire=(fire:DownloadedFire)=>change(`Fire: ${fire.name}`,{kind:'fire',fire});
  const clearFire=()=>change('Fire assignment cleared',{kind:'clearFire'});
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable key={label} accessibilityRole="button" disabled={disabled||busy} onPress={action} style={{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled||busy?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  const assignee=crew.find(member=>member.id===record.assignedTo)?.name??(typeof record.assignedTo==='string'?'Company member':null);
  const fire=record.assignedFire&&typeof record.assignedFire==='object'?(record.assignedFire as {name?:unknown}).name:null;
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Status & assignment</Text>
    <Text style={meta}>Downloaded: {String(record.status??'Unknown')}{assignee?` · assigned to ${assignee}`:''}{typeof fire==='string'?` · ${fire}`:''}. Changes are saved on device and checked against the current server state; if someone else changed status or assignment meanwhile, you are warned and can submit again or cancel. Fires come from the list last downloaded{fires?` (${new Date(fires.savedAt).toLocaleString()})`:''}.</Text>
    {failed?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(busy?'Saving on device…':'Retry saving this change',()=>void run(saved||'Change',()=>actions.retry()))}{button('Cancel this change',()=>{actions.cancel();setFailed(false);setError('')})}</View>:self?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {record.status==='Ready'&&!present(record,'assignedTo')?button('Claim this vehicle',()=>void assign(self)):null}
      {record.assignedTo===self.id?button('Release this vehicle',()=>void unassign()):null}
      {record.assignedTo===self.id&&present(record,'assignedFire')?button('Clear fire assignment',()=>void clearFire()):null}
      {record.status!=='Ready'&&record.assignedTo!==self.id?<Text style={meta}>Only Ready, unassigned vehicles can be claimed.</Text>:null}
    </View>:<>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {button('Mark Ready',()=>void setStatus('Ready'),record.status==='Ready'&&!present(record,'assignedTo'))}
        {button('Mark Out of Service',()=>void setStatus('Out of service'),record.status==='Out of service')}
        {present(record,'assignedTo')?button('Clear assignment',()=>void unassign()):null}
        {present(record,'assignedFire')?button('Clear fire assignment',()=>void clearFire()):null}
      </View>
      {crew.length?<><Text style={[body,{fontWeight:'700'}]}>Assign to</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{crew.map(member=>button(member.name,()=>void assign(member),record.assignedTo===member.id))}</View></>:<Text style={meta}>Crew list unavailable on this device; assignment needs a connection.</Text>}
    </>}
    {!failed&&present(record,'assignedTo')&&(!self||record.assignedTo===self.id)?<FirePicker fires={fires} query={fireQuery} onQuery={setFireQuery} current={typeof fire==='string'?fire:null} onPick={fire=>void assignFire(fire)} button={button} meta={meta}/>:null}
    {saved&&!failed?<Text accessibilityRole="alert" style={body}>{saved} — saved on device, waiting to sync.</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
  </View>;
}

function FirePicker({fires,query,onQuery,current,onPick,button,meta}:{fires:DownloadedFireList|null;query:string;onQuery:(value:string)=>void;current:string|null;onPick:(fire:DownloadedFire)=>void;button:(label:string,action:()=>void,disabled?:boolean)=>React.ReactNode;meta:object}){
  const theme=useFireOpsTheme();
  if(!fires?.fires.length)return <Text style={meta}>No fire list on this device yet. Open Operations or a vehicle while online to download it.</Text>;
  const term=query.trim().toLowerCase();const matches=term?fires.fires.filter(fire=>fire.name.toLowerCase().includes(term)||fire.state.toLowerCase()===term).slice(0,20):[];
  return <View style={{gap:8}}>
    <Text style={[meta,{fontWeight:'700'}]}>Assign fire (downloaded {new Date(fires.savedAt).toLocaleString()})</Text>
    <TextInput accessibilityLabel="Search downloaded fires" value={query} onChangeText={onQuery} placeholder="Search fire name or state" placeholderTextColor={theme.secondary} style={{minHeight:44,borderWidth:1,borderColor:theme.divider,borderRadius:10,paddingHorizontal:12,color:theme.ink}}/>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{matches.map(fire=>button(`${fire.name} (${fire.state})`,()=>onPick(fire),fire.name===current))}</View>
  </View>;
}
