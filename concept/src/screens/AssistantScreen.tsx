import React,{useEffect,useMemo,useRef,useState} from 'react';
import {KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Ionicons} from '@expo/vector-icons';
import {Card} from '../components/Card';
import {colors} from '../theme';

type PermissionKey='dashboard'|'operations'|'comms'|'fleetView'|'fleetManage'|'payrollSubmit'|'payrollApprove'|'receiptsSubmit'|'receiptsApprove'|'employees'|'integrations'|'reports'|'userAdmin';
type AppTab='Dashboard'|'Operations'|'Communications'|'Fleet'|'More';
type Intent={title:string;detail:string;tab:AppTab;path?:string;permission?:PermissionKey;keywords:string[]};
type Message={id:string;from:'assistant'|'user';text:string;intent?:Intent};

const HISTORY_KEY='fireops.assistant.history.v1';
const intents:Intent[]=[
 {title:'Open Incident Map',detail:'View active incidents, perimeters, heat detections, alerts, and company resources.',tab:'Operations',permission:'operations',keywords:['fire','incident','map','perimeter','heat','satellite','weather','red flag','location']},
 {title:'Message the Crew',detail:'Open company, incident, unit, or direct-message channels.',tab:'Communications',permission:'comms',keywords:['message','chat','crew','announcement','communications','text','contact']},
 {title:'Start a Post-Assignment Inspection',detail:'Open Fleet, select the resource, and start its return inspection.',tab:'Fleet',path:'Fleet → Inspections',permission:'fleetView',keywords:['post assignment','inspection','inspect','return inspection','defect','damage']},
 {title:'Create Or Review a Work Order',detail:'Track repairs, labor, parts, vendors, status, and total cost.',tab:'Fleet',path:'Fleet → Work Orders',permission:'fleetManage',keywords:['repair','work order','mechanic','service','maintenance','parts','broken','fix']},
 {title:'Check Preventive Maintenance',detail:'Review mileage/hour intervals and services coming due.',tab:'Fleet',path:'Fleet → Service Schedule',permission:'fleetView',keywords:['oil change','preventive','pm','service due','mileage','hours']},
 {title:'Capture A Receipt',detail:'Photograph and categorize a fuel, parts, hotel, meal, shipping, or vendor receipt.',tab:'More',path:'More → Capture → Receipt',permission:'receiptsSubmit',keywords:['receipt','expense','fuel receipt','hotel','meal','vendor invoice','purchase']},
 {title:'Submit Payroll Paperwork',detail:'Take a photo of a payroll form and attach it to the assignment.',tab:'More',path:'More → Capture → Payroll form',permission:'payrollSubmit',keywords:['payroll','time sheet','timesheet','hours','of-288','ctr','pay form']},
 {title:'Review Payroll',detail:'Review pending forms, approve records, and prepare exports.',tab:'More',path:'More → Payroll',permission:'payrollApprove',keywords:['approve payroll','payroll approval','pending payroll','export payroll']},
 {title:'Manage Users and Permissions',detail:'Invite, suspend, or customize access for company users.',tab:'More',path:'More → Users & permissions',permission:'userAdmin',keywords:['user','permission','invite','access','role','account','suspend']},
 {title:'Manage QuickBooks or Motive',detail:'Open connected-system settings and synchronization status.',tab:'More',path:'More → Integrations',permission:'integrations',keywords:['quickbooks','motive','dashcam','integration','sync','accounting']},
 {title:'Open The Command Center',detail:'See the company-wide operational picture and priority alerts.',tab:'More',path:'More → Command Center',permission:'dashboard',keywords:['command center','overview','company status','alerts','readiness']},
 {title:'View the Dashboard',detail:'Return to the main FireOps status and quick-action screen.',tab:'Dashboard',permission:'dashboard',keywords:['dashboard','home','summary','today']},
];
const defaultPermissions:PermissionKey[]=['dashboard','operations','comms','fleetView','fleetManage','payrollSubmit','payrollApprove','receiptsSubmit','receiptsApprove','employees','integrations','reports','userAdmin'];

function scoreIntent(query:string,intent:Intent){const q=query.toLowerCase();return intent.keywords.reduce((score,k)=>score+(q.includes(k)?(k.includes(' ')?4:2):0),0)}

