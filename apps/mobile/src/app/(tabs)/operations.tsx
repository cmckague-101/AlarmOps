import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import statesTopology from 'us-atlas/states-10m.json';

import type { NifcIncident } from '@fireops/domain';
import { AppleIncidentMap } from '@/components/apple-incident-map';
import { AppSymbol } from '@/components/app-symbol';
import { fetchNifcIncidents } from '@/lib/nifc';
import { updateFleetVehicle, useFleetVehicles, type FleetVehicle } from '@/lib/fleet-store';
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

const states = feature(statesTopology as unknown as Topology, 'states') as unknown as FeatureCollection;
const projection = geoAlbersUsa().fitExtent([[20, 20], [880, 540]], states);
const statePath = geoPath(projection);
const MAP_FRAME = { x: 0, y: 0, width: 900, height: 560 };

type MapViewport = typeof MAP_FRAME;

function viewportAround(point: [number, number], zoom: number): MapViewport {
  const width = MAP_FRAME.width / zoom;
  const height = MAP_FRAME.height / zoom;
  return {
    x: Math.max(MAP_FRAME.x, Math.min(MAP_FRAME.width - width, point[0] - width / 2)),
    y: Math.max(MAP_FRAME.y, Math.min(MAP_FRAME.height - height, point[1] - height / 2)),
    width,
    height,
  };
}

function formatAcres(value: number | null) {
  return value === null ? 'Acres unavailable' : `${Math.round(value).toLocaleString()} acres`;
}

