import React, {PropsWithChildren} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../../theme';

type Props = PropsWithChildren<{title: string; detail?: string}>;

export function DashboardSection({title, detail, children}: Props) {
  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  section: {marginTop: spacing.xxl},
  heading: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md},
  title: {...typography.sectionTitle, color: colors.text},
  detail: {...typography.caption, color: colors.muted, textAlign: 'right'},
});
