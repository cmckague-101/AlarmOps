import React from 'react';
import {ComponentProps} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {colors, radii, spacing, typography} from '../../theme';
import {AssignmentAvailability} from '../../services/availability';

export type DashboardQuickAction = 'Availability' | 'Check Out Gear' | 'Evaluations' | 'Payroll' | 'Receipts' | 'Invoices';

const actions: {id: DashboardQuickAction; icon: ComponentProps<typeof Ionicons>['name']; color: string}[] = [
  {id: 'Availability', icon: 'radio-button-on', color: '#26784A'},
  {id: 'Check Out Gear', icon: 'bag-check', color: '#6B4C2A'},
  {id: 'Evaluations', icon: 'clipboard', color: '#5D4037'},
  {id: 'Payroll', icon: 'wallet', color: '#275F9D'},
  {id: 'Receipts', icon: 'receipt', color: '#C65E00'},
  {id: 'Invoices', icon: 'document-text', color: '#9B205A'},
];

export function DashboardQuickActions({onSelect,availability}: {onSelect: (action: DashboardQuickAction) => void;availability: AssignmentAvailability}) {
  return <View style={styles.grid}>
    {actions.map(action => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={`Open ${action.id}`} onPress={() => onSelect(action.id)} style={({pressed}) => [styles.action, pressed && styles.pressed]}>
      <View style={[styles.icon, {backgroundColor: action.color}]}><Ionicons name={action.icon} size={24} color={colors.white}/></View>
      <Text style={styles.label}>{action.id}</Text>
      {action.id === 'Availability' ? <Text style={[styles.status, availability === 'Available' && styles.statusOn]}>{availability}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.disabled}/>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  action: {width: '48%', minWidth: 0, alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  pressed: {opacity: 0.76, transform: [{scale: 0.98}]},
  icon: {width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center'},
  label: {...typography.caption, color: colors.text, fontWeight: '800'},
  status: {color: colors.red, fontSize: 10, fontWeight: '900'},
  statusOn: {color: colors.green},
});
