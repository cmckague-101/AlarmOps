import React from 'react';
import {StyleProp, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {colors, radii, spacing, typography} from '../theme';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

type Props = {label: string; tone?: StatusTone; style?: StyleProp<ViewStyle>};

export function StatusBadge({label, tone = 'neutral', style}: Props) {
  const palette = tones[tone];
  return <View accessibilityRole="text" style={[styles.badge, {backgroundColor: palette.background, borderColor: palette.foreground}, style]}>
    <Text style={[styles.label, {color: palette.foreground}]}>{label.toUpperCase()}</Text>
  </View>;
}

const tones = {
  neutral: {foreground: colors.textSecondary, background: colors.surfaceAlt},
  info: {foreground: colors.blue, background: colors.blueSubtle},
  success: {foreground: colors.green, background: colors.greenSubtle},
  warning: {foreground: colors.amber, background: colors.amberSubtle},
  critical: {foreground: colors.red, background: colors.redSubtle},
} as const;

const styles = StyleSheet.create({
  badge: {alignSelf: 'flex-start', borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs},
  label: {...typography.caption, fontSize: 10, fontWeight: '900'},
});
