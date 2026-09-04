import { useMemo } from 'react';
import { isTrainingUnread, trainingStage, type Training } from '@fireops/domain';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { refreshTrainings, useTrainings } from '@/lib/training-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function datePart(value: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, options).format(date);
}

export default function TrainingScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { trainings, loading, refreshing, error } = useTrainings(member?.company.id ?? null, member?.user.id ?? null);
  const now = new Date();
  const scheduled = trainings.filter((training) => trainingStage(training, now) === 'scheduled');
  const expired = trainings.filter((training) => trainingStage(training, now) === 'expired').sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  if (!session || access.status === 'error') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Training' }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshTrainings} tintColor={theme.command} />}>
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.title}>Training</Text>
            <Text style={styles.subtitle}>Upcoming courses and crew registration.</Text>
          </View>
          {member?.user.role === 'owner' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Create training" onPress={() => router.push('/training/form' as never)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={19} />
              <Text style={styles.addLabel}>New</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? <Text style={styles.stateText}>Loading training schedule…</Text> : null}
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Training unavailable</Text><Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshTrainings} style={styles.retryButton}><Text style={styles.retryLabel}>Try again</Text></Pressable>
          </View>
        ) : null}

        {!error ? (
          <TrainingSection title="Scheduled courses" count={scheduled.length} styles={styles}>
            {scheduled.length ? scheduled.map((training) => <TrainingRow key={training.id} training={training} userId={member?.user.id} unread={member ? isTrainingUnread(training, member.user) : false} onPress={() => router.push(`/training/${encodeURIComponent(training.id)}` as never)} styles={styles} theme={theme} />) : (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><AppSymbol name={{ ios: 'graduationcap', android: 'school' } as never} color={theme.secondary} size={28} /></View>
                <Text style={styles.emptyTitle}>No training scheduled</Text>
                <Text style={styles.emptyText}>{member?.user.role === 'owner' ? 'Create the first course and notify the crew.' : 'New courses will appear when your company owner schedules them.'}</Text>
              </View>
            )}
          </TrainingSection>
        ) : null}

        {!error && expired.length ? (
          <TrainingSection title="Expired" count={expired.length} note="Courses remain for one month" styles={styles}>
            {expired.map((training) => <TrainingRow key={training.id} training={training} userId={member?.user.id} expired onPress={() => router.push(`/training/${encodeURIComponent(training.id)}` as never)} styles={styles} theme={theme} />)}
          </TrainingSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TrainingSection({ title, count, note, children, styles }: { title: string; count: number; note?: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}><View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>{title}</Text>{note ? <Text style={styles.sectionNote}>{note}</Text> : null}</View><Text style={styles.count}>{count}</Text></View><View style={styles.list}>{children}</View></View>;
}

function TrainingRow({ training, userId, unread, expired, onPress, styles, theme }: { training: Training; userId?: string; unread?: boolean; expired?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles>; theme: FireOpsTheme }) {
  const registered = training.signups.some((signup) => signup.userId === userId);
  const full = training.signups.length >= training.capacity;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${training.courseTitle}${unread ? ', new' : ''}${registered ? ', registered' : ''}`} onPress={onPress} style={({ pressed }) => [styles.row, unread && styles.unreadRow, expired && styles.expiredRow, pressed && styles.pressed]}>
      <View style={styles.dateBlock}><Text style={styles.day}>{datePart(training.date, { day: '2-digit' })}</Text><Text style={styles.month}>{datePart(training.date, { month: 'short' }).toUpperCase()}</Text></View>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}><Text numberOfLines={1} style={styles.rowTitle}>{training.courseTitle}</Text>{unread ? <Text style={styles.newBadge}>New</Text> : expired ? <Text style={styles.expiredBadge}>Expired</Text> : registered ? <Text style={styles.registeredBadge}>Registered</Text> : null}</View>
        <Text numberOfLines={1} style={styles.rowMeta}>{training.courseCode} · {training.instructor}</Text>
        <Text numberOfLines={1} style={styles.rowMeta}>{datePart(training.date, { hour: 'numeric', minute: '2-digit' })} · {training.location}</Text>
        <Text style={styles.capacity}>{training.signups.length} / {training.capacity} {full ? '· Course full' : 'registered'}</Text>
      </View>
      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={theme.secondary} size={17} />
    </Pressable>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 27 },
    headingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
    headingCopy: { flex: 1, gap: 6 },
    title: { color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 },
    addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 },
    addLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    section: { gap: 12 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 19 },
    sectionTitle: { color: theme.ink, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    sectionNote: { color: theme.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper },
    row: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    unreadRow: { backgroundColor: theme.dangerSurface },
    expiredRow: { opacity: 0.72 },
    dateBlock: { width: 48, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt },
    day: { color: theme.ink, fontSize: 21, lineHeight: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
    month: { color: theme.secondary, fontSize: 10, lineHeight: 14, fontWeight: '800' },
    rowCopy: { flex: 1, gap: 3 },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { flexShrink: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    newBadge: { overflow: 'hidden', color: theme.ember, backgroundColor: theme.paper, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
    registeredBadge: { overflow: 'hidden', color: theme.green, backgroundColor: theme.greenSurface, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
    expiredBadge: { overflow: 'hidden', color: theme.secondary, backgroundColor: theme.surfaceAlt, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
    rowMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    capacity: { color: theme.secondary, fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 2 },
    empty: { alignItems: 'center', paddingHorizontal: 25, paddingVertical: 44, gap: 8 },
    emptyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: theme.surfaceAlt, marginBottom: 4 },
    emptyTitle: { color: theme.ink, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    emptyText: { maxWidth: 300, color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    stateText: { color: theme.secondary, fontSize: 15, paddingVertical: 24 },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 17, gap: 7 },
    errorTitle: { color: theme.danger, fontSize: 17, fontWeight: '700' },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 },
    retryButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 9, paddingHorizontal: 14 },
    retryLabel: { color: theme.commandText, fontSize: 13, fontWeight: '700' },
    pressed: { opacity: 0.68 },
  });
}
