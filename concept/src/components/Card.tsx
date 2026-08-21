import React,{PropsWithChildren} from 'react';
import {StyleProp,StyleSheet,View,ViewStyle} from 'react-native';
import {colors, radii, shadows, spacing} from '../theme';

type CardVariant = 'default' | 'elevated' | 'outlined' | 'critical';
type CardProps = PropsWithChildren<{style?: StyleProp<ViewStyle>; variant?: CardVariant}>;

export function Card({children, style, variant = 'default'}: CardProps) {
  return <View style={[styles.card, variantStyles[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
});

const variantStyles = StyleSheet.create({
  default: {},
  elevated: {...shadows.card, backgroundColor: colors.backgroundElevated},
  outlined: {backgroundColor: 'transparent', borderColor: colors.borderStrong},
  critical: {backgroundColor: colors.redSubtle, borderColor: colors.red},
});
