import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Card} from '../../components/Card';
import {StatusBadge} from '../../components/StatusBadge';
import {fetchNifcSituation, fallbackNifcSituation, NifcSituationSummary} from '../../services/nifcSituation';
import {colors, radii, spacing, typography} from '../../theme';

export function NifcSituationTable() {
  const[data,setData]=useState<NifcSituationSummary>(fallbackNifcSituation);
  const[loading,setLoading]=useState(false);
  const[usingFallback,setUsingFallback]=useState(true);

  async function refresh(){
    setLoading(true);
    try{
      const next=await fetchNifcSituation();
      setData(next);
      setUsingFallback(next===fallbackNifcSituation);
    }catch{
      setData(fallbackNifcSituation);
      setUsingFallback(true);
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{refresh()},[]);

  return <Card>
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={styles.title}>NIFC Daily Situation Report</Text>
        <Text style={styles.updated}>Report: {new Date(data.reportDate).toLocaleDateString()} · 0730 MT</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh NIFC situation report" onPress={refresh} style={styles.refresh}>
        {loading?<ActivityIndicator size="small" color={colors.white}/>:<Text style={styles.refreshText}>Refresh</Text>}
      </Pressable>
    </View>
    {usingFallback?<Text style={styles.fallback}>Official cached snapshot</Text>:<Text style={styles.live}>Daily feed connected</Text>}
    <View style={styles.summaryRow}>
      <Summary label="National PL" value={`PL ${data.preparednessLevel}`} tone="critical"/>
      <Summary label="Large fires" value={data.largeFires.toLocaleString()} tone="warning"/>
    </View>
    <Text style={styles.subheading}>Active Incident Resource Summary</Text>
    <View style={styles.resourceGrid}>
      <Resource value={data.activeIncidents} label="Incidents"/>
      <Resource value={data.crewsCommitted} label="Crews"/>
      <Resource value={data.enginesCommitted} label="Engines"/>
      <Resource value={data.helicoptersCommitted} label="Helicopters"/>
      <Resource value={data.personnelCommitted} label="Personnel" wide/>
    </View>
    <Text style={styles.subheading}>Uncontained Large Fires by Area</Text>
    <View style={styles.tableHeader}><Text style={styles.areaHeader}>Geographic area</Text><Text style={styles.numberHeader}>Large fires</Text></View>
    {data.areas.map((area,index)=><View key={area.area} style={[styles.tableRow,index===data.areas.length-1&&styles.lastRow]}><Text style={styles.area}>{area.area}</Text><Text style={styles.number}>{area.largeFires}</Text></View>)}
    <Text style={styles.source}>Source: National Interagency Coordination Center IMSR</Text>
  </Card>;
}

function Summary({label,value,tone}:{label:string;value:string;tone:'critical'|'info'|'warning'}){return <View style={styles.summary}><StatusBadge label={label} tone={tone}/><Text style={styles.summaryValue}>{value}</Text></View>}
function Resource({value,label,wide=false}:{value:number;label:string;wide?:boolean}){return <View style={[styles.resource,wide&&styles.resourceWide]}><Text style={styles.resourceValue}>{value.toLocaleString()}</Text><Text style={styles.resourceLabel}>{label}</Text></View>}

const styles=StyleSheet.create({heading:{flexDirection:'row',alignItems:'flex-start',gap:spacing.md},headingCopy:{flex:1},title:{...typography.cardTitle,color:colors.text},updated:{...typography.caption,color:colors.muted,marginTop:spacing.xs},refresh:{minWidth:68,minHeight:36,borderRadius:radii.md,backgroundColor:colors.red,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.sm},refreshText:{...typography.label,color:colors.white},fallback:{...typography.caption,color:colors.amber,marginTop:spacing.sm},live:{...typography.caption,color:colors.green,marginTop:spacing.sm},summaryRow:{flexDirection:'row',gap:spacing.sm,marginTop:spacing.lg,marginBottom:spacing.sm},summary:{flex:1,minWidth:0},summaryValue:{...typography.sectionTitle,color:colors.text,marginTop:spacing.sm},subheading:{...typography.label,color:colors.textSecondary,textTransform:'uppercase',letterSpacing:.7,marginTop:spacing.lg,marginBottom:spacing.sm},resourceGrid:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},resource:{width:'48%',backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,borderRadius:radii.md,padding:spacing.md},resourceWide:{width:'100%'},resourceValue:{...typography.sectionTitle,color:colors.text},resourceLabel:{...typography.caption,color:colors.muted,marginTop:spacing.xs},tableHeader:{flexDirection:'row',paddingVertical:spacing.sm,borderBottomWidth:1,borderBottomColor:colors.borderStrong},areaHeader:{...typography.label,color:colors.muted,flex:1,textTransform:'uppercase'},numberHeader:{...typography.label,color:colors.muted,textTransform:'uppercase'},tableRow:{flexDirection:'row',alignItems:'center',paddingVertical:spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.border},lastRow:{borderBottomWidth:0},area:{...typography.body,color:colors.text,flex:1},number:{...typography.bodyStrong,color:colors.text,textAlign:'right'},source:{...typography.caption,color:colors.disabled,marginTop:spacing.md}});
