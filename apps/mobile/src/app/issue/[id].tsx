import { useMemo, useState } from 'react';
import type { IssuePriority, IssueStatus } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { createFleetId, saveFleetRecord, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const priorities: IssuePriority[] = ['Low', 'Medium', 'High', 'Critical'];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function IssueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const { vehicles, issues, loading, error } = useFleetVehicles(companyId);
  const candidate = issues.find((item) => item.id === id);
  const canView = candidate && user && (user.role === 'owner' || (candidate.createdById ? candidate.createdById === user.id : candidate.createdBy === user.name));
  const issue = canView ? candidate : undefined;
  const vehicle = vehicles.find((item) => item.id === issue?.vehicleId);
  const [updateText, setUpdateText] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState<{ title: string; description: string; priority: IssuePriority }>({ title: '', description: '', priority: 'Medium' });
  const [detailErrors, setDetailErrors] = useState<{ title?: string; description?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const beginEditing = () => {
    if (!issue || user?.role !== 'owner') return;
    setDetails({ title: issue.title, description: issue.description, priority: issue.priority });
    setDetailErrors({});
    setSaveError('');
    setEditingDetails(true);
  };

  const cancelEditing = () => {
    setEditingDetails(false);
    setDetailErrors({});
    setSaveError('');
  };

  const saveDetails = async () => {
    if (!issue || user?.role !== 'owner') return;
    const nextErrors = {
      ...(!details.title.trim() ? { title: 'Issue title is required.' } : {}),
      ...(!details.description.trim() ? { description: 'Description is required.' } : {}),
    };
    setDetailErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const changed = details.title.trim() !== issue.title || details.description.trim() !== issue.description || details.priority !== issue.priority;
    if (!changed) return;

    setSaving(true);
    setSaveError('');
    try {
      await saveFleetRecord('issues', {
        ...issue,
        title: details.title.trim(),
        description: details.description.trim(),
        priority: details.priority,
      });
      setEditingDetails(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Issue details could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveUpdate = async (nextStatus?: IssueStatus) => {
    if (!issue || !user || !updateText.trim()) return;
    const now = new Date().toISOString();
    const status = nextStatus ?? issue.status;
    setSaving(true);
    setSaveError('');
    try {
      await saveFleetRecord('issues', {
        ...issue,
        status,
        resolvedAt: status === 'Resolved' ? issue.resolvedAt ?? now : undefined,
        updates: [{ id: createFleetId(), text: updateText.trim(), createdBy: user.name, createdById: user.id, createdAt: now }, ...issue.updates],
      });
      setUpdateText('');
    } catch (saveIssueError) {
      setSaveError(saveIssueError instanceof Error ? saveIssueError.message : 'Issue update could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: issue?.title ?? 'Issue' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loading ? <Text style={styles.stateText}>Loading issue…</Text> : null}

          {!loading && (error || !issue) ? (
            <View style={styles.message}>
              <Text style={styles.messageTitle}>{error ? 'Issue unavailable' : 'Issue not found'}</Text>
              <Text style={styles.messageText}>{error ?? 'This issue may have been removed or you may not have access.'}</Text>
            </View>
          ) : null}

          {issue ? (
            <>
              {vehicle ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Opens vehicle details"
                  onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}` as never)}
                  style={({ pressed }) => [styles.vehicleContext, pressed && styles.pressed]}
                >
                  <View style={styles.vehicleCopy}>
                    <Text style={styles.vehicleName}>{vehicle.name}</Text>
                    <Text style={styles.vehicleMeta}>{[vehicle.detail, vehicle.type].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={theme.secondary} size={17} />
                </Pressable>
              ) : null}

              <View style={styles.summary}>
                {editingDetails ? (
                  <View style={styles.detailsForm}>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Issue title</Text>
                      <TextInput
                        accessibilityLabel="Issue title"
                        autoFocus
                        maxLength={160}
                        onChangeText={(value) => {
                          setDetails((current) => ({ ...current, title: value }));
                          if (detailErrors.title) setDetailErrors((current) => ({ ...current, title: undefined }));
                        }}
                        style={[styles.input, detailErrors.title && styles.inputError]}
                        value={details.title}
                      />
                      {detailErrors.title ? <Text style={styles.fieldError}>{detailErrors.title}</Text> : null}
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Description</Text>
                      <TextInput
                        accessibilityLabel="Issue description"
                        maxLength={2000}
                        multiline
                        onChangeText={(value) => {
                          setDetails((current) => ({ ...current, description: value }));
                          if (detailErrors.description) setDetailErrors((current) => ({ ...current, description: undefined }));
                        }}
                        style={[styles.input, styles.detailsTextarea, detailErrors.description && styles.inputError]}
                        textAlignVertical="top"
                        value={details.description}
                      />
                      {detailErrors.description ? <Text style={styles.fieldError}>{detailErrors.description}</Text> : null}
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Priority</Text>
                      <View style={styles.priorityOptions}>
                        {priorities.map((priority) => {
                          const selected = details.priority === priority;
                          return (
                            <Pressable
                              key={priority}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selected }}
                              onPress={() => setDetails((current) => ({ ...current, priority }))}
                              style={({ pressed }) => [styles.priorityOption, selected && styles.priorityOptionSelected, pressed && styles.pressed]}
                            >
                              <Text style={[styles.priorityOptionLabel, selected && styles.priorityOptionLabelSelected]}>{priority}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
                    <View style={styles.actions}>
                      <Pressable accessibilityRole="button" disabled={saving} onPress={cancelEditing} style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}>
                        <Text style={styles.statusButtonLabel}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={saving || (details.title.trim() === issue.title && details.description.trim() === issue.description && details.priority === issue.priority)}
                        onPress={() => void saveDetails()}
                        style={({ pressed }) => [styles.primaryButton, (saving || (details.title.trim() === issue.title && details.description.trim() === issue.description && details.priority === issue.priority)) && styles.disabled, pressed && styles.pressed]}
                      >
                        <Text style={styles.primaryLabel}>{saving ? 'Saving…' : 'Save issue'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.badges}>
                      <Text style={[styles.badge, issue.status === 'Open' ? styles.openBadge : styles.resolvedBadge]}>{issue.status}</Text>
                      <Text style={[styles.priority, (issue.priority === 'Critical' || issue.priority === 'High') ? styles.highPriority : issue.priority === 'Medium' ? styles.mediumPriority : styles.lowPriority]}>{issue.priority} priority</Text>
                    </View>
                    <Text style={styles.title}>{issue.title}</Text>
                    <Text style={styles.description} selectable>{issue.description}</Text>
                    <Text style={styles.reported}>Reported by {issue.createdBy} · {formatDate(issue.createdAt)}</Text>
                  </>
                )}
              </View>

              {user?.role === 'owner' && !editingDetails ? (
                <Pressable accessibilityRole="button" onPress={beginEditing} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                  <AppSymbol name={{ ios: 'pencil', android: 'edit' } as never} color={theme.ember} size={17} />
                  <Text style={styles.editButtonLabel}>Edit issue details</Text>
                </Pressable>
              ) : null}

              {!editingDetails ? <View style={styles.section}>
                <Text style={styles.sectionTitle}>Add update</Text>
                <Text style={styles.sectionHelp}>Progress, repair, or inspection notes</Text>
                <TextInput
                  accessibilityLabel="Issue update"
                  maxLength={2000}
                  multiline
                  onChangeText={setUpdateText}
                  placeholder="Describe work completed or next steps"
                  placeholderTextColor={theme.secondary}
                  style={styles.updateInput}
                  textAlignVertical="top"
                  value={updateText}
                />
                {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || !updateText.trim()}
                    onPress={() => void saveUpdate()}
                    style={({ pressed }) => [styles.primaryButton, (saving || !updateText.trim()) && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryLabel}>{saving ? 'Saving…' : 'Add update'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || !updateText.trim()}
                    onPress={() => void saveUpdate(issue.status === 'Open' ? 'Resolved' : 'Open')}
                    style={({ pressed }) => [styles.statusButton, (saving || !updateText.trim()) && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.statusButtonLabel}>{issue.status === 'Open' ? 'Mark resolved' : 'Reopen issue'}</Text>
                  </Pressable>
                </View>
              </View> : null}

              {!editingDetails ? <View style={styles.section}>
                <Text style={styles.sectionTitle}>Updates · {issue.updates.length}</Text>
                {issue.updates.length ? (
                  <View style={styles.timeline}>
                    {issue.updates.map((update) => (
                      <View key={update.id} style={styles.updateRow}>
                        <View style={styles.timelineDot} />
                        <View style={styles.updateCopy}>
                          <Text style={styles.updateBody} selectable>{update.text}</Text>
                          <Text style={styles.updateMeta}>{update.createdBy} · {formatDate(update.createdAt)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : <Text style={styles.noUpdates}>No updates yet.</Text>}
              </View> : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 28 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 32 },
    vehicleContext: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: theme.surfaceAlt, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 },
    vehicleCopy: { flex: 1, gap: 3 },
    vehicleName: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    vehicleMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    summary: { gap: 10 },
    detailsForm: { gap: 20 },
    fieldGroup: { gap: 8 },
    label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 },
    detailsTextarea: { minHeight: 126, paddingTop: 13, paddingBottom: 13 },
    inputError: { borderColor: theme.danger },
    fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    priorityOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    priorityOption: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 14 },
    priorityOptionSelected: { backgroundColor: theme.command, borderColor: theme.command },
    priorityOptionLabel: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
    priorityOptionLabelSelected: { color: theme.commandText },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    badge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, lineHeight: 16, fontWeight: '800' },
    openBadge: { color: theme.danger, backgroundColor: theme.dangerSurface },
    resolvedBadge: { color: theme.green, backgroundColor: theme.greenSurface },
    priority: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, lineHeight: 16, fontWeight: '700' },
    highPriority: { color: theme.danger, backgroundColor: theme.dangerSurface },
    mediumPriority: { color: theme.warning, backgroundColor: theme.warningSurface },
    lowPriority: { color: theme.green, backgroundColor: theme.greenSurface },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
    description: { color: theme.ink, fontSize: 16, lineHeight: 24 },
    reported: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    section: { gap: 10 },
    editButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.ember, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 16 },
    editButtonLabel: { color: theme.ember, fontSize: 15, fontWeight: '700' },
    sectionTitle: { color: theme.ink, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    sectionHelp: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    updateInput: { minHeight: 116, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 13, fontSize: 15, lineHeight: 22 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    primaryButton: { minHeight: 44, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15 },
    primaryLabel: { color: theme.commandText, fontSize: 14, fontWeight: '700' },
    statusButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper, borderRadius: 10, paddingHorizontal: 15 },
    statusButtonLabel: { color: theme.ink, fontSize: 14, fontWeight: '700' },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    timeline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    updateRow: { flexDirection: 'row', gap: 12, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.green, marginTop: 6 },
    updateCopy: { flex: 1, gap: 6 },
    updateBody: { color: theme.ink, fontSize: 15, lineHeight: 22 },
    updateMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    noUpdates: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    pressed: { opacity: 0.74 },
    disabled: { opacity: 0.45 },
  });
}
