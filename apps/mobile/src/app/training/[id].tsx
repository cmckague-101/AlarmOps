import { useEffect, useMemo, useState } from 'react';
import { isTrainingUnread, trainingStage } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { cancelTrainingSignup, deleteTraining, markTrainingViewed, signupForTraining, useTrainings } from '@/lib/training-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export default function TrainingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { trainings, loading, error } = useTrainings(member?.company.id ?? null, member?.user.id ?? null);
  const training = trainings.find((item) => item.id === id);
  const expired = training ? trainingStage(training) !== 'scheduled' : false;
  const signedUp = Boolean(training?.signups.some((signup) => signup.userId === member?.user.id));
  const full = Boolean(training && training.signups.length >= training.capacity);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (training && member && member.user.role !== 'owner' && member.user.role !== 'admin' && isTrainingUnread(training, member.user)) {
      void markTrainingViewed(training.id).catch(() => undefined);
    }
  }, [training, member]);

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const toggleRegistration = async () => {
    if (!training || !member || expired) return;
    setBusy(true);
    setActionError('');
    try {
      if (signedUp) await cancelTrainingSignup(training.id);
      else await signupForTraining(training.id, member.user.name);
    } catch (registrationError) {
      setActionError(registrationError instanceof Error ? registrationError.message : 'Registration could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!training) return;
    Alert.alert(
      `Delete ${training.courseTitle}?`,
      'This cancels the course for every crew member and removes all registrations.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          setBusy(true);
          setActionError('');
          void deleteTraining(training.id)
            .then(() => router.back())
            .catch((deleteError) => setActionError(deleteError instanceof Error ? deleteError.message : 'Training could not be deleted.'))
            .finally(() => setBusy(false));
        } },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: training?.courseTitle ?? 'Training' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <Text style={styles.stateText}>Loading course…</Text> : null}
        {!loading && (error || !training) ? <View style={styles.message}><Text style={styles.messageTitle}>{error ? 'Training unavailable' : 'Course not found'}</Text><Text style={styles.messageText}>{error ?? 'This course may have been removed.'}</Text></View> : null}

        {training ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><AppSymbol name={{ ios: 'graduationcap.fill', android: 'school' } as never} color={theme.commandText} size={28} /></View>
              <View style={styles.heroCopy}><Text style={styles.code}>{training.courseCode}</Text><Text accessibilityRole="header" style={styles.title}>{training.courseTitle}</Text><Text style={styles.registrationCount}>{training.signups.length} of {training.capacity} registered</Text></View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Course details</Text>
              <DetailRow icon={{ ios: 'calendar', android: 'calendar_month' }} label="Date" value={formatDate(training.date)} styles={styles} theme={theme} />
              <DetailRow icon={{ ios: 'mappin.and.ellipse', android: 'location_on' }} label="Location" value={training.location} styles={styles} theme={theme} />
              <DetailRow icon={{ ios: 'person.fill', android: 'person' }} label="Instructor" value={training.instructor} styles={styles} theme={theme} />
              <DetailRow icon={{ ios: 'person.2.fill', android: 'groups' }} label="Capacity" value={`${training.signups.length} / ${training.capacity}`} styles={styles} theme={theme} />
            </View>

            {training.information ? <View style={styles.section}><Text style={styles.sectionTitle}>Course information</Text><Text selectable style={styles.information}>{training.information}</Text></View> : null}

            {member?.user.role !== 'owner' && member?.user.role !== 'admin' ? (
              <View style={styles.registrationSection}>
                {expired ? <Text style={styles.expiredMessage}>Course ended. Registration is closed.</Text> : (
                  <>
                    <Pressable accessibilityRole="button" disabled={busy || (!signedUp && full)} onPress={() => void toggleRegistration()} style={({ pressed }) => [signedUp ? styles.secondaryButton : styles.primaryButton, (busy || (!signedUp && full)) && styles.disabled, pressed && styles.pressed]}>
                      <Text style={signedUp ? styles.secondaryLabel : styles.primaryLabel}>{busy ? 'Saving…' : signedUp ? 'Cancel registration' : full ? 'Course full' : 'Sign up for training'}</Text>
                    </Pressable>
                    {signedUp ? <Text style={styles.registeredMessage}>✓ You are registered for this course.</Text> : null}
                  </>
                )}
                {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
              </View>
            ) : null}

            {member?.user.role === 'owner' || member?.user.role === 'admin' ? (
              <View style={styles.section}>
                <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Signed up</Text><Text style={styles.count}>{training.signups.length}</Text></View>
                {training.signups.length ? [...training.signups].sort((a, b) => a.userName.localeCompare(b.userName)).map((signup) => <View key={signup.userId} style={styles.rosterRow}><View style={styles.avatar}><Text style={styles.avatarLabel}>{signup.userName.slice(0, 1).toUpperCase()}</Text></View><View><Text style={styles.rosterName}>{signup.userName}</Text><Text style={styles.rosterMeta}>Registered {formatDate(signup.signedUpAt)}</Text></View></View>) : <Text style={styles.emptyRoster}>No crew members have signed up.</Text>}
              </View>
            ) : null}

            {member?.user.role === 'owner' || member?.user.role === 'admin' ? (
              <View style={styles.ownerActions}>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: '/training/form', params: { id: training.id } } as never)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryLabel}>Edit training</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={confirmDelete} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}><Text style={styles.deleteLabel}>Delete training</Text></Pressable>
                {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value, styles, theme }: { icon: { ios: string; android: string }; label: string; value: string; styles: ReturnType<typeof createStyles>; theme: FireOpsTheme }) {
  return <View style={styles.detailRow}><View style={styles.detailIcon}><AppSymbol name={icon as never} color={theme.secondary} size={19} /></View><View style={styles.detailCopy}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 28 },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingBottom: 24 },
    heroIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: theme.command },
    heroCopy: { flex: 1, gap: 4 },
    code: { color: theme.ember, fontSize: 12, lineHeight: 17, fontWeight: '800', textTransform: 'uppercase' },
    title: { color: theme.ink, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
    registrationCount: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    section: { gap: 10 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: theme.ink, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700' },
    detailRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 9 },
    detailIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: theme.surfaceAlt },
    detailCopy: { flex: 1, gap: 2 },
    detailLabel: { color: theme.secondary, fontSize: 11, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase' },
    detailValue: { color: theme.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' },
    information: { color: theme.ink, fontSize: 15, lineHeight: 23 },
    registrationSection: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 22 },
    primaryButton: { minHeight: 49, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 17 },
    primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.paper, paddingHorizontal: 17 },
    secondaryLabel: { color: theme.ink, fontSize: 15, fontWeight: '700' },
    registeredMessage: { color: theme.green, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    expiredMessage: { color: theme.secondary, backgroundColor: theme.surfaceAlt, borderRadius: 11, padding: 14, fontSize: 14, lineHeight: 20 },
    actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    rosterRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 9 },
    avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: theme.command },
    avatarLabel: { color: theme.commandText, fontSize: 14, fontWeight: '800' },
    rosterName: { color: theme.ink, fontSize: 14, lineHeight: 19, fontWeight: '700' },
    rosterMeta: { color: theme.secondary, fontSize: 11, lineHeight: 16 },
    emptyRoster: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    ownerActions: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 22 },
    deleteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.danger, borderRadius: 11, backgroundColor: theme.paper, paddingHorizontal: 17 },
    deleteLabel: { color: theme.danger, fontSize: 15, fontWeight: '700' },
    stateText: { color: theme.secondary, fontSize: 15, paddingVertical: 28 },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
  });
}
