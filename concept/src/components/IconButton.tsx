import React, {ComponentProps} from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {colors, radii, spacing} from '../theme';

type Props = {icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; tone?: 'primary' | 'neutral'};

export function IconButton({icon, label, onPress, tone = 'primary'}: Props) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed}) => [styles.button, tone === 'neutral' && styles.neutral, pressed && styles.pressed]}>
    <Ionicons name={icon} size={22} color={colors.white}/>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: {width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red, padding: spacing.sm},
  neutral: {backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border},
  pressed: {opacity: 0.72, transform: [{scale: 0.96}]},
});
