import { canWorkShop, shopBoardStatus, shopPriorityLabel, shopPriorityPalette, shopStatusLabel, shopStatusPalette, type ShopJob } from '@fireops/domain';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { useSession } from '@/providers/session-provider';
import { type FireOpsTheme, useFireOpsColorScheme, useFireOpsTheme } from '@/theme';

/** The signed-in member when they can work the shop board (owner, admin, shop tech). */
export function useShopMember() {
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  return { session, access, member, allowed: Boolean(member && canWorkShop(member.user.role)) };
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useFireOpsTheme();
  const styles = createShopStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ShopTag({ job }: { job: ShopJob }) {
  const { colorScheme } = useFireOpsColorScheme();
  const theme = useFireOpsTheme();
  const styles = createShopStyles(theme);
  const status = shopStatusPalette(colorScheme)[shopBoardStatus(job.status)];
  const priority = shopPriorityPalette(colorScheme)[job.priority];
  return (
    <View style={styles.tags}>
      <Text style={[styles.tag, { color: priority.text, backgroundColor: priority.background }]}>{shopPriorityLabel(job.priority)}</Text>
      <Text style={[styles.tag, { color: status.text, backgroundColor: status.background }]}>{shopStatusLabel(job.status)}</Text>
    </View>
  );
}

export function JobRow({ job, context, onPress }: { job: ShopJob; context?: string; onPress: () => void }) {
  const theme = useFireOpsTheme();
  const styles = createShopStyles(theme);
  const urgent = job.priority === 'critical' || job.priority === 'high';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${job.title}, ${shopPriorityLabel(job.priority)}, ${shopStatusLabel(job.status)}`} onPress={onPress}
      style={[styles.card, { borderLeftWidth: 4, borderLeftColor: urgent ? theme.danger : '#FFD400' }]}>
      <View style={styles.cardTop}>
        <Text style={styles.code}>{job.jobNumber}</Text>
        <ShopTag job={job} />
      </View>
      <Text style={styles.title}>{job.title}</Text>
      {job.blockerReason ? <Text style={styles.blocker}>{job.blockerReason}</Text> : null}
      <Text style={styles.meta}>{[context, job.sourceFleetIssueId ? 'Fleet issue' : undefined, job.assignedTechName ?? 'Unassigned'].filter(Boolean).join(' · ')}</Text>
    </Pressable>
  );
}

export function BoardCard({ title, subtitle, count, preview, critical, icon, onPress }: { title: string; subtitle: string; count: number; preview?: string; critical?: boolean; icon: ReactNode; onPress: () => void }) {
  const theme = useFireOpsTheme();
  const styles = createShopStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${count} ${count === 1 ? 'task' : 'tasks'} to complete`} onPress={onPress}
      style={[styles.boardCard, critical && { borderColor: theme.danger, backgroundColor: theme.dangerSurface }]}>
      <View style={[styles.boardIcon, critical && { backgroundColor: theme.danger }]}>{icon}</View>
      <View style={styles.boardCopy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>{subtitle}</Text>
        <Text style={styles.meta}>{count} {count === 1 ? 'task' : 'tasks'} to complete</Text>
        {preview ? <Text style={styles.preview} numberOfLines={1}>{preview}</Text> : null}
      </View>
      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
    </Pressable>
  );
}

export function createShopStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas },
    content: { padding: 20, paddingBottom: 48, gap: 12 },
    subtitle: { color: theme.secondary, fontSize: 15 },
    heading: { marginTop: 8, color: theme.ink, fontSize: 18, fontWeight: '800' },
    legend: { marginTop: 8, color: theme.secondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
    headerAction: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.ember },
    headerActionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    search: { minHeight: 44, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14 },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14 },
    area: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chips: { gap: 8, paddingVertical: 4 },
    chip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper },
    chipSelected: { backgroundColor: theme.ember, borderColor: theme.ember },
    chipText: { color: theme.secondary, fontWeight: '700', fontSize: 13 },
    chipTextSelected: { color: '#fff' },
    disabled: { opacity: 0.55 },
    card: { gap: 8, borderWidth: 1, borderColor: theme.divider, borderRadius: 18, backgroundColor: theme.paper, padding: 16 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
    code: { color: theme.secondary, fontWeight: '800', fontSize: 12 },
    tags: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
    tag: { overflow: 'hidden', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
    title: { color: theme.ink, fontSize: 15, fontWeight: '700' },
    bigTitle: { color: theme.ink, fontSize: 24, fontWeight: '800' },
    blocker: { color: theme.warning, fontSize: 13, fontWeight: '700' },
    meta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    preview: { color: theme.ink, fontSize: 13, fontWeight: '600' },
    empty: { color: theme.secondary, textAlign: 'center', paddingVertical: 28 },
    error: { color: theme.danger, backgroundColor: theme.dangerSurface, padding: 12, borderRadius: 10, overflow: 'hidden' },
    boardCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: theme.divider, borderRadius: 18, backgroundColor: theme.paper, padding: 14 },
    boardIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt },
    boardCopy: { flex: 1, gap: 2 },
    primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember, paddingHorizontal: 14 },
    primaryText: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
    secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.divider, paddingHorizontal: 14 },
    secondaryText: { color: theme.ink, fontWeight: '700' },
    dangerButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: theme.danger, paddingHorizontal: 14 },
    dangerText: { color: theme.danger, fontWeight: '800' },
    actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    segment: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 12, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider },
    segmentItem: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
    segmentSelected: { backgroundColor: theme.ember },
    segmentText: { color: theme.secondary, fontWeight: '700', fontSize: 13 },
    segmentTextSelected: { color: '#fff' },
    note: { gap: 4, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper, padding: 12 },
    noteSystem: { backgroundColor: theme.surfaceAlt },
    noteAuthor: { color: theme.secondary, fontSize: 11, fontWeight: '700' },
    noteBody: { color: theme.ink, fontSize: 14, lineHeight: 20 },
    reading: { gap: 8, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper, padding: 14 },
    readingValue: { color: theme.ink, fontSize: 22, fontWeight: '800' },
    badge: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: theme.greenSurface, color: theme.green, fontSize: 10, fontWeight: '800' },
    check: { minHeight: 44, justifyContent: 'center' },
    checkText: { color: theme.ink, fontWeight: '700' },
  });
}
