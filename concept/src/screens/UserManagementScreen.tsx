import React,{useEffect,useMemo,useState} from 'react';
import {Alert,Modal,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Card} from '../components/Card';
import {PrimaryButton} from '../components/PrimaryButton';
import {ScreenHeader} from '../components/ScreenHeader';
import {StatusPill} from '../components/StatusPill';
import {colors} from '../theme';

type PermissionKey='dashboard'|'operations'|'comms'|'fleetView'|'fleetManage'|'payrollSubmit'|'payrollApprove'|'receiptsSubmit'|'receiptsApprove'|'employees'|'integrations'|'reports'|'userAdmin';
type Role='Master Admin'|'Administrator'|'Operations Manager'|'Crew Boss'|'Mechanic'|'Office Staff'|'Employee'|'Custom';
type AppUser={id:string;name:string;email:string;role:Role;status:'Active'|'Invited'|'Suspended';permissions:PermissionKey[];createdAt:string;lastActive?:string};

const STORAGE_KEY='fireops.users.v1';
const permissionGroups:{title:string;items:{key:PermissionKey;label:string;detail:string}[]}[]=[
 {title:'Operations',items:[
  {key:'dashboard',label:'View dashboard',detail:'Company status and assigned work'},
  {key:'operations',label:'Operations & incident map',detail:'Incidents, assignments, maps, and resource status'},
  {key:'comms',label:'Crew messaging',detail:'Company, incident, unit, and direct channels'},
 ]},
 {title:'Fleet',items:[
  {key:'fleetView',label:'View fleet',detail:'Vehicles, inspections, issues, and service history'},
  {key:'fleetManage',label:'Manage fleet',detail:'Work orders, defects, parts, and service schedules'},
 ]},
 {title:'Finance & Payroll',items:[
  {key:'payrollSubmit',label:'Submit Payroll',detail:'Upload personal or assigned crew payroll forms'},
  {key:'payrollApprove',label:'Approve payroll',detail:'Review, approve, reject, and export payroll'},
  {key:'receiptsSubmit',label:'Submit receipts',detail:'Capture Receipts and assign expenses'},
  {key:'receiptsApprove',label:'Approve receipts',detail:'Review coding and send approved records to accounting'},
 ]},
 {title:'Administration',items:[
  {key:'employees',label:'Manage employees',detail:'Profiles, qualifications, and expirations'},
  {key:'reports',label:'View reports',detail:'Financial, utilization, payroll, and maintenance reports'},
  {key:'integrations',label:'Manage integrations',detail:'QuickBooks, Motive, cloud services, and API settings'},
  {key:'userAdmin',label:'Manage users & permissions',detail:'Invite, suspend, and change access for other users'},
 ]},
];
const allPermissions=permissionGroups.flatMap(g=>g.items.map(i=>i.key));
const rolePermissions:Record<Role,PermissionKey[]>={
 'Master Admin':allPermissions,
 'Administrator':allPermissions.filter(p=>p!=='userAdmin'),
 'Operations Manager':['dashboard','operations','comms','fleetView','fleetManage','payrollApprove','receiptsApprove','employees','reports'],
 'Crew Boss':['dashboard','operations','comms','fleetView','payrollSubmit','receiptsSubmit'],
 'Mechanic':['dashboard','comms','fleetView','fleetManage','receiptsSubmit'],
 'Office Staff':['dashboard','comms','fleetView','payrollApprove','receiptsSubmit','receiptsApprove','employees','reports'],
 'Employee':['dashboard','operations','comms','fleetView','payrollSubmit','receiptsSubmit'],
 'Custom':[],
};
const seedUsers:AppUser[]=[
 {id:'master-1',name:'Clint',email:'owner@firecollc.com',role:'Master Admin',status:'Active',permissions:allPermissions,createdAt:'2026-07-17',lastActive:'Now'},
 {id:'user-2',name:'Sarah Mitchell',email:'sarah@firecollc.com',role:'Office Staff',status:'Active',permissions:rolePermissions['Office Staff'],createdAt:'2026-07-17',lastActive:'12 min ago'},
 {id:'user-3',name:'Jake Turner',email:'jake@firecollc.com',role:'Crew Boss',status:'Invited',permissions:rolePermissions['Crew Boss'],createdAt:'2026-07-17'},
];

