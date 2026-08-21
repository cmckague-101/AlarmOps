import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Animated,Dimensions,Linking,PanResponder,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Ionicons} from '@expo/vector-icons';
import {colors} from '../theme';
import {ScreenHeader} from '../components/ScreenHeader';
import {spacing} from '../theme';
import {IntegrationsScreen} from './IntegrationsScreen';
import {UserManagementScreen} from './UserManagementScreen';
import {NetworkMarketplaceScreen} from './NetworkMarketplaceScreen';
import {QualificationVaultScreen} from './QualificationVaultScreen';
import {CompanyToolsScreen} from './CompanyToolsScreen';
import {CompanyDocuments} from '../features/documents/CompanyDocuments';
import {WorkforceMarketplace} from '../features/workforce/WorkforceMarketplace';

type Module='menu'|'Invite'|'Documents'|'Integrations'|'Users & permissions'|'Workforce'|'Marketplace'|'Qualification Vault'|'Roster'|'Evaluations'|'Training'|'Inventory'|'Settings';
type Tile={id:string;title:string;icon:any;color:string;module:Module;badge?:string};
const STORAGE='fireops_more_order_v16';
const baseTiles:Tile[]=[
 {id:'invite',title:'Invite',icon:'person-add',color:'#B82118',module:'Invite'},
 {id:'quals',title:'Qualifications',icon:'ribbon',color:'#B82118',module:'Qualification Vault',badge:'2'},
 {id:'inventory',title:'Inventory',icon:'cube',color:'#26784A',module:'Inventory'},
 {id:'roster',title:'Roster',icon:'people-circle',color:'#00695c',module:'Roster'},
 {id:'training',title:'Training',icon:'school',color:'#26784A',module:'Training'},
 {id:'workforce',title:'Workforce',icon:'people',color:'#00838f',module:'Workforce'},
 {id:'market',title:'Marketplace',icon:'storefront',color:'#71328C',module:'Marketplace'},
 {id:'integrations',title:'Integrations',icon:'git-network',color:'#455a64',module:'Integrations'},
 {id:'users',title:'Users',icon:'key',color:'#3949ab',module:'Users & permissions'},
 {id:'documents',title:'Documents',icon:'folder-open',color:'#276F9D',module:'Documents'},
 {id:'settings',title:'Settings',icon:'settings',color:'#616161',module:'Settings'},
];
export function MoreScreen(){
 const[module,setModule]=useState<Module>('menu'); const[tiles,setTiles]=useState(baseTiles); const[editing,setEditing]=useState(false);
 useEffect(()=>{AsyncStorage.getItem(STORAGE).then(raw=>{if(!raw)return;const ids=JSON.parse(raw) as string[];const ordered=ids.map(id=>baseTiles.find(t=>t.id===id)).filter(Boolean) as Tile[];const missing=baseTiles.filter(t=>!ids.includes(t.id));setTiles([...ordered,...missing]);}).catch(()=>{});},[]);
 const move=(from:number,to:number)=>{if(to<0||to>=tiles.length||from===to)return;setTiles(current=>{const next=[...current];const [item]=next.splice(from,1);next.splice(to,0,item);AsyncStorage.setItem(STORAGE,JSON.stringify(next.map(x=>x.id))).catch(()=>{});return next;});};
 if(module==='Integrations')return <Shell back={()=>setModule('menu')}><IntegrationsScreen/></Shell>;
 if(module==='Users & permissions')return <Shell back={()=>setModule('menu')}><UserManagementScreen/></Shell>;
 if(module==='Workforce')return <Shell back={()=>setModule('menu')}><WorkforceMarketplace/></Shell>;
 if(module==='Marketplace')return <Shell back={()=>setModule('menu')}><NetworkMarketplaceScreen initialSection="marketplace"/></Shell>;
 if(module==='Qualification Vault')return <Shell back={()=>setModule('menu')}><QualificationVaultScreen/></Shell>;
 if(module==='Documents')return <Shell back={()=>setModule('menu')}><CompanyDocuments/></Shell>;
 if(['Roster','Evaluations','Training','Inventory','Settings'].includes(module))return <Shell back={()=>setModule('menu')}><CompanyToolsScreen tool={module as any}/></Shell>;
 return <ScrollView scrollEnabled={!editing} style={s.page} contentContainerStyle={s.content}>
   <ScreenHeader title="FireOps Hub" action={<Pressable onPress={()=>setEditing(!editing)} style={[s.done,editing&&s.doneOn]}><Text style={s.doneText}>{editing?'Done':'Customize'}</Text></Pressable>}/>
   <View style={s.search}><Ionicons name="search" size={18} color={colors.muted}/><Text style={s.searchText}>Search FireOps</Text></View>
   <View style={s.grid}>{tiles.map((tile,index)=><DraggableTile key={tile.id} tile={tile} index={index} editing={editing} move={move} open={()=>tile.module==='Invite'?sendInvite():setModule(tile.module)} startEdit={()=>setEditing(true)}/>)}</View>
   <Text style={s.version}>FireOps 1.7 Workflow Edition · Powered by FireCo</Text>
 </ScrollView>;
}
async function sendInvite(){const message=encodeURIComponent('Join me on FireOps for crew communications, qualifications, training, and wildfire operations. Download FireOps and ask FireCo to link your account.');const url=Platform.OS==='ios'?`sms:&body=${message}`:`sms:?body=${message}`;try{if(await Linking.canOpenURL(url))await Linking.openURL(url);else Alert.alert('Messages Unavailable','Text messaging is not available on this device.')}catch{Alert.alert('Unable To Open Messages','FireOps could not open the text message composer.')}}
function DraggableTile({tile,index,editing,move,open,startEdit}:{tile:Tile;index:number;editing:boolean;move:(a:number,b:number)=>void;open:()=>void;startEdit:()=>void}){
 const pan=useRef(new Animated.ValueXY()).current; const tileWidth=(Dimensions.get('window').width-32)/3; const rowHeight=102;
 const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>editing,onMoveShouldSetPanResponder:(_,g)=>editing&&(Math.abs(g.dx)>4||Math.abs(g.dy)>4),onPanResponderMove:Animated.event([null,{dx:pan.x,dy:pan.y}],{useNativeDriver:false}),onPanResponderRelease:(_,g)=>{const dc=Math.round(g.dx/tileWidth);const dr=Math.round(g.dy/rowHeight);const col=index%3;let target=index+dr*3+dc;if(col+dc<0)target=index+dr*3-col;if(col+dc>2)target=index+dr*3+(2-col);move(index,Math.max(0,Math.min(target,baseTiles.length-1)));Animated.spring(pan,{toValue:{x:0,y:0},useNativeDriver:false}).start();}}),[editing,index,move,pan,tileWidth]);
 return <Animated.View {...responder.panHandlers} style={[s.tile,{transform:pan.getTranslateTransform(),zIndex:pan.x?20:1}]}><Pressable delayLongPress={300} onLongPress={startEdit} onPress={()=>editing?undefined:open()} style={({pressed})=>[s.tilePress,pressed&&!editing&&{opacity:.72}]}><View style={[s.iconBox,{backgroundColor:tile.color},editing&&s.wiggle]}><Ionicons name={tile.icon} size={30} color={colors.white}/>{tile.badge?<View style={s.notification}><Text style={s.notificationText}>{tile.badge}</Text></View>:null}{editing?<View style={s.remove}><Ionicons name="remove" size={13} color="#fff"/></View>:null}</View><Text numberOfLines={1} style={s.tileTitle}>{tile.title}</Text></Pressable></Animated.View>
}
function Shell({back,children}:{back:()=>void;children:React.ReactNode}){return <View style={{flex:1,backgroundColor:colors.background}}><Pressable onPress={back} style={s.back}><Ionicons name="chevron-back" size={20} color={colors.red}/><Text style={s.backText}>FireOps Hub</Text></Pressable><View style={{flex:1}}>{children}</View></View>}
const s=StyleSheet.create({page:{flex:1,backgroundColor:colors.background},content:{padding:spacing.screen,paddingBottom:48},done:{paddingHorizontal:16,paddingVertical:8,borderRadius:17,backgroundColor:colors.surfaceAlt},doneOn:{backgroundColor:colors.red},doneText:{color:colors.white,fontWeight:'900'},search:{height:44,borderRadius:13,backgroundColor:colors.surfaceAlt,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:13,borderWidth:1,borderColor:colors.border},searchText:{color:colors.muted},grid:{flexDirection:'row',flexWrap:'wrap',marginHorizontal:-6,marginTop:22},tile:{width:'33.333%',height:102,paddingHorizontal:6},tilePress:{alignItems:'center'},iconBox:{width:66,height:66,borderRadius:16,alignItems:'center',justifyContent:'center',shadowColor:'#000',shadowOpacity:.35,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:5},wiggle:{borderWidth:2,borderColor:'rgba(255,255,255,.25)'},remove:{position:'absolute',left:-6,top:-6,width:21,height:21,borderRadius:11,backgroundColor:'#555',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#fff'},notification:{position:'absolute',right:-7,top:-7,minWidth:22,height:22,borderRadius:11,backgroundColor:colors.red,borderWidth:2,borderColor:colors.background,alignItems:'center',justifyContent:'center',paddingHorizontal:5},notificationText:{color:colors.white,fontSize:11,fontWeight:'900'},tileTitle:{color:colors.text,fontSize:13,fontWeight:'800',marginTop:9,maxWidth:104,textAlign:'center'},version:{color:colors.muted,textAlign:'center',marginTop:24,fontSize:11},back:{paddingHorizontal:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.border,flexDirection:'row',alignItems:'center'},backText:{color:colors.red,fontWeight:'900',fontSize:16}});
