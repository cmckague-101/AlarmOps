import React from 'react';
import {Pressable,StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Card} from '../../components/Card';
import {StatusTone} from '../../components/StatusBadge';
import {colors, radii, spacing, typography} from '../../theme';
import {OperationalMetric} from './dashboardData';

const toneColors: Record<StatusTone, string> = {
  neutral: colors.textSecondary,
  info: colors.blue,
  success: colors.green,
  warning: colors.amber,
  critical: colors.red,
};

export function OperationalMetricCard({metric,onPress}: {metric: OperationalMetric;onPress:()=>void}) {
  const tone = toneColors[metric.tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${metric.label}`} onPress={onPress} style={({pressed})=>[styles.pressable,pressed&&styles.pressed]}><Card style={styles.card}>
    <View style={styles.topRow}>
      <View style={[styles.icon, {borderColor: tone}]}><Ionicons name={metric.icon} size={18} color={tone}/></View>
      <Text style={[styles.value, {color: tone}]}>{metric.value}</Text>
    </View>
    <Text style={styles.label}>{metric.label}</Text>
    <Text style={styles.detail}>{metric.detail}</Text>
    <View style={styles.link}><Text style={[styles.linkText,{color:tone}]}>View Details</Text><Ionicons name="chevron-forward" size={14} color={tone}/></View>
  </Card></Pressable>;
}

const styles = StyleSheet.create({
  pressable:{width:'48%'},
  pressed:{opacity:.72,transform:[{scale:.98}]},
  card: {width: '100%', minHeight: 166},
  topRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  icon: {width: 34, height: 34, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  value: typography.metric,
  label: {...typography.bodyStrong, color: colors.text, marginTop: spacing.md},
  detail: {...typography.caption, color: colors.muted, marginTop: spacing.xs},
  link:{flexDirection:'row',alignItems:'center',gap:2,marginTop:spacing.sm},
  linkText:{fontSize:11,fontWeight:'900'},
});
