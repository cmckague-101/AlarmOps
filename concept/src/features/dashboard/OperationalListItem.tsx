import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {StatusBadge, StatusTone} from '../../components/StatusBadge';
import {colors, spacing, typography} from '../../theme';

type Props = {title: string; detail: string; meta: string; tone: StatusTone; last?: boolean};

export function OperationalListItem({title, detail, meta, tone, last = false}: Props) {
  return <View style={[styles.row, last && styles.last]}>
    <View style={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
    <StatusBadge label={meta} tone={tone} style={styles.badge}/>
  </View>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth},
  last: {borderBottomWidth: 0, paddingBottom: 0},
  content: {flex: 1},
  title: {...typography.bodyStrong, color: colors.text},
  detail: {...typography.caption, color: colors.muted, marginTop: spacing.xs},
  badge: {marginTop: 1},
});
