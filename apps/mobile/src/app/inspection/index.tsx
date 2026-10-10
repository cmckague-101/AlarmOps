import {canInspectVehicle} from '@fireops/domain';
import {useMemo} from 'react';
import {Redirect, Stack, useRouter} from 'expo-router';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {AppSymbol} from '@/components/app-symbol';
import {useFleetVehicles} from '@/lib/fleet-store';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme, useFireOpsTheme} from '@/theme';

function displayStatus(status:string){
  return status.trim().replaceAll('_',' ').replaceAll('-',' ').toLowerCase().split(' ').map(word=>word?word[0].toUpperCase()+word.slice(1):'').join(' ');
}

export default function SelectInspectionVehicleScreen(){
  const router=useRouter();
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {session,access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const companyId=member?.company.id??null;
  const {vehicles,loading,error}=useFleetVehicles(companyId);
  const ordered=useMemo(()=>[...vehicles].sort((a,b)=>a.name.localeCompare(b.name)),[vehicles]);

  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(member&&!canInspectVehicle(member.user.role))return <Redirect href="/(tabs)/fleet"/>;

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{title:'Select vehicle'}}/>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Inspect a vehicle</Text>
        <Text style={styles.subtitle}>Select vehicle to start new inspection.</Text>
      </View>
      {loading?<Text style={styles.state}>Loading vehicles…</Text>:null}
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      {!loading&&!error&&!ordered.length?<View style={styles.empty}><AppSymbol name={{ios:'truck.box.fill',android:'local_shipping'} as never} size={30} color={theme.secondary}/><Text style={styles.emptyTitle}>No vehicles available</Text><Text style={styles.state}>Company fleet has no vehicles yet.</Text></View>:null}
      <View style={styles.list}>{ordered.map(vehicle=><Pressable key={vehicle.id} accessibilityRole="button" accessibilityLabel={`Inspect ${vehicle.name}`} accessibilityHint="Starts a new vehicle inspection" onPress={()=>router.push({pathname:'/inspection/new' as never,params:{vehicleId:vehicle.id}})} style={({pressed})=>[styles.row,pressed&&styles.pressed]}>
        <View style={styles.icon}><AppSymbol name={{ios:'truck.box.fill',android:'local_shipping'} as never} size={22} color={theme.green}/></View>
        <View style={styles.copy}><Text style={styles.name} numberOfLines={1}>{vehicle.name}</Text><Text style={styles.meta} numberOfLines={1}>{[vehicle.type,vehicle.detail].filter(Boolean).join(' · ')||'Vehicle'}</Text></View>
        <Text style={styles.status}>{displayStatus(vehicle.status)}</Text>
        <AppSymbol name={{ios:'chevron.right',android:'chevron_right'} as never} size={17} color={theme.secondary}/>
      </Pressable>)}</View>
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  safe:{flex:1,backgroundColor:theme.canvas},content:{paddingHorizontal:20,paddingTop:24,paddingBottom:48,gap:20},heading:{gap:6},title:{color:theme.ink,fontSize:28,lineHeight:34,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:14,lineHeight:21},list:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:theme.divider},row:{minHeight:76,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider,paddingVertical:12},icon:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:11,backgroundColor:theme.greenSurface},copy:{flex:1,gap:4},name:{color:theme.ink,fontSize:16,fontWeight:'700'},meta:{color:theme.secondary,fontSize:12},status:{maxWidth:90,color:theme.secondary,fontSize:11,fontWeight:'700',textAlign:'right'},state:{color:theme.secondary,fontSize:15,lineHeight:21},error:{color:theme.danger,backgroundColor:theme.dangerSurface,borderRadius:10,padding:13,fontSize:14,lineHeight:20},empty:{alignItems:'center',gap:8,paddingVertical:48},emptyTitle:{color:theme.ink,fontSize:17,fontWeight:'700'},pressed:{opacity:.58},
});}
