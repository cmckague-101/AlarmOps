import { useMemo, useState } from 'react';
import type { VehicleStatus } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { refreshFleet, updateFleetVehicle, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function displayStatus(status: string) {
  return status
    .trim()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .split(' ')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '')
    .join(' ');
}

function statusTone(status: string): 'ready' | 'attention' | 'assigned' {
  const value = status.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
  if (['ready', 'available', 'in service', 'active'].includes(value)) return 'ready';
  if (['maintenance', 'inspection', 'out of service', 'offline'].includes(value)) return 'attention';
  return 'assigned';
}

function formattedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function DetailRow({ label, value, styles }: { label: string; value: string | null; styles: DetailStyles }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>{value}</Text>
    </View>
  );
}

type DetailStyles = ReturnType<typeof createStyles>;
const vehicleStatuses: VehicleStatus[] = ['Ready', 'Assigned', 'Maintenance', 'Out of service'];

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const { vehicles, issues, crew, loading, error } = useFleetVehicles(companyId);
  const vehicle = vehicles.find((item) => item.id === id);
  const assignedName = crew.find((member) => member.id === vehicle?.assignedTo)?.name;
  const openIssues = issues.filter((issue) => issue.vehicleId === id && issue.status === 'Open');
  const activeCrew = crew.filter((member) => member.status === 'Active');
  const canManage = user?.role === 'owner';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const [crewQuery, setCrewQuery] = useState('');
  const visibleCrew = activeCrew.filter((member) => member.name.toLowerCase().includes(crewQuery.trim().toLowerCase()));

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const changeStatus = async (status: VehicleStatus) => {
    if (!vehicle || !user || !canManage || vehicle.status === status) return;
    if (status === 'Assigned' && !vehicle.assignedTo) {
      setSaveError('Assign crew member before setting status to Assigned.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await updateFleetVehicle(
        vehicle,
        status === 'Assigned' ? { status } : { status, clearAssignment: true },
        user,
        { action: `${vehicle.name} status changed to ${status}`, detail: `Previous status: ${vehicle.status}`, tone: ['Maintenance', 'Out of service'].includes(status) ? 'urgent' : 'complete' },
      );
    } catch (mutationError) {
      setSaveError(mutationError instanceof Error ? mutationError.message : 'Status could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const changeAssignment = async (memberId?: string) => {
    if (!vehicle || !user || saving) return;
    const member = activeCrew.find((item) => item.id === memberId);
    setSaving(true);
    setSaveError('');
    try {
      await updateFleetVehicle(
        vehicle,
        memberId ? { status: 'Assigned', assignedTo: memberId } : { status: vehicle.status === 'Assigned' ? 'Ready' : vehicle.status as VehicleStatus, clearAssignment: true },
        user,
        {
          action: memberId === user.id ? `${user.name} assigned ${vehicle.name} to themselves` : memberId ? `${vehicle.name} assignment updated` : `${user.name} unassigned ${vehicle.name}`,
          detail: member ? `Assigned to ${member.name}` : 'Vehicle returned to ready status',
          tone: 'complete',
        },
      );
    } catch (mutationError) {
      setSaveError(mutationError instanceof Error ? mutationError.message : 'Assignment could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{
        title: vehicle?.name ?? 'Vehicle',
        headerRight: canManage && vehicle ? () => (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${vehicle.name}`} onPress={() => router.push({ pathname: '/vehicle/form', params: { id: vehicle.id } })} style={({ pressed }) => [styles.headerEdit, pressed && styles.headerEditPressed]}>
            <AppSymbol name="pencil" color={theme.ember} size={17} />
            <Text style={styles.headerEditLabel}>Edit</Text>
          </Pressable>
        ) : undefined,
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <Text style={styles.stateText}>Loading vehicle…</Text> : null}

        {!loading && (error || !vehicle) ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{error ? 'Vehicle unavailable' : 'Vehicle not found'}</Text>
            <Text style={styles.messageText}>{error ?? 'This vehicle may have been removed or you may no longer have access.'}</Text>
            <Pressable accessibilityRole="button" onPress={refreshFleet} style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {vehicle ? (
          <>
            <View style={styles.identity}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{vehicle.name}</Text>
                <View style={[styles.statusBadge, styles[`${statusTone(vehicle.status)}Badge`]]}>
                  <Text style={[styles.statusText, styles[`${statusTone(vehicle.status)}Text`]]}>{displayStatus(vehicle.status)}</Text>
                </View>
              </View>
              <Text style={styles.vehicleSummary}>{[vehicle.type, vehicle.detail].filter(Boolean).join(' · ')}</Text>
              {vehicle.assignedTo ? <Text style={styles.assignment}>Assigned to {assignedName ?? 'Crew member'}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/issue/new' as never, params: { vehicleId: vehicle.id } })}
                style={({ pressed }) => [styles.openIssueButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.openIssueLabel}>Open issue</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Current status</Text>
              {canManage ? (
                <View style={styles.choiceList}>
                  {vehicleStatuses.map((status) => {
                    const selected = vehicle.status === status;
                    const disabled = saving || (status === 'Assigned' && !vehicle.assignedTo);
                    return (
                      <Pressable
                        key={status}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled }}
                        disabled={disabled}
                        onPress={() => void changeStatus(status)}
                        style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, disabled && styles.disabled, pressed && styles.buttonPressed]}
                      >
                        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{status}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.readOnlyStatus}>Status changes are managed by company owner.</Text>
              )}

              {canManage ? (
                <>
                  <Text style={styles.controlLabel}>Assigned crew member</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Assigned crew member"
                    accessibilityState={{ expanded: crewPickerOpen, disabled: saving }}
                    disabled={saving}
                    onPress={() => setCrewPickerOpen(true)}
                    style={({ pressed }) => [styles.crewDropdown, saving && styles.disabled, pressed && styles.buttonPressed]}
                  >
                    <Text style={[styles.crewDropdownText, !assignedName && styles.crewDropdownPlaceholder]} numberOfLines={1}>
                      {assignedName ?? 'No crew member assigned'}
                    </Text>
                    <AppSymbol name={{ ios: 'chevron.down', android: 'arrow_drop_down' } as never} color={theme.secondary} size={18} />
                  </Pressable>
                </>
              ) : user ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || Boolean(vehicle.assignedTo && vehicle.assignedTo !== user.id) || (!vehicle.assignedTo && vehicle.status !== 'Ready')}
                  onPress={() => void changeAssignment(vehicle.assignedTo === user.id ? undefined : user.id)}
                  style={({ pressed }) => [styles.assignmentButton, (saving || Boolean(vehicle.assignedTo && vehicle.assignedTo !== user.id) || (!vehicle.assignedTo && vehicle.status !== 'Ready')) && styles.disabled, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.assignmentButtonLabel}>
                    {saving ? 'Saving…' : vehicle.assignedTo === user.id ? 'Remove my assignment' : vehicle.assignedTo ? 'Assigned to another member' : vehicle.status !== 'Ready' ? 'Vehicle unavailable' : 'Assign to me'}
                  </Text>
                </Pressable>
              ) : null}
              {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
            </View>

            {openIssues.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Open issues · {openIssues.length}</Text>
                <View style={styles.issueList}>
                  {openIssues.map((issue) => (
                    <Pressable
                      key={issue.id}
                      accessibilityRole="button"
                      onPress={() => router.push(`/issue/${encodeURIComponent(issue.id)}` as never)}
                      style={({ pressed }) => [styles.detailIssueRow, pressed && styles.buttonPressed]}
                    >
                      <View style={styles.detailIssueMain}>
                        <Text style={styles.detailIssueTitle}>{issue.title}</Text>
                        <Text style={styles.detailIssueMeta}>{issue.priority} priority · {issue.updates.length} {issue.updates.length === 1 ? 'update' : 'updates'}</Text>
                      </View>
                      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={theme.secondary} size={17} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Vehicle information</Text>
              <View style={styles.details}>
                <DetailRow label="Unit" value={vehicle.name} styles={styles} />
                <DetailRow label="Type" value={vehicle.type} styles={styles} />
                <DetailRow label="Year" value={vehicle.year} styles={styles} />
                <DetailRow label="Make" value={vehicle.make} styles={styles} />
                <DetailRow label="Model" value={vehicle.model} styles={styles} />
                <DetailRow label="VIN" value={vehicle.vin} styles={styles} />
                <DetailRow label="Plate" value={vehicle.plate} styles={styles} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Documents</Text>
              {vehicle.files.length ? (
                <View style={styles.documents}>
                  {vehicle.files.map(({ label, file }, index) => (
                    <View key={`${label}-${file.name}-${index}`} style={styles.documentRow}>
                      <View style={styles.documentMain}>
                        <Text style={styles.documentLabel}>{label}</Text>
                        <Text style={styles.documentName} numberOfLines={1}>{file.name}</Text>
                      </View>
                      {file.type ? <Text style={styles.documentType}>{file.type.split('/').pop()?.toUpperCase()}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : <Text style={styles.emptyText}>No documents attached.</Text>}
            </View>

            {vehicle.notes ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.notes} selectable>{vehicle.notes}</Text>
              </View>
            ) : null}

            {formattedDate(vehicle.updatedAt) ? <Text style={styles.updated}>Updated {formattedDate(vehicle.updatedAt)}</Text> : null}
          </>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setCrewPickerOpen(false)}
        presentationStyle="pageSheet"
        visible={crewPickerOpen}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Select crew member</Text>
              <Text style={styles.modalSubtitle}>{activeCrew.length} active</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setCrewPickerOpen(false)} hitSlop={10}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="Search crew"
            autoCapitalize="words"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setCrewQuery}
            placeholder="Search crew"
            placeholderTextColor={theme.secondary}
            style={styles.crewSearch}
            value={crewQuery}
          />
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: !vehicle?.assignedTo }}
            onPress={() => { setCrewPickerOpen(false); setCrewQuery(''); void changeAssignment(); }}
            style={({ pressed }) => [styles.crewOption, !vehicle?.assignedTo && styles.crewOptionSelected, pressed && styles.buttonPressed]}
          >
            <Text style={styles.crewOptionName}>No crew member assigned</Text>
            {!vehicle?.assignedTo ? <Text style={styles.crewOptionCheck}>Selected</Text> : null}
          </Pressable>
          <FlatList
            contentContainerStyle={styles.crewResults}
            data={visibleCrew}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(member) => member.id}
            ListEmptyComponent={<Text style={styles.noCrewResults}>No active crew match this search.</Text>}
            renderItem={({ item }) => {
              const selected = vehicle?.assignedTo === item.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => { setCrewPickerOpen(false); setCrewQuery(''); void changeAssignment(item.id); }}
                  style={({ pressed }) => [styles.crewOption, selected && styles.crewOptionSelected, pressed && styles.buttonPressed]}
                >
                  <View style={styles.crewOptionCopy}>
                    <Text style={styles.crewOptionName}>{item.name}</Text>
                    <Text style={styles.crewOptionMeta} numberOfLines={1}>{item.email}</Text>
                  </View>
                  {selected ? <Text style={styles.crewOptionCheck}>Selected</Text> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    headerEdit: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
    headerEditPressed: { opacity: 0.55 },
    headerEditLabel: { color: theme.ember, fontSize: 16, fontWeight: '700' },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 30 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 32 },
    identity: { gap: 8 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
    title: { flex: 1, color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
    statusBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
    statusText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
    readyBadge: { backgroundColor: theme.greenSurface },
    readyText: { color: theme.green },
    assignedBadge: { backgroundColor: theme.warningSurface },
    assignedText: { color: theme.warning },
    attentionBadge: { backgroundColor: theme.dangerSurface },
    attentionText: { color: theme.danger },
    vehicleSummary: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    assignment: { color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    openIssueButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 16, marginTop: 8 },
    openIssueLabel: { color: theme.commandText, fontSize: 14, fontWeight: '700' },
    buttonPressed: { opacity: 0.76 },
    section: { gap: 13 },
    choiceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 13 },
    choiceSelected: { backgroundColor: theme.command, borderColor: theme.command },
    choiceLabel: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
    choiceLabelSelected: { color: theme.commandText },
    readOnlyStatus: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    controlLabel: { color: theme.secondary, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 3 },
    crewDropdown: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 14 },
    crewDropdownText: { flex: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '600' },
    crewDropdownPlaceholder: { color: theme.secondary, fontWeight: '400' },
    assignmentButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15 },
    assignmentButtonLabel: { color: theme.commandText, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    disabled: { opacity: 0.45 },
    issueList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    detailIssueRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    detailIssueMain: { flex: 1, gap: 4 },
    detailIssueTitle: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    detailIssueMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    sectionTitle: { color: theme.ink, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 24, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    detailLabel: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    detailValue: { flex: 1, color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'right' },
    documents: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    documentRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    documentMain: { flex: 1, gap: 3 },
    documentLabel: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '600' },
    documentName: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    documentType: { color: theme.secondary, fontSize: 11, lineHeight: 15, fontWeight: '800' },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    notes: { color: theme.ink, backgroundColor: theme.surfaceAlt, borderRadius: 12, padding: 16, fontSize: 15, lineHeight: 23 },
    updated: { color: theme.secondary, fontSize: 12, lineHeight: 17, fontVariant: ['tabular-nums'] },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    retryButton: { alignSelf: 'flex-start', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, marginTop: 8 },
    retryButtonPressed: { opacity: 0.82 },
    retryLabel: { color: theme.commandText, fontSize: 15, fontWeight: '700' },
    modalSafeArea: { flex: 1, backgroundColor: theme.canvas },
    modalHeader: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    modalTitle: { color: theme.ink, fontSize: 20, lineHeight: 25, fontWeight: '800' },
    modalSubtitle: { color: theme.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    cancelLabel: { color: theme.ember, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    crewSearch: { minHeight: 48, marginHorizontal: 20, marginVertical: 14, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 },
    crewResults: { paddingHorizontal: 20, paddingBottom: 24 },
    crewOption: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    crewOptionSelected: { backgroundColor: theme.greenSurface },
    crewOptionCopy: { flex: 1, gap: 3 },
    crewOptionName: { flex: 1, color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '600' },
    crewOptionMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    crewOptionCheck: { color: theme.green, fontSize: 12, lineHeight: 16, fontWeight: '800' },
    noCrewResults: { color: theme.secondary, fontSize: 15, lineHeight: 22, paddingVertical: 36, textAlign: 'center' },
  });
}
