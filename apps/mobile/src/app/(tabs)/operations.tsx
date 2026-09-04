import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NifcIncident } from '@fireops/domain';
import { AppSymbol } from '@/components/app-symbol';
import { refreshFleet, updateFleetVehicle, useFleetVehicles, type FleetVehicle } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const NIFC_QUERY = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

type ArcGisFeature = { attributes: Record<string, string | number | null>; geometry?: { x: number; y: number } };
type ArcGisResponse = { features?: ArcGisFeature[]; error?: { message?: string } };

function nullableNumber(value: unknown) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function parseIncident(item: ArcGisFeature): NifcIncident | null {
  const attributes = item.attributes;
  const latitude = Number(item.geometry?.y ?? attributes.InitialLatitude);
  const longitude = Number(item.geometry?.x ?? attributes.InitialLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: String(attributes.UniqueFireIdentifier ?? attributes.OBJECTID),
    name: String(attributes.IncidentName ?? 'Unnamed incident'),
    acres: nullableNumber(attributes.IncidentSize),
    contained: nullableNumber(attributes.PercentContained),
    personnel: nullableNumber(attributes.TotalIncidentPersonnel),
    state: String(attributes.POOState ?? '').replace(/^US-/, ''),
    discovered: nullableNumber(attributes.FireDiscoveryDateTime),
    updated: nullableNumber(attributes.ModifiedOnDateTime_dt),
    latitude,
    longitude,
  };
}

async function fetchIncidents(signal: AbortSignal) {
  const params = new URLSearchParams({
    f: 'json',
    where: "IncidentTypeCategory='WF' AND FireOutDateTime IS NULL",
    outFields: 'OBJECTID,UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,TotalIncidentPersonnel,POOState,FireDiscoveryDateTime,ModifiedOnDateTime_dt,InitialLatitude,InitialLongitude',
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'ModifiedOnDateTime_dt DESC',
    resultRecordCount: '1000',
  });
  const response = await fetch(`${NIFC_QUERY}?${params}`, { signal });
  if (!response.ok) throw new Error(`NIFC request failed with ${response.status}`);
  const body = (await response.json()) as ArcGisResponse;
  if (body.error) throw new Error(body.error.message ?? 'NIFC returned an error');
  return (body.features ?? []).map(parseIncident).filter((item): item is NifcIncident => Boolean(item));
}

function formatAcres(value: number | null) {
  return value === null ? 'Acres unavailable' : `${Math.round(value).toLocaleString()} acres`;
}

function formatTelemetryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function telemetryIsCurrent(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Date.now() - timestamp < 15 * 60 * 1000;
}

function formatSpeed(value: string) {
  const speed = Number(value);
  return Number.isFinite(speed) ? `${Math.round(speed)} mph` : 'Speed unavailable';
}

