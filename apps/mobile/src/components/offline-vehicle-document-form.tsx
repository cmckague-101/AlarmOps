import {useCallback,useMemo,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,Text,TextInput,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {createVehicleDocumentActions,type PickedVehicleDocument} from '../lib/offline-attachment-actions';
import type {OfflineAttachmentController} from '../lib/offline-attachment-controller';
import {createFleetId} from '../lib/fleet-store';
import {useFireOpsTheme} from '../theme';

/** Saves one vehicle document on device; upload/attach happen later and are confirmed only by the server. */
export function OfflineVehicleDocumentForm({controller,entityId,onSaved}:{controller:OfflineAttachmentController;entityId:string;onSaved?:()=>void}){
  const theme=useFireOpsTheme();const current=useRef(controller);current.current=controller;const live=useRef(true);
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current===controller;
  const actions=useMemo(()=>createVehicleDocumentActions({controller,isCurrent,createId:createFleetId,pick:async()=>{
    const picked=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','image/webp','image/gif','application/pdf'],multiple:false,copyToCacheDirectory:true});
    const asset=picked.canceled?null:picked.assets[0];return asset?{uri:asset.uri,name:asset.name,mimeType:asset.mimeType??null,size:asset.size??null}:null;
  }}),[controller]);
  const [file,setFile]=useState<PickedVehicleDocument|null>(null);const [name,setName]=useState('');const [saving,setSaving]=useState(false);const [saved,setSaved]=useState(false);const [error,setError]=useState('');
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const choose=async()=>{setError('');try{const picked=await actions.choose();if(picked&&isCurrent()){setFile(picked);setSaved(false);setName(value=>value||picked.name.replace(/\.[^.]+$/,''))}}catch(failure){if(isCurrent())setError(failure instanceof Error?failure.message:'File could not be selected.')}};
  const save=async()=>{
    if(saving||saved)return;if(!name.trim()){setError('Enter a document name.');return}
    setSaving(true);setError('');
    try{if(await actions.save(entityId,name)&&isCurrent()){setSaved(true);onSaved?.()}}
    catch(failure){if(isCurrent())setError(failure instanceof Error?failure.message:'Document save could not be confirmed. Retry keeps the same document.')}
    finally{if(isCurrent())setSaving(false)}
  };
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{minHeight:48,padding:12,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Add vehicle document</Text>
    <Text style={meta}>JPEG, PNG, WebP, GIF or PDF up to 8 MB. The file is copied into app storage on this device (not encrypted by FireOps) and uploads when online. It becomes a shared vehicle document only after the server confirms it.</Text>
    {button(file?`Chosen: ${file.name} — choose another`:'Choose file',()=>void choose(),saving||saved)}
    {file?<TextInput accessibilityLabel="Document name" editable={!saving&&!saved} value={name} onChangeText={setName} maxLength={120} style={[body,{borderWidth:1,borderColor:theme.divider,borderRadius:10,minHeight:48,padding:12}]}/>:null}
    {file&&!saved?button(saving?'Saving on device…':'Save document on device',()=>void save(),saving):null}
    {saved?<Text accessibilityRole="alert" style={body}>Saved on device — waiting to upload and attach. Check Saved changes & sync for progress.</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
  </View>;
}
