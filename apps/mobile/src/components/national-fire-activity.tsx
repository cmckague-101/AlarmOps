import {useCallback, useEffect, useMemo, useState} from 'react';
import {createDemoNationalFireActivity,type NationalFireActivity} from '@fireops/domain';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {AppSymbol} from './app-symbol';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme, useFireOpsTheme} from '@/theme';

const formatter = new Intl.NumberFormat('en-US');
const totalStats = [
  {key:'incidents',label:'Incidents'},
  {key:'crews',label:'Crews'},
  {key:'engines',label:'Engines'},
  {key:'helicopters',label:'Helicopters'},
  {key:'totalPersonnel',label:'Total Personnel'},
] as const;

const gaccNames: Record<string,string> = {
  AICC:'Alaska Interagency Coordination Center',
  NWCC:'Northwest Area Coordination Center',
  ONCC:'Northern California Coordination Center',
  OSCC:'Southern California Coordination Center',
  NRCC:'Northern Rockies Coordination Center',
  GBCC:'Great Basin Coordination Center',
  SWCC:'Southwest Area Coordination Center',
  RMCC:'Rocky Mountain Area Coordination Center',
  EACC:'Eastern Area Coordination Center',
  SACC:'Southern Area Coordination Center',
};

export function NationalFireActivitySection(){
  const theme=useFireOpsTheme();
  const {demoMode}=useSession();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const [activity,setActivity]=useState<NationalFireActivity|null>(()=>demoMode?createDemoNationalFireActivity():null);
  const [isLoading,setLoading]=useState(!demoMode);
  const [error,setError]=useState('');
  const loadActivity=useCallback(async()=>{
    if(demoMode)return createDemoNationalFireActivity();
    if(!supabase)throw new Error('FireOps data service is not configured.');
    const {data,error:failure}=await supabase.functions.invoke<NationalFireActivity>('national-fire-activity');
    if(failure)throw failure;
    if(!data)throw new Error('NIFC returned no activity data.');
    return data;
  },[demoMode]);
  const fetchActivity=useCallback(()=>{void loadActivity().then(setActivity).catch((failure:unknown)=>setError((failure as {message?:string}).message??'National fire activity could not be loaded.')).finally(()=>setLoading(false));},[loadActivity]);
  useEffect(()=>{fetchActivity();},[fetchActivity]);
  const retry=()=>{setLoading(true);setError('');fetchActivity();};
  const loading=isLoading&&!activity;
  return <View style={styles.panel}>
    <View style={styles.panelHeader}>
      <View style={styles.panelHeading}>
        <Text accessibilityRole="header" style={styles.panelTitle}>National Fire Activity</Text>
        <Text style={styles.reportDate}>{activity?`Active Incident Resource Summary · ${activity.reportDate}`:'Active Incident Resource Summary'}</Text>
      </View>
      {!demoMode&&<Pressable accessibilityRole="link" onPress={()=>activity&&void Linking.openURL(activity.sourceUrl)} disabled={!activity} style={styles.source}><Text style={styles.sourceText}>Source PDF</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'} as never} color={theme.ember} size={16}/></Pressable>}
    </View>
    {loading&&!activity?<Text style={styles.state}>Loading latest NIFC situation report…</Text>:null}
    {error?<View style={styles.error}><Text accessibilityRole="alert" style={styles.errorTitle}>Activity unavailable</Text><Text style={styles.copy}>{error}</Text><Pressable accessibilityRole="button" onPress={retry} style={({pressed})=>[styles.retry,pressed&&styles.pressed]}><Text style={styles.retryText}>Try again</Text></Pressable></View>:null}
    {activity?<>
      <View style={styles.totals}>{totalStats.map(({key,label})=><View style={styles.total} key={key}><Text style={styles.totalLabel}>{label}</Text><Text style={[styles.totalValue,key==='totalPersonnel'&&styles.totalValueEmber]}>{formatter.format(activity.total[key])}</Text></View>)}</View>
      <View style={styles.areas}>
        <Text style={styles.areasHeading}>Incidents by GACC</Text>
        {activity.areas.map((area,index)=><View key={area.gacc} style={[styles.areaRow,index===activity.areas.length-1&&styles.areaRowLast]}><View style={styles.areaNameGroup}><Text style={styles.areaName}>{area.gacc}</Text><Text style={styles.areaFullName}>{gaccNames[area.gacc]}</Text></View><Text style={[styles.areaValue,!area.incidents&&styles.areaValueZero]}>{formatter.format(area.incidents)}</Text></View>)}
      </View>
      <Text style={styles.footnote}>{demoMode?'Fictional sample data for demonstration. Not a current NIFC situation report.':'Data extracted from current National Interagency Coordination Center situation report.'}</Text>
    </>:null}
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  panel:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},panelHeader:{padding:18,gap:14,borderBottomWidth:1,borderBottomColor:theme.divider},panelHeading:{flex:1},panelTitle:{color:theme.ink,fontSize:18,fontWeight:'800'},reportDate:{marginTop:5,color:theme.secondary,fontSize:13},copy:{color:theme.secondary,fontSize:15,lineHeight:22},source:{minHeight:44,alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:7},sourceText:{color:theme.ember,fontSize:14,fontWeight:'800'},state:{padding:20,color:theme.secondary,fontSize:15},error:{padding:20,gap:8},errorTitle:{color:theme.danger,fontSize:17,fontWeight:'800'},retry:{alignSelf:'flex-start',marginTop:7,minHeight:44,justifyContent:'center',paddingHorizontal:16,borderWidth:1,borderColor:theme.divider,borderRadius:9,backgroundColor:theme.paper},retryText:{color:theme.ink,fontWeight:'800'},pressed:{opacity:.65},totals:{flexDirection:'row',flexWrap:'wrap',gap:StyleSheet.hairlineWidth,backgroundColor:theme.divider},total:{flexGrow:1,flexBasis:'30%',gap:5,paddingVertical:14,paddingHorizontal:16,backgroundColor:theme.paper},totalLabel:{color:theme.secondary,fontSize:10,fontWeight:'700',textTransform:'uppercase',letterSpacing:.5},totalValue:{color:theme.ink,fontSize:19,fontWeight:'800',fontVariant:['tabular-nums']},totalValueEmber:{color:theme.ember},areas:{paddingHorizontal:20,paddingTop:18,paddingBottom:8},areasHeading:{color:theme.secondary,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6,marginBottom:6},areaRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},areaRowLast:{borderBottomWidth:0},areaNameGroup:{flex:1,gap:3},areaName:{color:theme.ink,fontSize:15,fontWeight:'700'},areaFullName:{color:theme.secondary,fontSize:12,fontWeight:'600'},areaValue:{color:theme.ember,fontSize:15,fontWeight:'800',fontVariant:['tabular-nums']},areaValueZero:{color:theme.secondary,fontWeight:'600'},footnote:{padding:16,color:theme.secondary,fontSize:12,lineHeight:18}
});}