export function UserManagementScreen(){
 const[users,setUsers]=useState<AppUser[]>(seedUsers);const[editing,setEditing]=useState<AppUser|null>(null);const[showEditor,setShowEditor]=useState(false);
 useEffect(()=>{AsyncStorage.getItem(STORAGE_KEY).then(v=>{if(v)setUsers(JSON.parse(v))}).catch(()=>{})},[]);
 const persist=(next:AppUser[])=>{setUsers(next);AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(next)).catch(()=>{})};
 const activeCount=users.filter(u=>u.status==='Active').length;const invited=users.filter(u=>u.status==='Invited').length;
 const openNew=()=>{setEditing({id:`user-${Date.now()}`,name:'',email:'',role:'Employee',status:'Invited',permissions:rolePermissions.Employee,createdAt:new Date().toISOString().slice(0,10)});setShowEditor(true)};
 const save=(u:AppUser)=>{if(!u.name.trim()||!u.email.includes('@')){Alert.alert('Missing information','Enter a name and valid email address.');return}const next=users.some(x=>x.id===u.id)?users.map(x=>x.id===u.id?u:x):[...users,u];persist(next);setShowEditor(false);setEditing(null)};
 const suspend=(u:AppUser)=>{if(u.role==='Master Admin'){Alert.alert('Master account protected','The master account cannot be suspended from the app.');return}const status=u.status==='Suspended'?'Active':'Suspended';persist(users.map(x=>x.id===u.id?{...x,status}:x))};
 return <ScrollView style={s.page} contentContainerStyle={s.content}>
  <ScreenHeader title="Users & Permissions" subtitle="Control access from the FireOps master account" action={<Pressable onPress={openNew} style={s.add}><Text style={s.addText}>＋ Add user</Text></Pressable>}/>
  <View style={s.stats}><Stat label="Total users" value={String(users.length)}/><Stat label="Active" value={String(activeCount)}/><Stat label="Invited" value={String(invited)}/></View>
  <Card><Text style={s.sectionTitle}>Access Model</Text><Text style={s.info}>The Master Admin has permanent full access. Other users can receive a role template and then have individual permissions added or removed.</Text></Card>
  <Text style={s.sectionHeader}>Company Users</Text>
  {users.map(u=><Card key={u.id} style={s.userCard}><View style={s.userTop}><View style={s.avatar}><Text style={s.avatarText}>{u.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</Text></View><View style={{flex:1}}><Text style={s.userName}>{u.name}</Text><Text style={s.email}>{u.email}</Text><View style={s.pills}><StatusPill status={u.role}/><StatusPill status={u.status}/></View></View></View><Text style={s.access}>{u.permissions.length} of {allPermissions.length} permissions · Last active: {u.lastActive||'Invitation pending'}</Text><View style={s.actions}><Pressable onPress={()=>{setEditing(u);setShowEditor(true)}} style={s.secondary}><Text style={s.secondaryText}>Edit access</Text></Pressable>{u.role!=='Master Admin'&&<Pressable onPress={()=>suspend(u)} style={s.secondary}><Text style={[s.secondaryText,u.status!=='Suspended'&&{color:'#ffb1b1'}]}>{u.status==='Suspended'?'Reactivate':'Suspend'}</Text></Pressable>}</View></Card>)}
  <Modal visible={showEditor} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setShowEditor(false)}>{editing&&<UserEditor user={editing} onCancel={()=>setShowEditor(false)} onSave={save}/>}</Modal>
 </ScrollView>
}
function UserEditor({user,onCancel,onSave}:{user:AppUser;onCancel:()=>void;onSave:(u:AppUser)=>void}){const[draft,setDraft]=useState(user);const roles=Object.keys(rolePermissions) as Role[];const locked=draft.role==='Master Admin';
 const setRole=(role:Role)=>setDraft({...draft,role,permissions:role==='Custom'?draft.permissions:rolePermissions[role]});
 const toggle=(key:PermissionKey)=>{if(locked)return;const has=draft.permissions.includes(key);setDraft({...draft,role:'Custom',permissions:has?draft.permissions.filter(p=>p!==key):[...draft.permissions,key]})};
 return <ScrollView style={s.editor} contentContainerStyle={s.editorContent}><View style={s.editorHeader}><Pressable onPress={onCancel}><Text style={s.cancel}>Cancel</Text></Pressable><Text style={s.editorTitle}>{user.name?'Edit User':'Invite User'}</Text><Pressable onPress={()=>onSave(draft)}><Text style={s.save}>Save</Text></Pressable></View><Text style={s.label}>Full name</Text><TextInput value={draft.name} onChangeText={name=>setDraft({...draft,name})} placeholder="Employee name" placeholderTextColor={colors.muted} style={s.input}/><Text style={s.label}>Email</Text><TextInput value={draft.email} onChangeText={email=>setDraft({...draft,email})} autoCapitalize="none" keyboardType="email-address" placeholder="name@company.com" placeholderTextColor={colors.muted} style={s.input}/><Text style={s.label}>Role template</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:12}}>{roles.filter(r=>r!=='Master Admin'||locked).map(role=><Pressable key={role} onPress={()=>setRole(role)} style={[s.roleChip,draft.role===role&&s.roleChipActive]}><Text style={[s.roleText,draft.role===role&&s.roleTextActive]}>{role}</Text></Pressable>)}</ScrollView>{permissionGroups.map(group=><Card key={group.title} style={s.permissionCard}><Text style={s.permissionTitle}>{group.title}</Text>{group.items.map((item,i)=><View key={item.key} style={[s.permissionRow,i===group.items.length-1&&{borderBottomWidth:0}]}><View style={{flex:1,paddingRight:10}}><Text style={s.permissionLabel}>{item.label}</Text><Text style={s.permissionDetail}>{item.detail}</Text></View><Switch value={draft.permissions.includes(item.key)} onValueChange={()=>toggle(item.key)} disabled={locked} trackColor={{false:'#444',true:colors.red}}/></View>)}</Card>)}<PrimaryButton label={user.name?'Save permissions':'Send invitation'} onPress={()=>onSave(draft)}/><Text style={s.footnote}>Prototype behavior: invitations and permissions are stored locally. Production will enforce them on the secure backend and send real email invitations.</Text></ScrollView>}
