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
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NifcIncident } from '@fireops/domain';
import { AppSymbol } from '@/components/app-symbol';
import { refreshFleet, updateFleetVehicle, useFleetVehicles, type FleetVehicle } from '@/lib/fleet-store';
import { fetchNifcIncidents } from '@/lib/nifc';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

const US_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 41,
  longitudeDelta: 64,
};

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
  const [showAll, setShowAll] = useState(false);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [fireQuery, setFireQuery] = useState('');
  const [selected, setSelected] = useState<NifcIncident | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchNifcIncidents(controller.signal)
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
  const assignedIncidentIds = useMemo(
    () => new Set(vehicles.map((vehicle) => vehicle.assignedFire?.id).filter((id): id is string => Boolean(id))),
    [vehicles],
  );
  const scopedIncidents = useMemo(
    () => showAll ? incidents : incidents.filter((incident) => assignedIncidentIds.has(incident.id)),
    [assignedIncidentIds, incidents, showAll],
  );
  const mapIncidents = useMemo(
    () => selectedState ? scopedIncidents.filter((incident) => incident.state === selectedState) : scopedIncidents,
    [scopedIncidents, selectedState],
  );
  const sortedFires = useMemo(
    () => [...mapIncidents].sort((a, b) => (b.acres ?? -1) - (a.acres ?? -1) || a.name.localeCompare(b.name)),
    [mapIncidents],
  );
  const normalizedFireQuery = fireQuery.trim().toLocaleLowerCase();
  const fireSearchResults = useMemo(
    () => normalizedFireQuery
      ? incidents
          .filter((incident) => incident.name.toLocaleLowerCase().includes(normalizedFireQuery))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [incidents, normalizedFireQuery],
  );
  const stateGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      if (incident.state) counts.set(incident.state, (counts.get(incident.state) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count, name: US_STATE_NAMES[code] ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [incidents]);

  const changeScope = (all: boolean) => {
    setShowAll(all);
    setSelectedState(null);
    setFireQuery('');
  };

  const chooseState = (state: string) => setSelectedState(state);

  const closeIncidentDetails = () => {
    setVehiclePickerOpen(false);
    setSelected(null);
  };

  const openIncidentDetails = (incident: NifcIncident) => {
    setVehiclePickerOpen(false);
    setSaveError('');
    setSelected(incident);
  };

  const openVehicleFromIncident = (vehicleId: string) => {
    closeIncidentDetails();
    // Wait for native page-sheet dismissal so next route presents above it.
    setTimeout(
      () => router.push(`/vehicle/${encodeURIComponent(vehicleId)}`),
      350,
    );
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.commandForeground} />}
      >
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Operations</Text>
          <Text style={styles.subtitle}>Wildfire assignments and live vehicle position.</Text>
        </View>

        {loading ? <Text style={styles.stateText}>Loading operations…</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}

        {!loading ? (
          <>
            <View style={styles.fireHeading}>
              <View style={styles.fireHeadingCopy}>
                <Text style={styles.sectionTitle}>{showAll ? 'Active fires' : 'Active fire map'}</Text>
                <Text style={styles.sectionCopy}>
                  {showAll ? 'Browse active NIFC incidents by state or fire name.' : 'Showing fires assigned to your fleet.'}
                </Text>
              </View>
              {incidentLoading ? <ActivityIndicator color={theme.commandForeground} /> : null}
            </View>

            <View accessibilityRole="tablist" style={styles.scopeControl}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: !showAll }}
                onPress={() => changeScope(false)}
                style={({ pressed }) => [styles.scopeButton, !showAll && styles.scopeButtonSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.scopeLabel, !showAll && styles.scopeLabelSelected]}>Assigned</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: showAll }}
                onPress={() => changeScope(true)}
                style={({ pressed }) => [styles.scopeButton, showAll && styles.scopeButtonSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.scopeLabel, showAll && styles.scopeLabelSelected]}>All fires</Text>
              </Pressable>
            </View>

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

            {!incidentError && !showAll ? (
              <View style={styles.mapCard}>
                <MapView
                  accessibilityLabel={showAll ? 'Map of all active fires' : 'Map of assigned active fires'}
                  initialRegion={US_REGION}
                  rotateEnabled={false}
                  style={styles.map}
                >
                  {mapIncidents.map((incident) => (
                    <Marker
                      coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
                      description={`${incident.state || 'Location unavailable'} · ${formatAcres(incident.acres)}`}
                      key={incident.id}
                      onCalloutPress={() => openIncidentDetails(incident)}
                      pinColor={theme.danger}
                      title={incident.name}
                      tracksViewChanges={false}
                    />
                  ))}
                </MapView>
                {!incidentLoading && mapIncidents.length === 0 ? (
                  <View pointerEvents="none" style={styles.mapEmptyOverlay}>
                    <View style={styles.mapEmptyCard}>
                      <AppSymbol name={{ ios: 'map.fill', android: 'map' }} size={22} color={theme.commandForeground} />
                      <Text style={styles.mapEmptyTitle}>{showAll ? 'No active fires found' : 'No assigned fires to map'}</Text>
                      <Text style={styles.mapEmptyCopy}>{showAll ? 'Try refreshing NIFC data.' : 'Switch to All fires to browse incidents.'}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {showAll && !incidentError ? (
              <View style={styles.searchField}>
                <AppSymbol name={{ ios: 'magnifyingglass', android: 'search' }} size={18} color={theme.secondary} />
                <TextInput
                  accessibilityLabel="Search fires by name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setFireQuery(value);
                    setSelectedState(null);
                  }}
                  placeholder="Search fires by name"
                  placeholderTextColor={theme.secondary}
                  returnKeyType="search"
                  style={styles.searchInput}
                  value={fireQuery}
                />
                {fireQuery.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear fire search"
                    hitSlop={4}
                    onPress={() => setFireQuery('')}
                    style={({ pressed }) => [styles.searchClearButton, pressed && styles.pressed]}
                  >
                    <AppSymbol name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={19} color={theme.secondary} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {!incidentLoading && !incidentError && showAll && !selectedState && !normalizedFireQuery ? (
              <View style={styles.discoverySection}>
                <SectionHeading title="States" count={stateGroups.length} styles={styles} />
                <Text style={styles.sectionCopy}>Select a state to see its largest active fires first.</Text>
                <View style={styles.list}>
                  {stateGroups.map((state) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${state.name}, ${state.count} active fires`}
                      key={state.code}
                      onPress={() => chooseState(state.code)}
                      style={({ pressed }) => [styles.stateRow, pressed && styles.pressed]}
                    >
                      <View style={styles.stateCodeBadge}><Text style={styles.stateCode}>{state.code}</Text></View>
                      <Text style={styles.stateName}>{state.name}</Text>
                      <Text style={styles.stateCount}>{state.count}</Text>
                      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {!incidentLoading && !incidentError && showAll && normalizedFireQuery ? (
              <View style={styles.discoverySection}>
                <SectionHeading title="Search results" count={fireSearchResults.length} styles={styles} />
                <View style={styles.list}>
                  {fireSearchResults.length === 0 ? (
                    <Text style={styles.emptyText}>No fire names match “{fireQuery.trim()}”.</Text>
                  ) : null}
                  {fireSearchResults.map((incident) => (
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
              </View>
            ) : null}

            {!incidentLoading && !incidentError && (!showAll || selectedState) && !normalizedFireQuery ? (
              <View style={styles.discoverySection}>
                <View style={styles.fireListHeading}>
                  {selectedState ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Back to states"
                      onPress={() => setSelectedState(null)}
                      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                    >
                      <AppSymbol name={{ ios: 'chevron.left', android: 'arrow_back' }} size={17} color={theme.commandForeground} />
                      <Text style={styles.backLabel}>States</Text>
                    </Pressable>
                  ) : null}
                  <SectionHeading
                    title={selectedState ? US_STATE_NAMES[selectedState] ?? selectedState : 'Assigned fires'}
                    count={sortedFires.length}
                    styles={styles}
                  />
                </View>
                {selectedState ? <Text style={styles.sectionCopy}>Sorted largest to smallest by reported acreage.</Text> : null}
                <View style={styles.list}>
                  {sortedFires.length === 0 ? <Text style={styles.emptyText}>No current NIFC incidents match this view.</Text> : null}
                  {sortedFires.map((incident) => (
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
              </View>
            ) : null}

            <Text style={styles.sourceText}>Source: NIFC WFIGS · Active wildfire incidents</Text>

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

            {saveError ? <Text accessibilityRole="alert" style={styles.errorText}>{saveError}</Text> : null}
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
                  <AppSymbol name={{ ios: 'chevron.left', android: 'arrow_back' }} size={18} color={theme.commandForeground} />
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
                  <AppSymbol name={{ ios: 'xmark', android: 'close' }} size={18} color={theme.commandForeground} />
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
                      onPress={() => openVehicleFromIncident(vehicle.id)}
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
    title: { color: theme.commandForeground, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
    subtitle: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 24 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
    sectionTitle: { color: theme.commandForeground, fontSize: 19, lineHeight: 24, fontWeight: '800' },
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
    scopeControl: { flexDirection: 'row', gap: 4, borderRadius: 12, backgroundColor: theme.surfaceAlt, padding: 4 },
    scopeButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
    scopeButtonSelected: { backgroundColor: theme.paper },
    scopeLabel: { color: theme.secondary, fontSize: 14, fontWeight: '800' },
    scopeLabelSelected: { color: theme.commandForeground },
    searchField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingLeft: 14 },
    searchInput: { flex: 1, minHeight: 50, color: theme.ink, fontSize: 16, lineHeight: 21, paddingVertical: 0 },
    searchClearButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    mapCard: { height: 290, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16, backgroundColor: theme.surfaceAlt },
    map: { flex: 1 },
    mapEmptyOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
    mapEmptyCard: { maxWidth: 250, alignItems: 'center', gap: 6, borderRadius: 14, backgroundColor: theme.paper, paddingHorizontal: 20, paddingVertical: 16 },
    mapEmptyTitle: { color: theme.commandForeground, fontSize: 16, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
    mapEmptyCopy: { color: theme.secondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    discoverySection: { gap: 8 },
    fireListHeading: { gap: 2 },
    backButton: { alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: -8, paddingHorizontal: 8 },
    backLabel: { color: theme.commandForeground, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    stateRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    stateCodeBadge: { width: 38, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.surfaceAlt },
    stateCode: { color: theme.commandForeground, fontSize: 12, fontWeight: '800' },
    stateName: { flex: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    stateCount: { color: theme.secondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    fireRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    fireIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dangerSurface },
    modalSafeArea: { flex: 1, backgroundColor: theme.canvas },
    modalContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 28 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    modalTitleCopy: { flex: 1, gap: 5 },
    modalTitle: { color: theme.commandForeground, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
    modalSubtitle: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surfaceAlt },
    incidentMetrics: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: theme.greenSurface, borderRadius: 16, padding: 18 },
    incidentMetric: { flex: 1, gap: 5 },
    metricValue: { color: theme.commandForeground, fontSize: 22, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
    metricLabel: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginHorizontal: 10 },
    detailSection: { gap: 12 },
    controlLabel: { color: theme.commandForeground, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    vehicleDropdown: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 14 },
    vehicleDropdownText: { color: theme.ink, fontSize: 16 },
    readOnlyText: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    pickerList: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
    vehicleOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 10 },
    currentVehicle: { opacity: 0.62 },
    vehicleOptionTitle: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    assignLabel: { color: theme.commandForeground, fontSize: 14, fontWeight: '800' },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 21, paddingVertical: 18 },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 16, gap: 12 },
    errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
    retryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15 },
    retryLabel: { color: theme.canvas, fontSize: 14, fontWeight: '700' },
    sourceText: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    pressed: { opacity: 0.58 },
  });
}
