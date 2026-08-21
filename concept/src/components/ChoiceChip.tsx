import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {colors, radii, spacing, typography} from '../theme';

export function ChoiceChip({label, selected = false, onPress}: {label: string; selected?: boolean; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityState={{selected}} onPress={onPress} style={({pressed}) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}>
    <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: {borderWidth: 1, borderColor: colors.border, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface},
  selected: {backgroundColor: colors.red, borderColor: colors.red},
  pressed: {opacity: 0.75},
  label: {...typography.label, color: colors.muted},
  selectedLabel: {color: colors.white},
});
