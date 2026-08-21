import React,{useState} from 'react';
import {Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {AssistantScreen} from '../screens/AssistantScreen';
import {colors} from '../theme';

export function FloatingAssistant(){
 const[open,setOpen]=useState(false);
 return <>
  <Pressable accessibilityLabel="Open FireOps Assistant" onPress={()=>setOpen(true)} style={s.fab}><Ionicons name="sparkles" size={24} color="#fff"/></Pressable>
  <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setOpen(false)}>
   <View style={s.modal}><View style={s.bar}><Pressable onPress={()=>setOpen(false)} style={s.close}><Ionicons name="chevron-down" size={24} color={colors.red}/><Text style={s.closeText}>Close</Text></Pressable><Text style={s.title}>FireOps Assistant</Text><View style={{width:70}}/></View><AssistantScreen/></View>
  </Modal>
 </>;
}
const s=StyleSheet.create({fab:{position:'absolute',right:18,bottom:78,width:54,height:54,borderRadius:27,backgroundColor:colors.red,alignItems:'center',justifyContent:'center',zIndex:50,shadowColor:'#000',shadowOpacity:.45,shadowRadius:9,shadowOffset:{width:0,height:4},elevation:12,borderWidth:2,borderColor:'rgba(255,255,255,.22)'},modal:{flex:1,backgroundColor:colors.background},bar:{height:54,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:colors.border},close:{width:70,flexDirection:'row',alignItems:'center'},closeText:{color:colors.red,fontWeight:'800'},title:{color:colors.text,fontWeight:'900',fontSize:17}});
