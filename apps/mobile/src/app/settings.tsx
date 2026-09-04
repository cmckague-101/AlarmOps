import type {MotiveConnection} from '@fireops/domain';
import {Redirect,Stack,useRouter} from 'expo-router';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,Linking,Pressable,RefreshControl,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppSymbol} from '@/components/app-symbol';
import {loadCrewSeatsUsed,refreshFleet,useFleetVehicles} from '@/lib/fleet-store';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsColorScheme,useFireOpsTheme} from '@/theme';

async function motiveRequest(companyId:string,action:'status'|'save'|'disconnect',apiKey?:string){
  if(!supabase)throw new Error('Motive integration is unavailable.');
  const {data,error}=await supabase.functions.invoke<MotiveConnection>('motive-integration',{body:{companyId,action,...(apiKey?{apiKey}:{})}});
  if(error){
    const context=(error as {context?:Response}).context;
    const body=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;
    throw new Error(body?.error||error.message||'Motive request failed.');
  }
  if(!data)throw new Error('Motive returned an invalid response.');
  return data;
}

export default function SettingsScreen(){
  const router=useRouter();const theme=useFireOpsTheme();const {colorScheme,setColorScheme}=useFireOpsColorScheme();const styles=useMemo(()=>createStyles(theme),[theme]);
  const {session,access,clearCompany}=useSession();const member=access.value?.kind==='member'?access.value:null;
  const {crew,refreshing}=useFleetVehicles(member?.company.id??null);
  const [seatsUsed,setSeatsUsed]=useState<number|null>(null);const [connection,setConnection]=useState<MotiveConnection>({connected:false});
  const [apiKey,setApiKey]=useState('');const [showKey,setShowKey]=useState(false);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const owner=crew.find(person=>person.role==='owner')?.name??(member?.user.role==='owner'?member.user.name:'Not available');
  const isOwner=member?.user.role==='owner';const companyId=member?.company.id;
  const load=useCallback(async()=>{
    if(!companyId)return;
    await Promise.resolve();
    setLoading(true);setError('');
    try{
      const usage=await loadCrewSeatsUsed(companyId);setSeatsUsed(usage);
      if(isOwner)setConnection(await motiveRequest(companyId,'status'));
    }catch(loadError){setError(loadError instanceof Error?loadError.message:'Settings could not be loaded.');}
    finally{setLoading(false)}
  },[companyId,isOwner]);
  useEffect(()=>{if(!companyId)return;let active=true;void Promise.all([loadCrewSeatsUsed(companyId),isOwner?motiveRequest(companyId,'status'):Promise.resolve(null)]).then(([usage,motive])=>{if(!active)return;setSeatsUsed(usage);if(motive)setConnection(motive);setLoading(false)}).catch(loadError=>{if(!active)return;setError(loadError instanceof Error?loadError.message:'Settings could not be loaded.');setLoading(false)});return()=>{active=false}},[companyId,isOwner]);
  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(!member)return <Redirect href="/"/>;
  const limit=member.company.crewInviteLimit;const used=seatsUsed??crew.filter(person=>person.role==='member').length;const available=Math.max(0,limit-used);
  const save=async()=>{
    const key=apiKey.trim();if(!companyId||!key||busy)return;
    setBusy(true);setError('');setSaved(false);
    try{setConnection(await motiveRequest(companyId,'save',key));setApiKey('');setShowKey(false);setSaved(true)}
    catch(saveError){setError(saveError instanceof Error?saveError.message:'Motive API key could not be saved.')}
    finally{setBusy(false)}
  };
  const disconnect=()=>Alert.alert('Disconnect Motive?','Vehicle tracking and camera data will stop until a new API key is connected.',[
    {text:'Cancel',style:'cancel'},
    {text:'Disconnect',style:'destructive',onPress:()=>{if(!companyId)return;setBusy(true);setError('');setSaved(false);void motiveRequest(companyId,'disconnect').then(next=>{setConnection(next);setApiKey('')}).catch(disconnectError=>setError(disconnectError instanceof Error?disconnectError.message:'Motive connection could not be removed.')).finally(()=>setBusy(false))}},
  ]);
  const switchCompany=()=>{clearCompany();router.replace('/companies' as never)};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Settings'}}/><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing||loading} onRefresh={()=>{refreshFleet();void load()}} tintColor={theme.commandForeground}/>}>
    <View><Text accessibilityRole="header" style={styles.title}>Settings</Text><Text style={styles.subtitle}>Company details and integrations.</Text></View>
    <View style={styles.companyCard}><View style={styles.logo}><Text style={styles.logoText}>{member.company.name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()}</Text></View><View style={styles.companyHeading}><Text style={styles.companyName}>{member.company.name}</Text><Text style={styles.industry}>{member.company.industry||'Industry not specified'}</Text></View><View style={styles.details}><Detail label="Owner" value={owner} styles={styles}/><Detail label="Company ID" value={member.company.code} styles={styles}/>{isOwner?<><Detail label="Crew seat limit" value={String(limit)} styles={styles}/><Detail label="Seats used" value={String(used)} styles={styles}/><Detail label="Seats available" value={String(available)} styles={styles}/></>:null}</View></View>
    <View style={styles.appearance}><Text style={styles.panelTitle}>Appearance</Text><Text style={styles.panelSubtitle}>Choose how FireOps looks on this device.</Text><View accessibilityRole="radiogroup" style={styles.themeOptions}>{(['light','dark'] as const).map(scheme=>{const selected=colorScheme===scheme;return <Pressable key={scheme} accessibilityRole="radio" accessibilityState={{checked:selected}} onPress={()=>setColorScheme(scheme)} style={({pressed})=>[styles.themeOption,selected&&styles.themeOptionSelected,pressed&&styles.pressed]}><AppSymbol name={scheme==='light'?{ios:'sun.max.fill',android:'light_mode'} as never:{ios:'moon.fill',android:'dark_mode'} as never} color={selected?theme.ember:theme.secondary} size={20}/><Text style={[styles.themeOptionText,selected&&styles.themeOptionTextSelected]}>{scheme==='light'?'Light':'Dark'}</Text>{selected?<AppSymbol name={{ios:'checkmark.circle.fill',android:'check_circle'} as never} color={theme.ember} size={19}/>:null}</Pressable>})}</View></View>
    {isOwner?<View style={styles.panel}><View style={styles.panelHeader}><View style={styles.keyIcon}><AppSymbol name={{ios:'key.fill',android:'key'} as never} color={theme.commandForeground} size={20}/></View><View style={styles.panelCopy}><Text style={styles.panelTitle}>Motive</Text><Text style={styles.panelSubtitle}>Vehicle tracking and camera data.</Text></View><View style={[styles.status,connection.connected&&styles.connected]}><View style={[styles.dot,connection.connected&&styles.connectedDot]}/><Text style={[styles.statusText,connection.connected&&styles.connectedText]}>{connection.connected?'Connected':'Not connected'}</Text></View></View>
      <Text style={styles.integrationTitle}>{connection.connected?`API key ending in ${connection.lastFour??'••••'}`:'Motive API key'}</Text><Text style={styles.help}>Key is verified with Motive, encrypted, and never shown again. Vehicles match Motive records by VIN.</Text>
      <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL('https://gomotive.com')} style={styles.link}><Text style={styles.linkText}>Visit gomotive.com</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'} as never} color={theme.commandForeground} size={16}/></Pressable>
      {connection.lastVerifiedAt?<Text style={styles.verified}>Verified {new Date(connection.lastVerifiedAt).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</Text>:null}
      <Text style={styles.label}>{connection.connected?'Replace API key':'API key'}</Text><View style={styles.secret}><TextInput accessibilityLabel="Motive API key" autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={value=>{setApiKey(value);setError('');setSaved(false)}} placeholder="Paste Motive API key" placeholderTextColor={theme.secondary} secureTextEntry={!showKey} style={styles.input} value={apiKey}/><Pressable accessibilityRole="button" accessibilityLabel={showKey?'Hide API key':'Show API key'} onPress={()=>setShowKey(value=>!value)} style={styles.eye}><AppSymbol name={{ios:showKey?'eye.slash':'eye',android:showKey?'visibility_off':'visibility'} as never} color={theme.secondary} size={19}/></Pressable></View><Text style={styles.hint}>Find this in Motive Dashboard → Admin → Developers.</Text>
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}{saved?<Text accessibilityRole="alert" style={styles.success}>Motive connection saved.</Text>:null}
      <View style={styles.actions}><Pressable accessibilityRole="button" disabled={busy||!apiKey.trim()} onPress={()=>void save()} style={({pressed})=>[styles.primary,(busy||!apiKey.trim())&&styles.disabled,pressed&&styles.pressed]}><Text style={styles.primaryText}>{busy?'Verifying…':connection.connected?'Verify and replace key':'Verify and connect'}</Text></Pressable>{connection.connected?<Pressable accessibilityRole="button" disabled={busy} onPress={disconnect} style={({pressed})=>[styles.disconnect,pressed&&styles.pressed]}><Text style={styles.disconnectText}>Disconnect</Text></Pressable>:null}</View>
    </View>:error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    {member.isAdmin?<Pressable accessibilityRole="button" onPress={switchCompany} style={({pressed})=>[styles.switchButton,pressed&&styles.pressed]}><AppSymbol name={{ios:'building.2',android:'business'} as never} color={theme.ink} size={19}/><Text style={styles.switchText}>Switch company</Text></Pressable>:null}
  </ScrollView></SafeAreaView>;
}
function Detail({label,value,styles}:{label:string;value:string;styles:ReturnType<typeof createStyles>}){return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:20},title:{color:theme.ink,fontSize:30,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:15,marginTop:5},companyCard:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:15},appearance:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:6},themeOptions:{flexDirection:'row',gap:10,marginTop:8},themeOption:{minHeight:48,flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.canvas,paddingHorizontal:12},themeOptionSelected:{borderColor:theme.ember,backgroundColor:theme.dangerSurface},themeOptionText:{color:theme.secondary,fontSize:14,fontWeight:'700'},themeOptionTextSelected:{color:theme.ink},logo:{width:52,height:52,borderRadius:13,backgroundColor:theme.command,alignItems:'center',justifyContent:'center'},logoText:{color:theme.commandText,fontSize:19,fontWeight:'800'},companyHeading:{gap:4},companyName:{color:theme.ink,fontSize:21,fontWeight:'800'},industry:{color:theme.secondary,fontSize:13},details:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.divider},detail:{minHeight:46,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider,gap:12},detailLabel:{color:theme.secondary,fontSize:13,flex:1},detailValue:{color:theme.ink,fontSize:14,fontWeight:'700',textAlign:'right'},panel:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:13},panelHeader:{flexDirection:'row',alignItems:'center',gap:10},keyIcon:{width:40,height:40,borderRadius:10,backgroundColor:theme.surfaceAlt,alignItems:'center',justifyContent:'center'},panelCopy:{flex:1,gap:2},panelTitle:{color:theme.ink,fontSize:19,fontWeight:'800'},panelSubtitle:{color:theme.secondary,fontSize:12},status:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:theme.surfaceAlt,borderRadius:999,paddingHorizontal:9,paddingVertical:6},connected:{backgroundColor:theme.greenSurface},dot:{width:7,height:7,borderRadius:4,backgroundColor:theme.secondary},connectedDot:{backgroundColor:theme.green},statusText:{color:theme.secondary,fontSize:10,fontWeight:'800'},connectedText:{color:theme.green},integrationTitle:{color:theme.ink,fontSize:15,fontWeight:'700',marginTop:3},help:{color:theme.secondary,fontSize:13,lineHeight:19},link:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:6,minHeight:34},linkText:{color:theme.commandForeground,fontSize:13,fontWeight:'700'},verified:{color:theme.secondary,fontSize:11},label:{color:theme.ink,fontSize:13,fontWeight:'700',marginTop:3},secret:{minHeight:50,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.canvas},input:{flex:1,color:theme.ink,fontSize:15,paddingHorizontal:13,paddingVertical:12},eye:{width:46,height:48,alignItems:'center',justifyContent:'center'},hint:{color:theme.secondary,fontSize:11,lineHeight:16},error:{color:theme.danger,backgroundColor:theme.dangerSurface,borderRadius:9,padding:12,fontSize:13,lineHeight:18},success:{color:theme.green,backgroundColor:theme.greenSurface,borderRadius:9,padding:12,fontSize:13,fontWeight:'700'},actions:{gap:10,marginTop:3},primary:{minHeight:48,borderRadius:10,backgroundColor:theme.ember,alignItems:'center',justifyContent:'center',paddingHorizontal:14},primaryText:{color:'#fff',fontSize:14,fontWeight:'800'},disconnect:{minHeight:45,alignItems:'center',justifyContent:'center'},disconnectText:{color:theme.danger,fontSize:14,fontWeight:'700'},switchButton:{minHeight:50,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.paper},switchText:{color:theme.ink,fontSize:15,fontWeight:'700'},disabled:{opacity:.45},pressed:{opacity:.65}})}
