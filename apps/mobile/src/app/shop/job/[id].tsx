import { SHOP_PARTS_BLOCKER, canAssignShopJobs, canWorkShop, shopBoardStatuses, shopJobPriorities, shopPriorityLabel, shopStatusLabel, type ShopJob, type ShopJobPriority, type ShopJobStatus } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, ShopTag, createShopStyles, useShopMember } from '@/components/shop-ui';
import { createFleetId, fleetReadVersion, saveFleetRecord, useFleetVehicles } from '@/lib/fleet-store';
import { addShopJobNote, assignShopJobTo, assignShopJobToMe, deleteShopJob, updateShopJob, useShop } from '@/lib/shop-store';
import { useFireOpsTheme } from '@/theme';

export default function ShopJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createShopStyles(theme), [theme]);
  const router = useRouter();
  const { session, access, member, allowed } = useShopMember();
  const companyId = allowed ? member!.company.id : null;
  const shop = useShop(companyId);
  const { vehicles, issues, crew } = useFleetVehicles(companyId);
  // Owners, admins and resource bosses pick any active shop worker.
  const mechanics = useMemo(() => member && canAssignShopJobs(member.user.role) ? crew.filter((person) => person.status === 'Active' && canWorkShop(person.role)).sort((a, b) => a.name.localeCompare(b.name)) : [], [crew, member]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const job = shop.jobs.find((item) => item.id === id);
  const notes = useMemo(() => shop.notes.filter((item) => item.jobId === id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [shop.notes, id]);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'ready' && !allowed) return <Redirect href="/" />;
  if (!job) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Shop task' }} />
        <View style={styles.content}><Text style={styles.empty}>{shop.loading ? 'Loading…' : 'This shop task was removed.'}</Text></View>
      </SafeAreaView>
    );
  }
  const unit = job.fleetVehicleId ? vehicles.find((vehicle) => vehicle.id === job.fleetVehicleId)?.name : undefined;
  const assignedToMe = job.assignedTechId === member?.user.id;

  const run = async (action: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try { await action(); return true; } catch (caught) { setError(caught instanceof Error ? caught.message : 'The change could not be saved.'); return false; } finally { setBusy(false); }
  };

  // Closing a task opened for a fleet issue resolves the issue through the normal issue save.
  const resolveLinkedIssue = async (current: ShopJob) => {
    const issue = current.sourceFleetIssueId ? issues.find((item) => item.id === current.sourceFleetIssueId) : undefined;
    if (!issue || issue.status !== 'Open' || !member || !companyId) return;
    const now = new Date().toISOString();
    try {
      await saveFleetRecord('issues', {
        ...issue, status: 'Resolved', resolvedAt: now,
        updates: [{ id: createFleetId(), text: 'Resolved when the shop task was closed', createdBy: member.user.name, createdById: member.user.id, createdAt: now }, ...issue.updates],
      }, { version: fleetReadVersion(issue, 'issues'), companyId, userId: member.user.id });
    } catch {
      Alert.alert('Fleet issue still open', 'The shop task is closed, but the linked fleet issue could not be resolved. Resolve it from the issue screen.');
    }
  };

  const setStatus = (status: ShopJobStatus) => void run(async () => {
    if (status === job.status) return;
    await updateShopJob(job.id, { status, blockerReason: status === 'parts' ? job.blockerReason || SHOP_PARTS_BLOCKER : null });
    if (status === 'done') {
      await resolveLinkedIssue(job);
      router.back();
    }
  });
  const setPriority = (priority: ShopJobPriority) => void run(() => priority === job.priority ? Promise.resolve() : updateShopJob(job.id, { priority }));
  const confirmDelete = () => {
    const remove = () => void run(async () => { await deleteShopJob(job.id); router.back(); });
    if (Platform.OS === 'web') { if (window.confirm(`Delete “${job.title}”? This cannot be undone.`)) remove(); return; }
    Alert.alert('Delete shop task?', `“${job.title}” and its notes are removed. This cannot be undone.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: remove }]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: job.jobNumber }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ShopTag job={job} />
        <Text style={styles.bigTitle}>{job.title}</Text>
        <View style={styles.card}>
          <Text style={styles.title}>{job.kind === 'fleet' ? unit ?? 'Fleet unit' : job.shopArea || 'General shop'}</Text>
          <Text style={styles.meta}>{job.sourceFleetIssueId ? 'From fleet issue · ' : ''}Opened {new Date(job.openedAt).toLocaleString()} by {job.openedByName}</Text>
          <Text style={styles.meta}>{job.assignedTechName ? `Assigned to ${job.assignedTechName}` : 'Unassigned'}</Text>
          {job.description.trim() ? <Text style={styles.noteBody}>{job.description}</Text> : null}
          {job.blockerReason ? <Text style={styles.blocker}>{job.blockerReason}</Text> : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {job.status !== 'done' ? (
          <>
            {!assignedToMe ? (
              <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.disabled]} onPress={() => void run(() => assignShopJobToMe(job.id))}>
                <Text style={styles.primaryText}>Assign to me</Text>
              </Pressable>
            ) : null}
            {mechanics.length ? (
              <>
                <Text style={styles.legend}>ASSIGNED MECHANIC</Text>
                <View style={styles.row}>
                  {mechanics.map((person) => <Chip key={person.id} label={person.name} selected={job.assignedTechId === person.id} disabled={busy} onPress={() => { if (job.assignedTechId !== person.id) void run(() => assignShopJobTo(job.id, person.id)); }} />)}
                </View>
              </>
            ) : null}
            <Text style={styles.legend}>PRIORITY</Text>
            <View style={styles.row}>
              {shopJobPriorities.map(({ value }) => <Chip key={value} label={shopPriorityLabel(value)} selected={job.priority === value} disabled={busy} onPress={() => setPriority(value)} />)}
            </View>
            <Text style={styles.legend}>STATUS</Text>
            <View style={styles.row}>
              {shopBoardStatuses.map((value) => <Chip key={value} label={shopStatusLabel(value)} selected={job.status === value} disabled={busy} onPress={() => setStatus(value)} />)}
            </View>
          </>
        ) : null}

        <Text style={styles.legend}>NOTES</Text>
        <TextInput style={[styles.input, styles.area]} value={note} onChangeText={setNote} maxLength={4000} placeholder="Parts used, findings, next steps…" placeholderTextColor={theme.secondary} multiline />
        <Pressable accessibilityRole="button" disabled={busy || !note.trim()} style={[styles.secondary, (busy || !note.trim()) && styles.disabled]}
          onPress={() => void run(() => addShopJobNote(job.id, note.trim())).then((saved) => { if (saved) setNote(''); })}>
          <Text style={styles.secondaryText}>Add note</Text>
        </Pressable>
        {notes.map((item) => (
          <View key={item.id} style={[styles.note, item.kind === 'system' && styles.noteSystem]}>
            <Text style={styles.noteAuthor}>{item.authorName} · {new Date(item.createdAt).toLocaleString()}</Text>
            <Text style={styles.noteBody}>{item.body}</Text>
          </View>
        ))}

        <View style={styles.actions}>
          {job.status === 'done' ? (
            <>
              <Pressable accessibilityRole="button" disabled={busy} style={[styles.secondary, { flex: 1 }]} onPress={() => setStatus('queued')}><Text style={styles.secondaryText}>Reopen task</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} style={[styles.dangerButton, { flex: 1 }]} onPress={confirmDelete}><Text style={styles.dangerText}>Delete</Text></Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, { flex: 1 }, busy && styles.disabled]} onPress={() => setStatus('done')}><Text style={styles.primaryText}>Close task</Text></Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