function vehicleCoordinates(vehicle: FleetVehicle) {
  const latitude = vehicle.motive?.latitude;
  const longitude = vehicle.motive?.longitude;
  return typeof latitude === 'number' && Number.isFinite(latitude) && typeof longitude === 'number' && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function IncidentMap({
  incidents,
  vehicles,
  onIncidentDetails,
  onVehicleDetails,
  styles,
  theme,
}: {
  incidents: NifcIncident[];
  vehicles: FleetVehicle[];
  onIncidentDetails: (incident: NifcIncident) => void;
  onVehicleDetails: (vehicleId: string) => void;
  styles: ReturnType<typeof createStyles>;
  theme: FireOpsTheme;
}) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([450, 280]);
  const [focusedIncident, setFocusedIncident] = useState<NifcIncident | null>(null);
  const viewport = viewportAround(center, zoom);
  const markerScale = viewport.width / MAP_FRAME.width;
  const viewportRef = useRef(viewport);
  const zoomRef = useRef(zoom);
  const layoutRef = useRef({ width: 0, height: 0 });
  const dragStartRef = useRef(viewport);

  useEffect(() => {
    viewportRef.current = viewport;
    zoomRef.current = zoom;
  }, [viewport, zoom]);

  // PanResponder stores these callbacks; ref reads happen only during touch events.
  // eslint-disable-next-line react-hooks/refs
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      zoomRef.current > 1 && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
    ),
    onPanResponderGrant: () => {
      dragStartRef.current = viewportRef.current;
    },
    onPanResponderMove: (_, gesture) => {
      const start = dragStartRef.current;
      const layout = layoutRef.current;
      if (!layout.width || !layout.height) return;
      const scale = Math.min(layout.width / start.width, layout.height / start.height);
      const x = Math.max(MAP_FRAME.x, Math.min(MAP_FRAME.width - start.width, start.x - gesture.dx / scale));
      const y = Math.max(MAP_FRAME.y, Math.min(MAP_FRAME.height - start.height, start.y - gesture.dy / scale));
      setCenter([x + start.width / 2, y + start.height / 2]);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  const changeZoom = (nextZoom: number) => setZoom(Math.max(1, Math.min(4, nextZoom)));
  const focusIncident = (incident: NifcIncident) => {
    const point = projection([incident.longitude, incident.latitude]);
    if (point) setCenter(point);
    setFocusedIncident(incident);
    setZoom((current) => Math.max(current, 2.5));
  };
  const resetMap = () => {
    setFocusedIncident(null);
    setCenter([450, 280]);
    setZoom(1);
  };

  return (
    <View
      onLayout={(event) => { layoutRef.current = event.nativeEvent.layout; }}
      style={styles.map}
    >
      <Svg
        {...panResponder.panHandlers}
        accessibilityHint={zoom > 1 ? 'Drag to move around the map' : 'Select a fire or zoom in to explore the map'}
        accessibilityLabel={`United States map showing ${incidents.length} active wildfire incidents`}
        accessibilityRole="image"
        style={styles.map}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      >
        <G>
          {states.features.map((state, index) => (
            <Path
              d={statePath(state) ?? undefined}
              fill={theme.paper}
              key={String(state.id ?? index)}
              stroke={theme.divider}
              strokeWidth={1.1 * markerScale}
            />
          ))}
        </G>
        <G>
          {incidents.map((incident, index) => {
            const point = projection([incident.longitude, incident.latitude]);
            if (!point) return null;
            const focused = focusedIncident?.id === incident.id;
            const radius = Math.max(6, Math.min(12, 6 + Math.log10(Math.max(1, incident.acres ?? 1)) * 1.4)) * markerScale;
            return (
              <G key={`${incident.id}-${index}`} onPress={() => focusIncident(incident)}>
                <Circle cx={point[0]} cy={point[1]} fill="transparent" r={24 * markerScale} />
                <Circle
                  cx={point[0]}
                  cy={point[1]}
                  fill={theme.ember}
                  r={radius}
                  stroke={focused ? theme.commandForeground : theme.paper}
                  strokeWidth={(focused ? 3 : 2) * markerScale}
                />
              </G>
            );
          })}
        </G>
        <G>
          {vehicles.map((vehicle, index) => {
            const coords = vehicleCoordinates(vehicle);
            const point = coords ? projection([coords.longitude, coords.latitude]) : null;
            if (!point) return null;
            const iconScale = markerScale * 0.72;
            return (
              <G key={`${vehicle.id}-${index}`} onPress={() => onVehicleDetails(vehicle.id)}>
                <Circle cx={point[0]} cy={point[1]} fill="transparent" r={25 * markerScale} />
                <Circle cx={point[0]} cy={point[1]} fill={theme.green} r={11 * markerScale} stroke={theme.paper} strokeWidth={2.5 * markerScale} />
                <G transform={`translate(${point[0]} ${point[1]}) scale(${iconScale}) translate(-12 -12)`}>
                  <Path d="M10 17h4V5H2v12h3M14 9h4l4 4v4h-2M14 17h1" fill="none" stroke={theme.paper} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  <Circle cx={7.5} cy={17.5} fill={theme.green} r={2.5} stroke={theme.paper} strokeWidth={2} />
                  <Circle cx={17.5} cy={17.5} fill={theme.green} r={2.5} stroke={theme.paper} strokeWidth={2} />
                </G>
              </G>
            );
          })}
        </G>
      </Svg>

      <View style={styles.mapControls}>
        <Pressable accessibilityLabel="Zoom in" accessibilityRole="button" disabled={zoom >= 4} onPress={() => changeZoom(zoom * 1.5)} style={styles.mapControlButton}>
          <AppSymbol name={{ ios: 'plus', android: 'add' }} size={19} color={theme.commandForeground} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom out" accessibilityRole="button" disabled={zoom <= 1} onPress={() => changeZoom(zoom / 1.5)} style={styles.mapControlButton}>
          <AppSymbol name={{ ios: 'minus', android: 'remove' }} size={19} color={theme.commandForeground} />
        </Pressable>
        <Pressable accessibilityLabel="Reset map" accessibilityRole="button" onPress={resetMap} style={styles.mapControlButton}>
          <AppSymbol name={{ ios: 'arrow.counterclockwise', android: 'restart_alt' }} size={18} color={theme.commandForeground} />
        </Pressable>
      </View>

      {focusedIncident ? (
        <Pressable
          accessibilityLabel={`Open details for ${focusedIncident.name}`}
          accessibilityRole="button"
          onPress={() => onIncidentDetails(focusedIncident)}
          style={({ pressed }) => [styles.mapSelection, pressed && styles.pressed]}
        >
          <View style={styles.fireIcon}>
            <AppSymbol name={{ ios: 'flame.fill', android: 'local_fire_department' }} size={18} color={theme.danger} />
          </View>
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.rowTitle}>{focusedIncident.name}</Text>
            <Text style={styles.rowMeta}>{focusedIncident.state || 'State unavailable'} · {formatAcres(focusedIncident.acres)}</Text>
          </View>
          <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function OperationsScreen() {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const user = member?.user ?? null;
  const { vehicles } = useFleetVehicles(member?.company.id ?? null);
  const { incidentId } = useLocalSearchParams<{ incidentId?: string }>();
  const [incidents, setIncidents] = useState<NifcIncident[]>([]);
  const [incidentLoading, setIncidentLoading] = useState(true);
  const [incidentError, setIncidentError] = useState('');
  const [request, setRequest] = useState(0);
  const [fireQuery, setFireQuery] = useState('');
  const [selected, setSelected] = useState<NifcIncident | null>(null);
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchNifcIncidents(controller.signal)
      .then((nextIncidents) => {
        if (!controller.signal.aborted) setIncidents(nextIncidents);
      })
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return;
        if (!controller.signal.aborted) setIncidentError('Current NIFC fire data could not be loaded. Check your connection and try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIncidentLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!incidentId || incidentLoading || incidentError) return;
    void Promise.resolve().then(() => {
      const incident = incidents.find(item => item.id === incidentId);
      if (incident) setSelected(incident);
      else setIncidentError('This fire is no longer available in the current NIFC feed.');
      router.setParams({ incidentId: undefined });
    });
  }, [incidentId, incidentLoading, incidentError, incidents, router]);

  const sortedFires = useMemo(
    () => [...incidents].sort((a, b) => (b.acres ?? -1) - (a.acres ?? -1) || a.name.localeCompare(b.name)),
    [incidents],
  );
  const normalizedFireQuery = fireQuery.trim().toLocaleLowerCase();
  const visibleFires = useMemo(
    () => normalizedFireQuery
      ? sortedFires.filter((incident) => incident.name.toLocaleLowerCase().includes(normalizedFireQuery))
      : sortedFires,
    [normalizedFireQuery, sortedFires],
  );

  const motiveVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.motive), [vehicles]);
  const assignableVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.assignedTo && (user?.role === 'owner' || vehicle.assignedTo === user?.id)),
    [user?.id, user?.role, vehicles],
  );
  const assignVehicleToFire = async (vehicle: FleetVehicle, incident: NifcIncident) => {
    if (!user || assigningVehicleId) return;
    setAssigningVehicleId(vehicle.id);
    setAssignmentError('');
    try {
      await updateFleetVehicle(
        vehicle,
        { status: 'Assigned', assignedFire: { id: incident.id, name: incident.name, state: incident.state } },
        user,
        { action: `${vehicle.name} fire assignment updated`, detail: `Assigned to ${incident.name}`, tone: 'complete' },
      );
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Fire assignment could not be changed.');
    } finally {
      setAssigningVehicleId(null);
    }
  };
  const refreshIncidents = () => {
    setIncidentLoading(true);
    setIncidentError('');
    setRequest((value) => value + 1);
  };
  const openIncidentDetails = (incident: NifcIncident) => setSelected(incident);
  const closeIncidentDetails = () => { setSelected(null); setAssignmentError(''); };
  const openVehicleDetails = (vehicleId: string) => router.push(`/vehicle/${vehicleId}` as never);
  const incidentMap = (
    <>
      {Platform.OS === 'ios' ? (
        <AppleIncidentMap
          incidents={incidents}
          onIncidentDetails={openIncidentDetails}
          onVehicleDetails={openVehicleDetails}
          style={styles.map}
          vehicles={motiveVehicles}
        />
      ) : (
        <IncidentMap
          incidents={incidents}
          onIncidentDetails={openIncidentDetails}
          onVehicleDetails={openVehicleDetails}
          styles={styles}
          theme={theme}
          vehicles={motiveVehicles}
        />
      )}
      {!incidentLoading && incidents.length === 0 && !incidentError ? (
        <View pointerEvents="none" style={styles.mapEmptyOverlay}>
          <View style={styles.mapEmptyCard}>
            <AppSymbol name={{ ios: 'map.fill', android: 'map' }} size={22} color={theme.commandForeground} />
            <Text style={styles.mapEmptyTitle}>No active fires found</Text>
            <Text style={styles.mapEmptyCopy}>Try refreshing NIFC data.</Text>
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <StatusBar hidden={isLandscape} />
      {isLandscape ? (
        <View style={styles.landscapeMap}>
          {incidentMap}
          {incidentLoading ? (
            <View pointerEvents="none" style={styles.landscapeStatusOverlay}>
              <View style={styles.landscapeStatusCard}>
                <ActivityIndicator color={theme.commandForeground} />
              </View>
            </View>
          ) : null}
          {incidentError ? (
            <View style={styles.landscapeStatusOverlay}>
              <View style={styles.landscapeErrorCard}>
                <Text accessibilityRole="alert" style={styles.errorText}>{incidentError}</Text>
                <Pressable accessibilityRole="button" onPress={refreshIncidents} style={styles.retryButton}>
                  <Text style={styles.retryLabel}>Try again</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={incidentLoading} onRefresh={refreshIncidents} tintColor={theme.commandForeground} />}
      >
        <View style={styles.fireHeading}>
          <View style={styles.fireHeadingCopy}>
            <Text style={styles.sectionTitle}>Incident Map</Text>
            <Text style={styles.sectionCopy}>Browse current NIFC incidents by map or fire name.</Text>
          </View>
          {incidentLoading ? <ActivityIndicator color={theme.commandForeground} /> : null}
        </View>

        {incidentError ? (
          <View style={styles.errorBlock}>
            <Text accessibilityRole="alert" style={styles.errorText}>{incidentError}</Text>
            <Pressable accessibilityRole="button" onPress={refreshIncidents} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!incidentError ? (
          <View style={styles.mapCard}>
            {incidentMap}
          </View>
        ) : null}

        {!incidentError ? (
          <View style={styles.searchField}>
            <AppSymbol name={{ ios: 'magnifyingglass', android: 'search' }} size={18} color={theme.secondary} />
            <TextInput
              accessibilityLabel="Search fires by name"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setFireQuery}
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

        {!incidentError && motiveVehicles.length > 0 ? (
          <View style={styles.fleetSection}>
            <SectionHeading title="Fleet locations" count={motiveVehicles.length} styles={styles} />
            <View style={styles.list}>
              {motiveVehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open details for ${vehicle.name}`}
                  onPress={() => openVehicleDetails(vehicle.id)}
                  style={({ pressed }) => [styles.vehicleRow, pressed && styles.pressed]}
                >
                  <View style={styles.vehicleIcon}>
                    <AppSymbol name={{ ios: 'truck.box.fill', android: 'local_shipping' } as never} size={18} color={theme.green} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{vehicle.name}</Text>
                    <Text style={styles.rowMeta}>{vehicle.motive?.location ?? 'Location unavailable'}</Text>
                    <Text style={styles.rowMeta}>{vehicle.motive?.speed ?? 'Speed unavailable'} · {vehicle.motive?.updatedAt ?? 'Update unavailable'}</Text>
                  </View>
                  <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {!incidentLoading && !incidentError && normalizedFireQuery ? (
          <View style={styles.discoverySection}>
            <SectionHeading title="Search results" count={visibleFires.length} styles={styles} />
            <View style={styles.list}>
              {visibleFires.length === 0 ? (
                <Text style={styles.emptyText}>No fire names match “{fireQuery.trim()}”.</Text>
              ) : null}
              {visibleFires.map((incident, index) => (
                <Pressable
                  key={`${incident.id}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open details for ${incident.name}`}
                  onPress={() => openIncidentDetails(incident)}
                  style={({ pressed }) => [styles.fireRow, pressed && styles.pressed]}
                >
                  <View style={styles.fireIcon}>
                    <AppSymbol name={{ ios: 'flame.fill', android: 'local_fire_department' }} size={18} color={theme.danger} />
                  </View>
                  <View style={styles.rowCopy}>
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
      </ScrollView>
      )}

      <Modal
        animationType="slide"
        onRequestClose={closeIncidentDetails}
        presentationStyle="pageSheet"
        visible={Boolean(selected)}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
          {selected ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleCopy}>
                  <Text style={styles.modalTitle}>{selected.name}</Text>
                  <Text style={styles.modalSubtitle}>{US_STATE_NAMES[selected.state] ?? (selected.state || 'Location not reported')} · Active wildfire</Text>
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

              {assignableVehicles.length > 0 ? (
                <View style={styles.assignmentSection}>
                  <Text style={styles.assignmentTitle}>Assign to this fire</Text>
                  <Text style={styles.assignmentHelp}>Choose your assigned vehicle to join this incident.</Text>
                  {assignableVehicles.map((vehicle) => {
                    const assignedHere = vehicle.assignedFire?.id === selected.id;
                    const busy = assigningVehicleId === vehicle.id;
                    return (
                      <Pressable
                        key={vehicle.id}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: assignedHere || Boolean(assigningVehicleId) }}
                        disabled={assignedHere || Boolean(assigningVehicleId)}
                        onPress={() => void assignVehicleToFire(vehicle, selected)}
                        style={({ pressed }) => [styles.assignmentRow, (assignedHere || Boolean(assigningVehicleId)) && styles.assignmentDisabled, pressed && styles.pressed]}
                      >
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowTitle}>{vehicle.name}</Text>
                          <Text style={styles.rowMeta}>{vehicle.assignedFire ? `Currently ${vehicle.assignedFire.name}` : 'No fire assigned'}</Text>
                        </View>
                        <Text style={styles.assignmentAction}>{busy ? 'Assigning…' : assignedHere ? 'Assigned' : 'Assign'}</Text>
                      </Pressable>
                    );
                  })}
                  {assignmentError ? <Text accessibilityRole="alert" style={styles.errorText}>{assignmentError}</Text> : null}
                </View>
              ) : null}

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
    subtitle: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
    sectionTitle: { color: theme.commandForeground, fontSize: 19, lineHeight: 24, fontWeight: '800' },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    rowCopy: { flex: 1, gap: 4 },
    rowTitle: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    rowMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    fireHeading: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
    fireHeadingCopy: { flex: 1, gap: 4 },
    sectionCopy: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    searchField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingLeft: 14 },
    searchInput: { flex: 1, minHeight: 50, color: theme.ink, fontSize: 16, lineHeight: 21, paddingVertical: 0 },
    searchClearButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    mapCard: { height: 290, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16, backgroundColor: theme.surfaceAlt },
    map: { flex: 1 },
    mapControls: { position: 'absolute', top: 10, right: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 10, backgroundColor: theme.paper },
    mapControlButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    mapSelection: { position: 'absolute', right: 10, bottom: 10, left: 10, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 12, paddingVertical: 9 },
    landscapeMap: { flex: 1, backgroundColor: theme.surfaceAlt },
    landscapeStatusOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
    landscapeStatusCard: { borderRadius: 14, backgroundColor: theme.paper, padding: 18 },
    landscapeErrorCard: { width: '100%', maxWidth: 380, borderRadius: 14, backgroundColor: theme.dangerSurface, padding: 16, gap: 12 },
    mapEmptyOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
    mapEmptyCard: { maxWidth: 250, alignItems: 'center', gap: 6, borderRadius: 14, backgroundColor: theme.paper, paddingHorizontal: 20, paddingVertical: 16 },
    mapEmptyTitle: { color: theme.commandForeground, fontSize: 16, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
    mapEmptyCopy: { color: theme.secondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    discoverySection: { gap: 8 },
    fleetSection: { gap: 8 },
    fireRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    vehicleRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    fireIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dangerSurface },
    vehicleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.greenSurface },
    modalSafeArea: { flex: 1, backgroundColor: theme.canvas },
    modalContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 28 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    modalTitleCopy: { flex: 1, gap: 5 },
    modalTitle: { color: theme.commandForeground, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
    modalSubtitle: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surfaceAlt },
    incidentMetrics: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: theme.greenSurface, borderRadius: 16, padding: 18 },
    assignmentSection: { gap: 10 },
    assignmentTitle: { color: theme.commandForeground, fontSize: 18, lineHeight: 23, fontWeight: '800' },
    assignmentHelp: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    assignmentRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 14, paddingVertical: 10 },
    assignmentAction: { color: theme.ember, fontSize: 14, fontWeight: '800' },
    assignmentDisabled: { opacity: 0.55 },
    incidentMetric: { flex: 1, gap: 5 },
    metricValue: { color: theme.commandForeground, fontSize: 22, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] },
    metricLabel: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginHorizontal: 10 },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 21, paddingVertical: 18 },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 16, gap: 12 },
    errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
    retryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15 },
    retryLabel: { color: theme.canvas, fontSize: 14, fontWeight: '700' },
    sourceText: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    pressed: { opacity: 0.58 },
  });
}