export function AssistantScreen({navigation}:{navigation?:any}){
 const[input,setInput]=useState('');const[permissions,setPermissions]=useState<PermissionKey[]>(defaultPermissions);const scroll=useRef<ScrollView>(null);
 const[messages,setMessages]=useState<Message[]>([{id:'welcome',from:'assistant',text:'How can I help? Describe what you need to do and I’ll point you to the right FireOps feature.'}]);
 useEffect(()=>{Promise.all([AsyncStorage.getItem(HISTORY_KEY),AsyncStorage.getItem('fireops.current.permissions.v1')]).then(([history,perms])=>{if(history)setMessages(JSON.parse(history));if(perms)setPermissions(JSON.parse(perms))}).catch(()=>{})},[]);
 useEffect(()=>{AsyncStorage.setItem(HISTORY_KEY,JSON.stringify(messages.slice(-30))).catch(()=>{});setTimeout(()=>scroll.current?.scrollToEnd({animated:true}),50)},[messages]);
 const suggestions=useMemo(()=>['I need to submit payroll','Start a Post-Assignment Inspection','Capture a fuel receipt','Message the Crew','Show active fires'],[]);
 const ask=(raw?:string)=>{const query=(raw??input).trim();if(!query)return;const ranked=intents.map(i=>({i,score:scoreIntent(query,i)})).sort((a,b)=>b.score-a.score);const match=ranked[0];let response:Message;
  if(match.score===0)response={id:`a-${Date.now()}`,from:'assistant',text:'I’m not certain which feature matches that request. Try mentioning the task—such as payroll, receipt, inspection, repair, incident map, crew message, QuickBooks, or users.'};
  else if(match.i.permission&&!permissions.includes(match.i.permission))response={id:`a-${Date.now()}`,from:'assistant',text:`The closest feature is “${match.i.title},” but your account does not currently have permission to use it. Ask a FireOps administrator to grant the required access.`};
  else response={id:`a-${Date.now()}`,from:'assistant',text:`Use ${match.i.path??match.i.tab}. ${match.i.detail}`,intent:match.i};
  setMessages(m=>[...m,{id:`u-${Date.now()}`,from:'user',text:query},response]);setInput('');
 };
 const open=(intent:Intent)=>navigation?.navigate?.(intent.tab);
 return <KeyboardAvoidingView style={s.page} behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={115}>
  <View style={s.header}><View style={s.mark}><Ionicons name="sparkles" size={22} color={colors.white}/></View><View><Text style={s.title}>FireOps Assistant</Text><Text style={s.sub}>Permission-aware feature guide</Text></View></View>
  <ScrollView ref={scroll} style={s.chat} contentContainerStyle={s.chatContent} keyboardShouldPersistTaps="handled">
   <Card style={s.notice}><Text style={s.noticeTitle}>Field Guidance, Not Emergency Dispatch</Text><Text style={s.noticeText}>Continue to use radios, official dispatch, and agency instructions for emergency or life-safety communication.</Text></Card>
   {messages.map(m=><View key={m.id} style={[s.bubble,m.from==='user'?s.userBubble:s.aiBubble]}><Text style={s.bubbleLabel}>{m.from==='user'?'You':'FireOps'}</Text><Text style={s.message}>{m.text}</Text>{m.intent&&<Pressable onPress={()=>open(m.intent!)} style={s.openButton}><Text style={s.openText}>Open {m.intent.tab}</Text><Ionicons name="arrow-forward" size={16} color={colors.white}/></Pressable>}</View>)}
  </ScrollView>
  <View style={s.suggestions}><ScrollView horizontal showsHorizontalScrollIndicator={false}>{suggestions.map(x=><Pressable key={x} onPress={()=>ask(x)} style={s.chip}><Text style={s.chipText}>{x}</Text></Pressable>)}</ScrollView></View>
  <View style={s.composer}><TextInput value={input} onChangeText={setInput} onSubmitEditing={()=>ask()} returnKeyType="send" placeholder="What do you need to do?" placeholderTextColor={colors.muted} style={s.input}/><Pressable onPress={()=>ask()} style={s.send}><Ionicons name="arrow-up" color={colors.white} size={22}/></Pressable></View>
 </KeyboardAvoidingView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,borderBottomColor:colors.border,borderBottomWidth:1},mark:{width:42,height:42,borderRadius:13,backgroundColor:colors.red,alignItems:'center',justifyContent:'center',marginRight:11},title:{color:colors.text,fontSize:20,fontWeight:'900'},sub:{color:colors.muted,fontSize:12,marginTop:2},chat:{flex:1},chatContent:{padding:16,paddingBottom:22},notice:{marginBottom:14,borderColor:'#614c24',backgroundColor:'#282218'},noticeTitle:{color:colors.amber,fontWeight:'900'},noticeText:{color:colors.muted,fontSize:12,lineHeight:17,marginTop:4},bubble:{maxWidth:'88%',borderRadius:16,padding:12,marginBottom:10,borderWidth:1},aiBubble:{alignSelf:'flex-start',backgroundColor:colors.surface,borderColor:colors.border},userBubble:{alignSelf:'flex-end',backgroundColor:'#342022',borderColor:'#67312e'},bubbleLabel:{color:colors.muted,fontSize:10,fontWeight:'900',textTransform:'uppercase',marginBottom:5},message:{color:colors.text,lineHeight:20},openButton:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:7,backgroundColor:colors.red,borderRadius:9,paddingHorizontal:12,paddingVertical:9,marginTop:10},openText:{color:colors.white,fontWeight:'900'},suggestions:{borderTopWidth:1,borderTopColor:colors.border,paddingVertical:8},chip:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:18,paddingHorizontal:12,paddingVertical:8,marginLeft:8},chipText:{color:colors.text,fontSize:12,fontWeight:'700'},composer:{flexDirection:'row',alignItems:'center',padding:10,gap:8,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.surface},input:{flex:1,minHeight:46,maxHeight:100,borderRadius:14,backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,color:colors.text,paddingHorizontal:13,paddingVertical:10},send:{height:46,width:46,borderRadius:14,backgroundColor:colors.red,alignItems:'center',justifyContent:'center'}});
