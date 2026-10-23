import {useOfflineSync} from '@/providers/offline-sync-provider';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Redirect, Stack} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useSession} from '@/providers/session-provider';
import {refreshFleet, useFleetVehicles} from '@/lib/fleet-store';
import {useAvailability} from '@/lib/use-availability';
import {useFireOpsTheme} from '@/theme';
import {AppSymbol} from '@/components/app-symbol';

export default function AvailabilityScreen() {
  const {session,access} = useSession();
  const member = access.value?.kind==='member'?access.value:null;
  const theme = useFireOpsTheme();
  const {crew,loading:crewLoading,error:crewError} = useFleetVehicles(member?.company.id ?? null);
  const {offline}=useOfflineSync();
  const {statuses,loading,error,busy,save,retry,canSave,pending,note,verified,ownPending} = useAvailability(member?.company.id,member?.user.id);
  const owner = member?.user.role==='owner'||member?.user.role==='admin';
  const styles = StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,gap:24,paddingBottom:48},title:{color:theme.ink,fontSize:30,fontWeight:'800'},copy:{color:theme.secondary,fontSize:16,lineHeight:24},record:{padding:20,gap:16,borderWidth:1,borderColor:theme.divider,borderRadius:16,backgroundColor:theme.paper},name:{color:theme.ink,fontSize:20,fontWeight:'700'},controls:{gap:12},button:{minHeight:56,borderRadius:12,padding:16,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},buttonText:{color:'#FFFFFF',fontSize:16,fontWeight:'800',flexShrink:1},error:{color:theme.danger,fontSize:16},self:{alignItems:'center',gap:20},disabled:{opacity:.5}});
  if (!session || access.status==='error') return <Redirect href="/"/>;
  const label = (value:boolean|undefined)=>value===undefined?'Not set':value?'Available':'Unavailable';
  const controls = (id:string)=><View style={styles.controls}>{[true,false].map(value=><Pressable key={String(value)} accessibilityRole="button" accessibilityState={{selected:statuses[id]===value,disabled:!canSave(id)}} disabled={!canSave(id)} onPress={()=>void save(id,value)} style={({pressed})=>[styles.button,{backgroundColor:value?theme.green:theme.danger},(pressed||busy)&&styles.disabled]}><AppSymbol name={value?{ios:'checkmark.circle',android:'check_circle'}:{ios:'xmark.circle',android:'cancel'}} color="#FFFFFF" size={23}/><Text style={styles.buttonText}>{`Show Me As ${label(value)}`}</Text></Pressable>)}</View>;
  const ownerControl = (id:string)=>{const current=statuses[id];const next=current!==true;return <Pressable accessibilityRole="button" accessibilityLabel={`${current===undefined?'Set':'Change'} status to ${label(next)}`} accessibilityState={{disabled:!canSave(id)}} disabled={!canSave(id)} onPress={()=>void save(id,next)} style={({pressed})=>[styles.button,{backgroundColor:current===undefined?'#6B7280':current===false?theme.danger:theme.green},(pressed||busy)&&styles.disabled]}><AppSymbol name={current===false?{ios:'xmark.circle',android:'cancel'}:{ios:'checkmark.circle',android:'check_circle'}} color="#FFFFFF" size={23}/><Text style={styles.buttonText}>{!verified?(current===undefined?'Status unavailable':`Last known: ${label(current)}`):current===undefined?'Set Available':label(current)}</Text></Pressable>};
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Availability'}}/><ScrollView contentContainerStyle={styles.content}><Text accessibilityRole="header" style={styles.title}>{owner?'Crew Availability':'Assignment Availability'}</Text>{!owner ? <Text style={styles.copy}>{offline?'Offline: your selection is saved on this device and shared when connected. If someone changed it meanwhile, their newer value is kept.':'Your selection is saved on this device and shared after server checks.'}</Text> : offline ? <Text style={styles.copy}>Offline: only your own availability can be saved on this device.</Text> : null}
    {pending&&<Text accessibilityRole="alert" style={styles.copy}>Submitted availability for {crew.find(person=>person.id===pending.request.userId)?.name??'the selected member'}: {label(pending.request.available)}. {pending.acknowledged?(pending.keptCurrent?'Server kept a different value; refresh pending.':'Server accepted this choice; refresh pending.'):'Not confirmed. Keep this app open until retry succeeds.'}</Text>}
    {note&&<Text style={styles.copy}>{note}</Text>}
    {(error || (owner && crewError)) && <View><Text accessibilityRole="alert" style={styles.error}>{error || crewError}</Text><Pressable accessibilityRole="button" style={styles.button} disabled={busy} onPress={()=>{void retry();if(owner)void refreshFleet();}}><Text style={styles.name}>{pending?.acknowledged?'Retry refresh':pending?'Retry original choice':'Try again'}</Text></Pressable></View>}
    {loading || (owner && crewLoading) ? <Text style={styles.copy}>Loading availability…</Text> : owner ? <>{crew.filter(person=>person.role!=='owner'&&person.status==='Active').map(person=><View key={person.id} style={styles.record}><Text style={styles.name}>{person.name}</Text>{ownerControl(person.id)}</View>)}{!crew.some(person=>person.role!=='owner'&&person.status==='Active') && <Text style={styles.copy}>No active crew members yet.</Text>}</> : member && <><View style={styles.self}><AppSymbol name={{ios:'circle',android:'radio_button_unchecked'}} size={64} color={theme.green}/><Text accessibilityLiveRegion="polite" style={styles.name}>{ownPending!==undefined?`Saved on this device: ${label(ownPending)}`:!verified?(statuses[member.user.id]===undefined?'Your availability is not verified':`Last known: ${label(statuses[member.user.id])}`):statuses[member.user.id]===undefined?'Your availability is not set':`You Are Currently ${label(statuses[member.user.id])}`}</Text></View>{controls(member.user.id)}</>}
  </ScrollView></SafeAreaView>;
}