function Stat({label,value}:{label:string;value:string}){return <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},content:{padding:16,paddingBottom:50},titleRow:{flexDirection:'row',alignItems:'center',marginBottom:14},title:{fontSize:27,fontWeight:'900',color:colors.text},sub:{color:colors.muted,marginTop:3},add:{backgroundColor:colors.red,paddingHorizontal:12,paddingVertical:10,borderRadius:10},addText:{color:'#fff',fontWeight:'900'},stats:{flexDirection:'row',gap:8,marginBottom:12},stat:{flex:1,backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:12,padding:12},statValue:{color:colors.text,fontSize:23,fontWeight:'900'},statLabel:{color:colors.muted,fontSize:11,marginTop:3},sectionTitle:{color:colors.text,fontWeight:'900',fontSize:17},info:{color:colors.muted,lineHeight:20,marginTop:7},sectionHeader:{color:colors.text,fontSize:18,fontWeight:'900',marginTop:18,marginBottom:8},userCard:{marginBottom:10},userTop:{flexDirection:'row',alignItems:'center'},avatar:{height:46,width:46,borderRadius:23,backgroundColor:'#342022',alignItems:'center',justifyContent:'center',marginRight:12},avatarText:{color:colors.red,fontWeight:'900'},userName:{color:colors.text,fontWeight:'900',fontSize:17},email:{color:colors.muted,marginTop:2},pills:{flexDirection:'row',gap:6,marginTop:7},access:{color:colors.muted,fontSize:12,marginTop:12},actions:{flexDirection:'row',gap:8,marginTop:12},secondary:{flex:1,borderWidth:1,borderColor:colors.border,borderRadius:10,paddingVertical:10,alignItems:'center'},secondaryText:{color:colors.text,fontWeight:'800'},editor:{flex:1,backgroundColor:colors.background},editorContent:{padding:16,paddingBottom:50},editorHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:18},cancel:{color:colors.muted,fontWeight:'800'},save:{color:colors.red,fontWeight:'900'},editorTitle:{color:colors.text,fontWeight:'900',fontSize:18},label:{color:colors.text,fontWeight:'800',marginBottom:6,marginTop:10},input:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:10,color:colors.text,paddingHorizontal:12,paddingVertical:12},roleChip:{borderColor:colors.border,borderWidth:1,borderRadius:18,paddingVertical:8,paddingHorizontal:12,marginRight:8,backgroundColor:colors.surface},roleChipActive:{borderColor:colors.red,backgroundColor:'#342022'},roleText:{color:colors.muted,fontWeight:'700'},roleTextActive:{color:colors.text},permissionCard:{marginBottom:10},permissionTitle:{color:colors.text,fontSize:17,fontWeight:'900',marginBottom:4},permissionRow:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderBottomColor:colors.border,borderBottomWidth:1},permissionLabel:{color:colors.text,fontWeight:'800'},permissionDetail:{color:colors.muted,fontSize:12,lineHeight:17,marginTop:3},footnote:{color:colors.muted,fontSize:12,lineHeight:18,textAlign:'center',marginTop:14}});
