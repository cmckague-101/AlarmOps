import type { CrewMember } from '@fireops/domain';
import { userRoleLabel } from '@fireops/domain';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppSymbol } from '@/components/app-symbol';
import { useFireOpsTheme } from '@/theme';

/** Manager-only picker that opens "My records" or another crew member's master record. */
export function CrewReview({ viewer, crew, onOpenMasterRecord }: { viewer: CrewMember; crew: CrewMember[]; onOpenMasterRecord: (member: CrewMember) => void }) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const members = useMemo(
    () => crew.filter((member) => member.id !== viewer.id).sort((a, b) => a.name.localeCompare(b.name)),
    [crew, viewer.id],
  );
  const [open, setOpen] = useState(false);
  const openRecord = (member: CrewMember) => {
    setOpen(false);
    onOpenMasterRecord(member);
  };

  return <View style={styles.container}>
    <View style={styles.heading}>
      <View style={styles.mark}><AppSymbol name={{ ios: 'person.2.fill', android: 'group' } as never} color={theme.ember} size={20} /></View>
      <View style={styles.grow}>
        <Text accessibilityRole="header" style={styles.title}>Crew records</Text>
        <Text style={styles.subtitle}>Open your master record or review another crew member’s.</Text>
      </View>
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Select a record"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [styles.trigger, open && styles.triggerOpen, pressed && styles.pressed]}
    >
      <View style={styles.triggerIcon}><AppSymbol name={{ ios: 'person.2.fill', android: 'group' } as never} color={theme.ember} size={17} /></View>
      <View style={styles.grow}>
        <Text style={styles.triggerTitle}>Select a record</Text>
        <Text style={styles.small}>My records + {members.length} {members.length === 1 ? 'crew member' : 'crew members'}</Text>
      </View>
      <AppSymbol name={open ? 'chevron.up' : 'chevron.down'} color={open ? theme.ember : theme.secondary} size={15} />
    </Pressable>
    {open && <View style={styles.menu}>
      <Pressable accessibilityRole="button" accessibilityLabel={`My records, ${viewer.name}`} onPress={() => openRecord(viewer)} style={({ pressed }) => [styles.option, styles.selfOption, pressed && styles.pressed]}>
        <View style={[styles.avatar, styles.selfAvatar]}><AppSymbol name={{ ios: 'person.crop.circle', android: 'account_circle' } as never} color={theme.ember} size={18} /></View>
        <View style={styles.grow}>
          <Text style={styles.optionTitle}>My records</Text>
          <Text style={styles.small} numberOfLines={1}>{viewer.name} · {userRoleLabel(viewer.role)}</Text>
        </View>
      </Pressable>
      {members.length > 0 && <Text style={styles.divider}>CREW</Text>}
      {members.map((member) => (
        <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`${member.name} master record`} onPress={() => openRecord(member)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{member.name.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.grow}>
            <Text style={styles.optionTitle} numberOfLines={1}>{member.name}</Text>
            <Text style={styles.small}>{userRoleLabel(member.role)}{member.status === 'Invited' ? ' · Invited' : ''}</Text>
          </View>
        </Pressable>
      ))}
    </View>}
  </View>;
}

function createStyles(theme: ReturnType<typeof useFireOpsTheme>) { return StyleSheet.create({
  container: { gap: 14, padding: 17, borderRadius: 14, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  grow: { flex: 1, minWidth: 0 },
  mark: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dangerSurface },
  title: { color: theme.ink, fontSize: 15, fontWeight: '800' },
  subtitle: { color: theme.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  trigger: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surfaceAlt },
  triggerOpen: { borderColor: theme.ember, backgroundColor: theme.paper },
  triggerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dangerSurface },
  triggerTitle: { color: theme.ink, fontSize: 14, fontWeight: '800' },
  small: { color: theme.secondary, fontSize: 11, marginTop: 2 },
  menu: { padding: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  selfOption: { backgroundColor: theme.dangerSurface },
  divider: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 4, color: theme.secondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember },
  selfAvatar: { backgroundColor: theme.paper },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  optionTitle: { color: theme.ink, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.72 },
}); }
