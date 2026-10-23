import {useCallback,useMemo,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {syncReviewFieldLabel,vehicleFileSlots,type SyncRecord,type VehicleFileSlot} from '@fireops/domain';
import {createVehicleSlotActions} from '../lib/offline-attachment-actions';
import type {OfflineAttachmentController} from '../lib/offline-attachment-controller';
import type {OfflineDetailEditor} from '../lib/offline-detail-editor';
import {createFleetId} from '../lib/fleet-store';
import {useFireOpsTheme} from '../theme';

const fileName=(value:SyncRecord[string]|undefined)=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as {name?:unknown}).name==='string'?(value as {name:string}).name:null;

/** Each replacement/clear is its own saved change; if someone else changed the slot meanwhile, the user is warned and decides. */
export function OfflineVehicleFileSlots({editor,controller,entityId,record,onSaved}:{editor:OfflineDetailEditor;controller:OfflineAttachmentController;entityId:string;record:SyncRecord;onSaved?:()=>void}){
  const theme=useFireOpsTheme();const live=useRef(true);const current=useRef({editor,controller});current.current={editor,controller};
  useFocusEffect(useCallback(()=>{live.current=true;return()=>{live.current=false}},[]));
  const isCurrent=()=>live.current&&current.current.editor===editor&&current.current.controller===controller;
  const actions=useMemo(()=>createVehicleSlotActions({entityId,isCurrent,createId:createFleetId,
    stage:input=>controller.stageVehicleFile(input),prepare:()=>editor.prepare({entityType:'vehicle',entityId}),save:(draft,values,extras)=>editor.save(draft,values,extras),
    pick:async()=>{const picked=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','image/webp','image/gif','application/pdf'],multiple:false,copyToCacheDirectory:true});
      const asset=picked.canceled?null:picked.assets[0];return asset?{uri:asset.uri,name:asset.name,mimeType:asset.mimeType??null,size:asset.size??null}:null}}),[editor,controller,entityId]);
  const [busy,setBusy]=useState<VehicleFileSlot|null>(null);const [failed,setFailed]=useState<VehicleFileSlot|null>(null);const [saved,setSaved]=useState<VehicleFileSlot[]>([]);const [error,setError]=useState('');
  const run=async(slot:VehicleFileSlot,task:()=>Promise<boolean>)=>{
    if(busy)return;setBusy(slot);setError('');
    try{if(await task()&&isCurrent()){setFailed(null);setSaved(list=>[...list,slot]);onSaved?.()}}
    catch(failure){if(isCurrent()){setFailed(actions.pendingSlot);setError(failure instanceof Error?failure.message:'File change could not be saved. Retry keeps the same file.')}}
    finally{if(isCurrent())setBusy(null)}
  };
  const body={color:theme.ink,lineHeight:23};const meta={color:theme.secondary,lineHeight:21};
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:theme.divider,borderRadius:10,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={body}>{label}</Text></Pressable>;
  return <View style={{gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:16}}>
    <Text accessibilityRole="header" style={[body,{fontSize:19,fontWeight:'800'}]}>Vehicle files</Text>
    <Text style={meta}>Replace or clear one file at a time (JPEG, PNG, WebP, GIF or PDF up to 8 MB). Files are copied into app storage on this device (not encrypted by FireOps) and upload when online. If someone else changed the same file meanwhile, you are warned and can submit again or cancel. Previous files are never deleted.</Text>
    {vehicleFileSlots.map(slot=>{const name=fileName(record[slot]);const locked=!!busy||(!!failed&&failed!==slot);
      return <View key={slot} style={{gap:8,paddingVertical:10,borderTopWidth:1,borderColor:theme.divider}}>
        <Text style={[body,{fontWeight:'700'}]}>{syncReviewFieldLabel(slot)}</Text>
        <Text selectable style={meta}>{name?`Current: ${name}`:'No file'}{saved.includes(slot)?' · change saved on device — waiting to sync':''}</Text>
        {failed===slot?<>{button(busy===slot?'Saving on device…':'Retry saving this change',()=>void run(slot,()=>actions.retry()),!!busy)}{button('Cancel this change',()=>{actions.cancel();setFailed(null);setError('')},!!busy)}</>:
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{button(busy===slot?'Saving on device…':name?'Replace…':'Add…',()=>void run(slot,()=>actions.replace(slot)),locked)}{name?button('Clear',()=>void run(slot,()=>actions.clear(slot)),locked):null}</View>}
      </View>})}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>:null}
  </View>;
}
