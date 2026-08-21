import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({label, onPress, variant = 'primary', disabled = false, loading = false, accessibilityLabel, style}: Props) {
  const inactive = disabled || loading;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{disabled: inactive, busy: loading}}
    disabled={inactive}
    onPress={onPress}
    style={({pressed}) => [styles.button, variants[variant], pressed && !inactive && styles.pressed, inactive && styles.disabled, style]}
  >
    {loading ? <ActivityIndicator color={variant === 'ghost' ? colors.red : colors.white}/> : <Text style={[styles.label, variant === 'ghost' && styles.ghostLabel]}>{label}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: {minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radii.md, borderWidth: 1},
  label: {...typography.bodyStrong, color: colors.white, letterSpacing: 0.3},
  ghostLabel: {color: colors.red},
  pressed: {opacity: 0.78},
  disabled: {opacity: 0.45},
});

const variants = StyleSheet.create({
  primary: {backgroundColor: colors.red, borderColor: colors.red},
  secondary: {backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong},
  danger: {backgroundColor: colors.redDark, borderColor: colors.red},
  ghost: {backgroundColor: 'transparent', borderColor: colors.red},
});
