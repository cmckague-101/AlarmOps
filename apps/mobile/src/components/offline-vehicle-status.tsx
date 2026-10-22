import {useCallback,useMemo,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import type {SyncRecord} from '@fireops/domain';
import {createDetailChangeActions} from '../lib/offline-attachment-actions';
import type {OfflineDetailEditor} from '../lib/offline-detail-editor';
import {useFireOpsTheme} from '../theme';

type Member={id:string;name:string};
const present=(record:SyncRecord,field:string)=>Object.prototype.hasOwnProperty.call(record,field);

/** Saved status/assignment changes; overlaps with someone else's change go to owner/admin review. */
/** With `self`, crew mode: claim a Ready vehicle, release one's own, clear its fire (the server role trigger decides). */
export function OfflineVehicleStatus({editor,entityId,record,crew,self,onSaved}:{editor:OfflineDetailEditor;entityId:string;record:SyncRecord;crew:readonly Member[];self?:Member;onSaved?:()=>void}){
  const theme=useFireOpsTheme();const live=useRef(true);const current=useRef(editor);current.current=editor;
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current===editor;
  const actions=useMemo(()=>createDetailChangeActions({isCurrent,prepare:()=>editor.prepare({entityType:'vehicle',entityId}),save:(draft,values,extras)=>editor.save(draft,values,extras)}),[editor,entityId]);
  const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [saved,setSaved]=useState('');const [error,setError]=useState('');
  const run=async(label:string,task:()=>Promise<boolean>)=>{
    if(busy)return;setBusy(true);setError('');
    try{if(await task()&&isCurrent()){setFailed(false);setSaved(label);onSaved?.()}}
    catch(failure){if(isCurrent()){setFailed(!!actions.pendingKey);setError(failure instanceof Error?failure.message:'Change could not be saved. Retry keeps the same change.')}}
    finally{if(isCurrent())setBusy(false)}
  };
  const clearing=(draft:SyncRecord)=>['assignedTo','assignedFire'].filter(field=>present(draft,field));
  const setStatus=(status:'Ready'|'Out of service')=>run(`Status: ${status}`,()=>actions.start(status,draft=>({values:{status},extras:{remove:clearing(draft.record)}})));
  const assign=(member:Member)=>run(`Assigned to ${member.name}`,()=>actions.start(`assign:${member.id}`,()=>({values:{status:'Assigned',assignedTo:member.id}})));
  const unassign=()=>run('Assignment cleared',()=>actions.start('unassign',draft=>({values:{status:draft.record.status==='Assigned'?'Ready':draft.record.status as string},extras:{remove:clearing(draft.record)}})));
  const clearFire=()=>run('Fire assignment cleared',()=>actions.start('fire',()=>({values:{},extras:{remove:['assignedFire']}})));
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable key={label} accessibilityRole="button" disabled={disabled||busy} onPress={action} style={{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled||busy?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  const assignee=crew.find(member=>member.id===record.assignedTo)?.name??(typeof record.assignedTo==='string'?'Company member':null);
  const fire=record.assignedFire&&typeof record.assignedFire==='object'?(record.assignedFire as {name?:unknown}).name:null;
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Status & assignment</Text>
    <Text style={meta}>Downloaded: {String(record.status??'Unknown')}{assignee?` · assigned to ${assignee}`:''}{typeof fire==='string'?` · ${fire}`:''}. Changes are saved on device and checked against the current server state; if someone else changed status or assignment meanwhile, an owner/admin chooses. Assigning a fire requires a connection.</Text>
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
    {saved&&!failed?<Text accessibilityRole="alert" style={body}>{saved} — saved on device, waiting to sync.</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
  </View>;
}
