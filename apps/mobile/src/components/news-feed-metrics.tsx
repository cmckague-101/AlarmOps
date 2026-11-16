import {useEffect,useMemo,useState} from 'react';
import {createDemoNationalFireActivity,type NationalFireActivity} from '@fireops/domain';
import {StyleSheet,Text,View} from 'react-native';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme,useFireOpsTheme} from '@/theme';

export function NewsFeedMetrics(){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {demoMode}=useSession();
  const [activity,setActivity]=useState<NationalFireActivity|null>(()=>demoMode?createDemoNationalFireActivity():null);
  useEffect(()=>{
    if(demoMode){setActivity(createDemoNationalFireActivity());return}
    let active=true;
    if(!supabase)return;
    void supabase.functions.invoke<NationalFireActivity>('national-fire-activity').then(({data})=>{if(active&&data)setActivity(data)}).catch(()=>undefined);
    return()=>{active=false};
  },[demoMode]);
  const value=(number:number|null|undefined)=>number===null||number===undefined?'—':number.toLocaleString();
  return <View accessibilityLabel="Current national fire conditions" style={styles.grid}>
    <View style={styles.card}><Text style={styles.label}>National PL</Text><Text style={[styles.value,styles.pl]}>{value(activity?.nationalPreparednessLevel)}</Text></View>
    <View style={styles.card}><Text style={styles.label}>Large Fires</Text><Text style={styles.value}>{value(activity?.largeFireCount)}</Text></View>
    <View style={styles.card}><Text style={styles.label}>Red Flags</Text><Text style={[styles.value,styles.flags]}>{value(activity?.redFlagCount)}</Text></View>
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  grid:{flexDirection:'row',gap:8,marginBottom:20},card:{minWidth:0,flex:1,minHeight:88,alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:13,backgroundColor:theme.paper},label:{color:theme.secondary,fontSize:9,fontWeight:'800',letterSpacing:.5,textTransform:'uppercase'},value:{color:theme.ink,fontSize:25,fontWeight:'800',fontVariant:['tabular-nums']},pl:{color:theme.danger},flags:{color:theme.warning}
});}
