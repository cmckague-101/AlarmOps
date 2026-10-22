import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Alert,Pressable,Text,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {createAttachmentDraftActions} from '../lib/offline-attachment-actions';
import type {OfflineAttachmentController,AttachmentDraftState} from '../lib/offline-attachment-controller';
import {useFireOpsTheme} from '../theme';
export function OfflineAttachmentDrafts({controller,state}:{controller:OfflineAttachmentController;state:AttachmentDraftState}){
  const theme=useFireOpsTheme();const current=useRef(controller);current.current=controller;const live=useRef(true);const [pickerError,setPickerError]=useState('');
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current===controller;
  const actions=createAttachmentDraftActions({controller,isCurrent,pickOriginal:async()=>{
    const picked=await DocumentPicker.getDocumentAsync({type:'*/*',multiple:false,copyToCacheDirectory:true});return picked.canceled?null:picked.assets[0]?.uri??null;
  },confirmDiscard:()=>new Promise(resolve=>Alert.alert('Discard this unbound device file?','This permanently removes this app-managed device copy. Metadata remains. Original picker files and server files are not deleted. Referenced files cannot be discarded.',[{text:'Keep file',style:'cancel',onPress:()=>resolve(false)},{text:'Discard device copy',style:'destructive',onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}))});
  const perform=async(task:()=>Promise<unknown>)=>{setPickerError('');try{await task()}catch(error){if(isCurrent())setPickerError(error instanceof Error?error.message:'Attachment recovery could not be confirmed.')}};
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{minHeight:48,padding:12,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  if(!state.items.length&&!state.error&&!state.checking)return null;
  const busy=state.checking||!!state.busyId;
  const status=(value:AttachmentDraftState['items'][number])=>({staging:'Incomplete copy — save not confirmed',ready:state.checked?'Verified local copy — not uploaded':'Recorded ready — availability unconfirmed',missing:'Device copy unavailable or unverified',discarding:'Device cleanup pending',discarded:'Discarded locally — metadata retained'})[value.state];
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Device attachment drafts</Text>
    <Text style={meta}>Only this account and company. These are not uploaded or attached to shared records. File editing/upload workflows remain online-only. This foundation does not encrypt stored bytes; sensitive-file intake is not enabled.</Text>
    {state.checking&&<Text accessibilityLiveRegion="polite" style={meta}>Checking retained device files…</Text>}
    {!!(state.error||pickerError)&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{pickerError||state.error}</Text>}
    {button('Verify files / resume interrupted cleanup',()=>void perform(()=>controller.recover()),busy)}
    {state.items.map(item=><View key={item.attachmentId} style={{gap:8,paddingVertical:12,borderTopWidth:1,borderColor:theme.divider}}>
      <Text selectable style={[body,{fontWeight:'700'}]}>{item.name}</Text><Text style={body}>{status(item)}</Text>
      <Text selectable style={meta}>{item.entityType} · {item.entityId} · {item.byteSize} bytes · Type (reported): {item.mimeType??'Not reported'}</Text>
      <Text selectable style={meta}>Original intent time (device-reported): {new Date(item.savedAt).toLocaleString(undefined,{timeZoneName:'short'})}. Connectivity (reported): {item.connectivity}. Device: {item.deviceId}.</Text>
      <Text selectable style={meta}>SHA-256: {item.sha256}</Text>
      {!!item.operationIds.length&&<Text style={meta}>Referenced by {item.operationIds.length} retained operation(s). No automatic removal, reference release or server upload is enabled.</Text>}
      {!!item.error&&<Text style={{color:theme.danger}}>{item.error}</Text>}
      {!['discarding','discarded'].includes(item.state)&&button('Restore exact original bytes (local only)',()=>void perform(()=>actions.repair(item.attachmentId)),busy)}
      {item.state!=='discarded'&&button('Discard unbound device copy',()=>void perform(()=>actions.discard(item.attachmentId)),busy||!!item.operationIds.length)}
    </View>)}
  </View>;
}