export default function OperationsScreen() {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const canAssign = user?.role === 'owner';
  const { vehicles, loading, refreshing, error } = useFleetVehicles(companyId);
  const [incidents, setIncidents] = useState<NifcIncident[]>([]);
  const [incidentLoading, setIncidentLoading] = useState(true);
  const [incidentError, setIncidentError] = useState('');
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<NifcIncident | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchIncidents(controller.signal)
      .then(setIncidents)
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return;
        setIncidentError('Current NIFC fire data could not be loaded. Check your connection and try again.');
      })
      .finally(() => setIncidentLoading(false));
    return () => controller.abort();
  }, [request]);

  const assignedVehicles = vehicles.filter((vehicle) => vehicle.assignedFire);
  const telemetryVehicles = vehicles.filter((vehicle) => vehicle.motive);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleIncidents = incidents
    .filter((incident) => !normalizedQuery || `${incident.name} ${incident.state}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 30);

  const closeIncidentDetails = () => {
    setVehiclePickerOpen(false);
    setSelected(null);
  };

  const openIncidentDetails = (incident: NifcIncident) => {
    setVehiclePickerOpen(false);
    setSaveError('');
    setSelected(incident);
  };

  const assignVehicle = async (vehicle: FleetVehicle, incident: NifcIncident | null) => {
    if (!user || !canAssign) return;
    setSavingVehicleId(vehicle.id);
    setSaveError('');
    try {
      await updateFleetVehicle(
        vehicle,
        incident
          ? { status: 'Assigned', assignedFire: { id: incident.id, name: incident.name, state: incident.state } }
          : { status: 'Ready', clearFireAssignment: true },
        user,
        {
          action: incident ? 'Fire assignment updated' : 'Fire assignment cleared',
          detail: incident ? `${vehicle.name} assigned to ${incident.name}` : `${vehicle.name} returned from fire assignment`,
          tone: 'complete',
        },
      );
      if (incident) setVehiclePickerOpen(false);
    } catch (assignmentError) {
      setSaveError(assignmentError instanceof Error ? assignmentError.message : 'Fire assignment could not be saved.');
    } finally {
      setSavingVehicleId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.command} />}
      >
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Operations</Text>
          <Text style={styles.subtitle}>Wildfire assignments and live vehicle position.</Text>
        </View>

        {loading ? <Text style={styles.stateText}>Loading operations…</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}

        {!loading ? (
          <>
            <SectionHeading title="Active assignments" count={assignedVehicles.length} styles={styles} />
            <View style={styles.list}>
              {assignedVehicles.length === 0 ? <Text style={styles.emptyText}>No vehicles are assigned to an active fire.</Text> : null}
              {assignedVehicles.map((vehicle) => (
                <View key={vehicle.id} style={styles.assignmentRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${vehicle.name}`}
                    onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}`)}
                    style={({ pressed }) => [styles.assignmentCopy, pressed && styles.pressed]}
                  >
                    <Text style={styles.rowTitle}>{vehicle.name}</Text>
                    <Text style={styles.rowMeta}>{vehicle.assignedFire?.name} · {vehicle.assignedFire?.state || 'Location pending'}</Text>
                  </Pressable>
                  {canAssign ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Clear fire assignment for ${vehicle.name}`}
                      disabled={savingVehicleId === vehicle.id}
                      onPress={() => assignVehicle(vehicle, null)}
                      style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.clearLabel}>{savingVehicleId === vehicle.id ? 'Saving…' : 'Clear'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>

            <SectionHeading title="Motive telemetry" count={telemetryVehicles.length} styles={styles} />
            <View style={styles.list}>
              {telemetryVehicles.length === 0 ? <Text style={styles.emptyText}>No Motive vehicle telemetry is available.</Text> : null}
              {telemetryVehicles.map((vehicle) => {
                const motive = vehicle.motive!;
                const connected = telemetryIsCurrent(motive.updatedAt);
                return (
                  <Pressable
                    key={vehicle.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open telemetry vehicle ${vehicle.name}`}
                    onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}`)}
                    style={({ pressed }) => [styles.telemetryRow, pressed && styles.pressed]}
                  >
                    <View style={[styles.connectionDot, connected && styles.connectedDot]} />
                    <View style={styles.assignmentCopy}>
                      <View style={styles.telemetryHeading}>
                        <Text style={styles.rowTitle}>{vehicle.name}</Text>
                        <Text style={[styles.connectionLabel, connected && styles.connectedLabel]}>{connected ? 'Connected' : 'Last known'}</Text>
                      </View>
                      <Text style={styles.rowMeta}>
                        {motive.location || 'Location unavailable'} · {formatSpeed(motive.speed)}
                      </Text>
                      <Text style={styles.updatedText}>Updated {formatTelemetryTime(motive.updatedAt)}</Text>
                    </View>
                    <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.fireHeading}>
              <View style={styles.fireHeadingCopy}>
                <Text style={styles.sectionTitle}>NIFC fire assignment</Text>
                <Text style={styles.sectionCopy}>{canAssign ? 'Choose an active incident, then assign a vehicle.' : 'Current active wildfire incidents reported by NIFC.'}</Text>
              </View>
              {incidentLoading ? <ActivityIndicator color={theme.command} /> : null}
            </View>

            <TextInput
              accessibilityLabel="Search active fires"
              autoCapitalize="words"
              onChangeText={setQuery}
              placeholder="Search fire or state"
              placeholderTextColor={theme.secondary}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />

            {incidentError ? (
              <View style={styles.errorBlock}>
                <Text accessibilityRole="alert" style={styles.errorText}>{incidentError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setIncidentLoading(true);
                    setIncidentError('');
                    setRequest((value) => value + 1);
                  }}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryLabel}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            {!incidentLoading && !incidentError ? (
              <View style={styles.list}>
                {visibleIncidents.length === 0 ? <Text style={styles.emptyText}>No active fires match this search.</Text> : null}
                {visibleIncidents.map((incident) => (
                  <Pressable
                    key={incident.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open details for ${incident.name}`}
                    onPress={() => openIncidentDetails(incident)}
                    style={({ pressed }) => [styles.fireRow, pressed && styles.pressed]}
                  >
                    <View style={styles.fireIcon}>
                      <AppSymbol name={{ ios: 'flame.fill', android: 'local_fire_department' }} size={18} color={theme.danger} />
                    </View>
                    <View style={styles.assignmentCopy}>
                      <Text style={styles.rowTitle}>{incident.name}</Text>
                      <Text style={styles.rowMeta}>{incident.state || 'State unavailable'} · {formatAcres(incident.acres)}</Text>
                    </View>
                    <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {saveError ? <Text accessibilityRole="alert" style={styles.errorText}>{saveError}</Text> : null}
            <Text style={styles.sourceText}>Source: NIFC WFIGS · Up to 1,000 recently updated active incidents</Text>
          </>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => vehiclePickerOpen ? setVehiclePickerOpen(false) : closeIncidentDetails()}
        presentationStyle="pageSheet"
        visible={Boolean(selected)}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
          {selected ? vehiclePickerOpen ? (
            <>
              <View style={styles.pickerHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to fire details"
                  onPress={() => setVehiclePickerOpen(false)}
                  style={styles.closeButton}
                >
                  <AppSymbol name={{ ios: 'chevron.left', android: 'arrow_back' }} size={18} color={theme.command} />
                </Pressable>
                <View style={styles.modalTitleCopy}>
                  <Text style={styles.modalTitle}>Select vehicle</Text>
                  <Text style={styles.modalSubtitle}>{selected.name}</Text>
                </View>
              </View>
              <FlatList
                contentContainerStyle={styles.pickerList}
                data={vehicles}
                keyExtractor={(vehicle) => vehicle.id}
                ListEmptyComponent={<Text style={styles.emptyText}>Add a fleet vehicle before assigning this fire.</Text>}
                renderItem={({ item: vehicle }) => {
                  const current = vehicle.assignedFire?.id === selected.id;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: current, disabled: current || savingVehicleId !== null }}
                      disabled={current || savingVehicleId !== null}
                      onPress={() => assignVehicle(vehicle, selected)}
                      style={({ pressed }) => [styles.vehicleOption, current && styles.currentVehicle, pressed && styles.pressed]}
                    >
                      <View style={styles.assignmentCopy}>
                        <Text style={styles.vehicleOptionTitle}>{vehicle.name}</Text>
                        <Text style={styles.rowMeta}>{current ? 'Assigned to this fire' : vehicle.assignedFire ? `Currently at ${vehicle.assignedFire.name}` : `${vehicle.type} · ${vehicle.status}`}</Text>
                      </View>
                      <Text style={styles.assignLabel}>{savingVehicleId === vehicle.id ? 'Saving…' : current ? 'Selected' : 'Assign'}</Text>
                    </Pressable>
                  );
                }}
              />
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleCopy}>
                  <Text style={styles.modalTitle}>{selected.name}</Text>
                  <Text style={styles.modalSubtitle}>{selected.state || 'Location not reported'} · Active wildfire</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close fire details" onPress={closeIncidentDetails} style={styles.closeButton}>
                  <AppSymbol name={{ ios: 'xmark', android: 'close' }} size={18} color={theme.command} />
                </Pressable>
              </View>

              <View style={styles.incidentMetrics}>
                <View style={styles.incidentMetric}>
                  <Text style={styles.metricValue}>{selected.acres === null ? '—' : Math.round(selected.acres).toLocaleString()}</Text>
                  <Text style={styles.metricLabel}>Acres</Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.incidentMetric}>
                  <Text style={styles.metricValue}>{selected.contained === null ? '—' : `${Math.round(selected.contained)}%`}</Text>
                  <Text style={styles.metricLabel}>Contained</Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.incidentMetric}>
                  <Text style={styles.metricValue}>{selected.personnel === null ? '—' : Math.round(selected.personnel).toLocaleString()}</Text>
                  <Text style={styles.metricLabel}>Personnel</Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.sectionTitle}>Assigned vehicles</Text>
                  <Text style={styles.count}>{vehicles.filter((vehicle) => vehicle.assignedFire?.id === selected.id).length}</Text>
                </View>
                <View style={styles.list}>
                  {vehicles.filter((vehicle) => vehicle.assignedFire?.id === selected.id).length === 0 ? (
                    <Text style={styles.emptyText}>No fleet vehicles are assigned to this fire.</Text>
                  ) : null}
                  {vehicles.filter((vehicle) => vehicle.assignedFire?.id === selected.id).map((vehicle) => (
                    <Pressable
                      key={vehicle.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${vehicle.name}`}
                      onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}`)}
                      style={({ pressed }) => [styles.assignmentRow, pressed && styles.pressed]}
                    >
                      <View style={styles.assignmentCopy}>
                        <Text style={styles.rowTitle}>{vehicle.name}</Text>
                        <Text style={styles.rowMeta}>{vehicle.type} · {vehicle.status}</Text>
                      </View>
                      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.controlLabel}>Assign fleet vehicle</Text>
                {canAssign ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Assign fleet vehicle"
                    accessibilityState={{ expanded: vehiclePickerOpen }}
                    disabled={savingVehicleId !== null}
                    onPress={() => setVehiclePickerOpen(true)}
                    style={({ pressed }) => [styles.vehicleDropdown, pressed && styles.pressed]}
                  >
                    <Text style={styles.vehicleDropdownText}>Select vehicle</Text>
                    <AppSymbol name={{ ios: 'chevron.down', android: 'expand_more' }} size={18} color={theme.secondary} />
                  </Pressable>
                ) : (
                  <Text style={styles.readOnlyText}>Owner access is required to change fire assignments.</Text>
                )}
                {saveError ? <Text accessibilityRole="alert" style={styles.errorText}>{saveError}</Text> : null}
              </View>

              <Text style={styles.sourceText}>Incident values come from NIFC WFIGS and may change as agencies report updates.</Text>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

function SectionHeading({ title, count, styles }: { title: string; count: number; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 44, gap: 20 },
    headingGroup: { gap: 6, marginBottom: 8 },
    title: { color: theme.command, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
    subtitle: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 24 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
    sectionTitle: { color: theme.command, fontSize: 19, lineHeight: 24, fontWeight: '800' },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    assignmentRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    assignmentCopy: { flex: 1, gap: 4 },
    rowTitle: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    rowMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    updatedText: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
    clearLabel: { color: theme.danger, fontSize: 14, fontWeight: '700' },
    telemetryRow: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    telemetryHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    connectionDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.secondary },
    connectedDot: { backgroundColor: theme.green },
    connectionLabel: { color: theme.secondary, fontSize: 12, fontWeight: '700' },
    connectedLabel: { color: theme.green },
    fireHeading: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
    fireHeadingCopy: { flex: 1, gap: 4 },
    sectionCopy: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    searchInput: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, fontSize: 16, paddingHorizontal: 14 },
    fireRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    fireIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dangerSurface },
    modalSafeArea: { flex: 1, backgroundColor: theme.canvas },
    modalContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 28 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    modalTitleCopy: { flex: 1, gap: 5 },
    modalTitle: { color: theme.command, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
    modalSubtitle: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surfaceAlt },
    incidentMetrics: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: theme.greenSurface, borderRadius: 16, padding: 18 },
    incidentMetric: { flex: 1, gap: 5 },
    metricValue: { color: theme.command, fontSize: 22, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
    metricLabel: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginHorizontal: 10 },
    detailSection: { gap: 12 },
    controlLabel: { color: theme.command, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    vehicleDropdown: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 14 },
    vehicleDropdownText: { color: theme.ink, fontSize: 16 },
    readOnlyText: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    pickerList: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
    vehicleOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 10 },
    currentVehicle: { opacity: 0.62 },
    vehicleOptionTitle: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    assignLabel: { color: theme.command, fontSize: 14, fontWeight: '800' },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 21, paddingVertical: 18 },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 16, gap: 12 },
    errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
    retryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15 },
    retryLabel: { color: theme.canvas, fontSize: 14, fontWeight: '700' },
    sourceText: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    pressed: { opacity: 0.58 },
  });
}
