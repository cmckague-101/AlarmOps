import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme';

export function SectionHeader({title, detail}: {title: string; detail?: string}) {
  return <View style={styles.row}><Text style={styles.title}>{title}</Text>{detail ? <Text style={styles.detail}>{detail}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.md},
  title: {...typography.sectionTitle, color: colors.text},
  detail: {...typography.caption, color: colors.muted},
});
