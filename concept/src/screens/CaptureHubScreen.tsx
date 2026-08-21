import React, {useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Card} from '../components/Card';
import {ScreenHeader} from '../components/ScreenHeader';
import {colors} from '../theme';
import {ReceiptCaptureScreen} from './ReceiptCaptureScreen';
import {PayrollScreen} from './PayrollScreen';

type CaptureRoute = 'menu'|'Receipt'|'Payroll';
const choices = [
  {name:'Receipt', subtitle:'Fuel, Lodging, Meals, Parts, Rentals, and Vendor Invoices', icon:'receipt-outline'},
  {name:'Payroll', subtitle:'Crew Time, CTRs, OF-288s, and Payroll Forms', icon:'cash-outline'},
  {name:'Post-assignment inspection', subtitle:'Inspect a Resource and Create Defects or Work Orders', icon:'construct-outline'},
  {name:'JHA or safety form', subtitle:'Capture Safety Documents and Tailgate Briefings', icon:'shield-checkmark-outline'},
  {name:'Equipment damage', subtitle:'Photograph and Document Assignment Damage', icon:'camera-outline'},
  {name:'Incident document', subtitle:'Resource Orders, Shift Plans, Maps, and Other Paperwork', icon:'document-text-outline'},
] as const;

export function CaptureHubScreen(){
  const [route,setRoute]=useState<CaptureRoute>('menu');
  if(route==='Receipt') return <Shell back={()=>setRoute('menu')}><ReceiptCaptureScreen/></Shell>;
  if(route==='Payroll') return <Shell back={()=>setRoute('menu')}><PayrollScreen/></Shell>;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <View style={s.heroIcon}><Ionicons name="camera" size={34} color="#fff"/></View>
    <ScreenHeader title="Capture" subtitle="Photograph a field document and route it to the correct FireOps module."/>
    <Card style={s.card}>{choices.map((choice,index)=><Pressable key={choice.name} onPress={()=>{if(choice.name==='Receipt')setRoute('Receipt'); else if(choice.name==='Payroll')setRoute('Payroll');}} style={[s.row,index===choices.length-1&&{borderBottomWidth:0}]}>
      <View style={s.icon}><Ionicons name={choice.icon as any} size={23} color={colors.red}/></View><View style={{flex:1}}><Text style={s.rowText}>{choice.name}</Text><Text style={s.rowSub}>{choice.subtitle}</Text>{!['Receipt','Payroll'].includes(choice.name)&&<Text style={s.coming}>Workflow connects to its existing module</Text>}</View><Text style={s.chev}>›</Text>
    </Pressable>)}</Card>
  </ScrollView>;
}
function Shell({back,children}:{back:()=>void;children:React.ReactNode}){return <View style={{flex:1,backgroundColor:colors.background}}><Pressable onPress={back} style={s.back}><Text style={s.backText}>‹ Back to Capture</Text></Pressable><View style={{flex:1}}>{children}</View></View>}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},content:{padding:16,paddingBottom:50},heroIcon:{width:64,height:64,borderRadius:20,backgroundColor:colors.red,alignItems:'center',justifyContent:'center',marginBottom:14},title:{color:colors.text,fontSize:30,fontWeight:'900'},sub:{color:colors.muted,marginTop:5,marginBottom:18,lineHeight:20},card:{paddingVertical:2},row:{minHeight:86,flexDirection:'row',alignItems:'center',gap:12,borderBottomColor:colors.border,borderBottomWidth:1},icon:{width:42,height:42,borderRadius:12,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border},rowText:{color:colors.text,fontWeight:'900'},rowSub:{color:colors.muted,fontSize:12,marginTop:4,lineHeight:16},coming:{color:colors.red,fontSize:10,fontWeight:'800',marginTop:4},chev:{color:colors.muted,fontSize:28},back:{paddingHorizontal:16,paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.border},backText:{color:colors.red,fontWeight:'900'}});
