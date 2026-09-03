import { useMemo } from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
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

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const { vehicles, crew, loading, error } = useFleetVehicles(companyId);
  const vehicle = vehicles.find((item) => item.id === id);
  const assignedName = crew.find((member) => member.id === vehicle?.assignedTo)?.name;

  if (!session || access.status === 'error') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: vehicle?.name ?? 'Vehicle' }} />
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
            </View>

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
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
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
    section: { gap: 13 },
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
  });
}
