import React, {ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '../theme';

type Props = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  compact?: boolean;
};

export function ScreenHeader({title, subtitle, eyebrow, action, compact = false}: Props) {
  return <View style={[styles.header, compact && styles.compact]}>
    <View style={styles.copy}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {action ? <View style={styles.action}>{action}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.lg},
  compact: {marginBottom: spacing.md},
  copy: {flex: 1},
  eyebrow: {...typography.overline, color: colors.red, marginBottom: spacing.xs},
  title: {...typography.screenTitle, color: colors.text},
  compactTitle: {...typography.sectionTitle},
  subtitle: {...typography.body, color: colors.muted, marginTop: spacing.xs},
  action: {alignSelf: 'center'},
});
