import React, {ComponentProps} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {colors, radii, shadows, spacing, typography} from '../theme';

type Props = {title: string; subtitle: string; icon: ComponentProps<typeof Ionicons>['name']; color: string; badge?: string; onPress: () => void; onLongPress?: () => void};

export function AppTile({title, subtitle, icon, color, badge, onPress, onLongPress}: Props) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${subtitle}`} onPress={onPress} onLongPress={onLongPress} style={({pressed}) => [styles.tile, pressed && styles.pressed]}>
    <View style={[styles.icon, {backgroundColor: color}]}>
      <Ionicons name={icon} size={25} color={colors.white}/>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </View>
    <View style={styles.copy}><Text numberOfLines={1} style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text></View>
    <Ionicons name="chevron-forward" size={17} color={colors.disabled}/>
  </Pressable>;
}

const styles = StyleSheet.create({
  tile: {...shadows.card, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  pressed: {opacity: 0.78, transform: [{scale: 0.985}]},
  icon: {width: 46, height: 46, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center'},
  copy: {flex: 1},
  title: {...typography.bodyStrong, color: colors.text},
  subtitle: {...typography.caption, color: colors.muted, marginTop: 2},
  badge: {position: 'absolute', right: -7, top: -7, minWidth: 21, height: 21, paddingHorizontal: 5, borderRadius: 11, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  badgeText: {color: colors.white, fontSize: 10, fontWeight: '900'},
});
