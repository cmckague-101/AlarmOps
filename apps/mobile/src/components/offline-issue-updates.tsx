import {useCallback,useMemo,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,Text,TextInput,View} from 'react-native';
import type {SyncRecord} from '@fireops/domain';
import {createDetailChangeActions} from '../lib/offline-attachment-actions';
import type {OfflineDetailEditor} from '../lib/offline-detail-editor';
import {offlineIssueChange,offlineIssueChangeKey,type OfflineIssueChange} from '../lib/offline-issue-changes';
import {useFireOpsTheme} from '../theme';

/** Notes are appended (never conflict). Managers resolve/reopen as a separate change that may need review;
 * crew (`notesOnly`) resolve/reopen together with a note, which never conflicts. */
export function OfflineIssueUpdates({editor,entityId,record,user,notesOnly=false,onSaved}:{editor:OfflineDetailEditor;entityId:string;record:SyncRecord;user:{id:string;name:string};notesOnly?:boolean;onSaved?:()=>void}){
  const theme=useFireOpsTheme();const live=useRef(true);const current=useRef(editor);current.current=editor;
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current===editor;
  const actions=useMemo(()=>createDetailChangeActions({isCurrent,prepare:()=>editor.prepare({entityType:'issue',entityId}),save:(draft,values,extras)=>editor.save(draft,values,extras)}),[editor,entityId]);
  const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [saved,setSaved]=useState('');const [error,setError]=useState('');
  const run=async(label:string,task:()=>Promise<boolean>,after?:()=>void)=>{
    if(busy)return;setBusy(true);setError('');
    try{if(await task()&&isCurrent()){setFailed(false);setSaved(label);after?.();onSaved?.()}}
    catch(failure){if(isCurrent()){setFailed(!!actions.pendingKey);setError(failure instanceof Error?failure.message:'Change could not be saved. Retry keeps the same change.')}}
    finally{if(isCurrent())setBusy(false)}
  };
  const change=(label:string,next:OfflineIssueChange,after?:()=>void)=>void run(label,()=>actions.start(offlineIssueChangeKey(next),draft=>offlineIssueChange(next,draft.record,user)),after);
  const addNote=()=>{const note=text.trim();if(!note){setError('Enter an update.');return}change('Update',{kind:'note',text:note},()=>setText(''))};
  const resolved=record.status==='Resolved';
  const toggleWithNote=()=>{const note=text.trim();if(!note){setError(resolved?'Enter a note to reopen this issue.':'Enter a note to resolve this issue.');return}
    change(resolved?'Reopened with note':'Resolved with note',{kind:'status',status:resolved?'Open':'Resolved',note},()=>setText(''))};
  const toggle=()=>change(resolved?'Reopened':'Resolved',{kind:'status',status:resolved?'Open':'Resolved'});
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled||busy} onPress={action} style={{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled||busy?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Updates & status</Text>
    <Text style={meta}>Downloaded status: {String(record.status??'Open')}. Notes are added to the shared list when synced and never replace other notes. {notesOnly?'Resolve or reopen saves together with your note; if the issue already has that status, only the note is added.':'Resolve/reopen is checked against the current server state; if someone else changed it meanwhile, you are warned and can submit again or cancel.'}</Text>
    {failed?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(busy?'Saving on device…':'Retry saving this change',()=>void run(saved||'Change',()=>actions.retry(),()=>setText('')))}{button('Cancel this change',()=>{actions.cancel();setFailed(false);setError('')})}</View>:<>
      <TextInput accessibilityLabel="Issue update" editable={!busy} value={text} onChangeText={setText} maxLength={2000} multiline textAlignVertical="top" placeholder="Add an update" placeholderTextColor={theme.secondary} style={[body,{borderWidth:1,borderColor:theme.divider,borderRadius:10,minHeight:96,padding:12}]}/>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(busy?'Saving on device…':'Save update on device',addNote,!text.trim())}{notesOnly?button(resolved?'Reopen with this note':'Resolve with this note',toggleWithNote,!text.trim()):button(resolved?'Reopen issue':'Resolve issue',toggle)}</View>
    </>}
    {saved&&!failed?<Text accessibilityRole="alert" style={body}>{saved} — saved on device, waiting to sync.</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
  </View>;
}
