import { useMemo, useState } from 'react';
import { canSendToVipr, dotInspectionWarning, formatCalendarDate, nextOilChangeWarning, visibleVehicleIssues, type FleetIssue } from '@fireops/domain';
import { useRouter } from 'expo-router';
import { Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { FilterSelect } from '@/components/filter-select';
import { fleetOrganizeOptions, organizeFleet, type FleetOrganizeMode } from '@fireops/domain';
import { FleetVehicle, refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
import { useFleetFileUrl } from '@/lib/use-fleet-file-url';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';
import {HeroTitle} from '@/components/hero-title';

function displayStatus(status: string) {
  const value = status.trim().replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase();
  if (value === 'out of service') return 'Out of Service';
  return value.split(' ').map((word) => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

function statusTone(status: string): 'dotReady' | 'dotAttention' | 'dotAssigned' {
  const value = status.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
  if (['ready', 'available', 'in service', 'active'].includes(value)) return 'dotReady';
  if (['maintenance', 'inspection', 'out of service', 'offline'].includes(value)) return 'dotAttention';
  return 'dotAssigned';
}

type FleetStyles = ReturnType<typeof createStyles>;

function VehicleRow({ vehicle, assignedName, issueCount, styles, onPress,pendingLabel }: { vehicle: FleetVehicle; assignedName?: string; issueCount: number; styles: FleetStyles; onPress: () => void;pendingLabel?:string }) {
  const photoUrl = useFleetFileUrl(vehicle.photo);
  const dotWarning = dotInspectionWarning(vehicle);
  const oilWarning = nextOilChangeWarning(vehicle);
  const [loadedPhotoUrl, setLoadedPhotoUrl] = useState<string | null>(null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${vehicle.name}, ${displayStatus(vehicle.status)}${dotWarning ? `, DOT inspection ${dotWarning.expired ? 'expired' : 'expiring'} ${formatCalendarDate(dotWarning.expiration)}` : ''}`}
      accessibilityHint="Opens vehicle details"
      onPress={onPress}
      style={({ pressed }) => [styles.vehicleRow, pressed && styles.vehicleRowPressed]}
    >
      <View style={styles.vehicleThumbnail}>
        <AppSymbol name={{ ios: 'truck.box.fill', android: 'local_shipping' } as never} color={styles.icon.color} size={24} />
        {photoUrl ? (
          <Image
            accessibilityLabel={`${vehicle.name} vehicle photo`}
            fadeDuration={0}
            onLoad={() => setLoadedPhotoUrl(photoUrl)}
            resizeMode="cover"
            source={{ uri: photoUrl, cache: 'force-cache' }}
            style={[styles.vehiclePhoto, loadedPhotoUrl !== photoUrl && styles.vehiclePhotoLoading]}
          />
        ) : null}
      </View>
      <View style={styles.vehicleMain}>
        <View style={styles.vehicleHeading}>
          <Text style={styles.vehicleName} numberOfLines={1}>{vehicle.name}</Text>
        </View>
        <Text style={styles.vehicleMeta} numberOfLines={1}>
          {[vehicle.type, vehicle.detail].filter(Boolean).join(' · ')}
        </Text>
        {assignedName || vehicle.location || issueCount > 0 ? (
          <Text style={[styles.location, issueCount > 0 && styles.issueCount]} numberOfLines={1}>
            {[assignedName ? `Assigned to ${assignedName}` : vehicle.location, issueCount > 0 ? `${issueCount} open ${issueCount === 1 ? 'issue' : 'issues'}` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {pendingLabel?<Text style={styles.location}>{pendingLabel}</Text>:null}
        {dotWarning ? <Text style={[styles.location, styles.issueCount]}>DOT inspection {dotWarning.expired ? 'expired' : 'expiring'} · {formatCalendarDate(dotWarning.expiration)}</Text> : null}
        {oilWarning ? <Text style={[styles.location, styles.issueCount]}>Needs attention · Oil change due {formatCalendarDate(oilWarning.due)}</Text> : null}
      </View>
      <View style={styles.rowEnd}>
        <Text style={[styles.status, { color: styles[statusTone(vehicle.status)].backgroundColor }]}>{displayStatus(vehicle.status)}</Text>
        <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={styles.icon.color} size={17} />
      </View>
    </Pressable>
  );
}

function IssueRow({ issue, vehicleName, styles, onPress,pendingLabel }: { issue: FleetIssue; vehicleName: string; styles: FleetStyles; onPress: () => void;pendingLabel?:string }) {
  const high = issue.priority === 'Critical' || issue.priority === 'High';
  const markerTone = high ? styles.priorityHighMarker : issue.priority === 'Medium' ? styles.priorityMediumMarker : styles.priorityLowMarker;
  const labelTone = high ? styles.priorityHighLabel : issue.priority === 'Medium' ? styles.priorityMediumLabel : styles.priorityLowLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}, ${issue.priority} priority`}
      accessibilityHint="Opens issue details"
      onPress={onPress}
      style={({ pressed }) => [styles.issueRow, pressed && styles.issueRowPressed]}
    >
      <View style={[styles.priorityMarker, markerTone]} />
      <View style={styles.issueMain}>
        <View style={styles.issueHeading}>
          <Text style={styles.issueTitle} numberOfLines={1}>{issue.title}</Text>
          <Text style={[styles.priorityLabel, labelTone]}>{issue.priority}</Text>
        </View>
        <Text style={styles.issueDescription} numberOfLines={2}>{issue.description}</Text>
        <Text style={styles.issueMeta}>{vehicleName} · Reported by {issue.createdBy}</Text>
        {pendingLabel?<Text style={styles.issueMeta}>{pendingLabel}</Text>:null}
      </View>
      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={styles.icon.color} size={16} />
    </Pressable>
  );
}

export default function FleetScreen() {
  const theme = useFireOpsTheme();
  const router = useRouter();
  const { access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const currentUser = access.value?.kind === 'member' ? access.value.user : null;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { vehicles, issues, crew, loading, refreshing, error,pendingDetails } = useFleetVehicles(companyId);
  const [query, setQuery] = useState('');
  const [organizeMode, setOrganizeMode] = useState<FleetOrganizeMode>('name');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredVehicles = useMemo(() => vehicles.filter((vehicle) => {
    return !normalizedQuery || [vehicle.name, vehicle.type, vehicle.detail, vehicle.vin, vehicle.plate]
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
  }), [vehicles, normalizedQuery]);
  const organized = useMemo(() => organizeFleet(filteredVehicles, organizeMode), [filteredVehicles, organizeMode]);
  const visibleIssues = currentUser ? visibleVehicleIssues(issues, currentUser) : [];
  const openIssues = visibleIssues.filter((issue) => issue.status === 'Open');

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.commandForeground} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingGroup}>
            <HeroTitle style={styles.pageTitle}>Fleet</HeroTitle>
            <Text style={styles.subtitle}>{loading ? 'Loading vehicles…' : `${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`}</Text>
          </View>
          <View style={styles.headingActions}>
            {currentUser && canSendToVipr(currentUser.role) && vehicles.length ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Send to VIPR" onPress={() => router.push('/send-to-vipr')} style={({ pressed }) => [styles.viprButton, pressed && styles.addButtonPressed]}>
                <AppSymbol name={{ ios: 'square.and.arrow.up', android: 'upload' } as never} color={theme.ink} size={17} />
                <Text style={styles.viprButtonLabel}>VIPR</Text>
              </Pressable>
            ) : null}
            {currentUser?.role === 'owner' || currentUser?.role === 'admin' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle" onPress={() => router.push('/vehicle/form')} style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}>
                <AppSymbol name="plus" color={theme.commandText} size={18} />
                <Text style={styles.addButtonLabel}>Add</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Fleet data unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refreshFleet()} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && vehicles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No vehicles yet</Text>
            <Text style={styles.emptyText}>{currentUser?.role === 'owner' || currentUser?.role === 'admin' ? 'Add your first vehicle to begin tracking readiness and assignments.' : 'Vehicles added to your department will appear here automatically.'}</Text>
            {currentUser?.role === 'owner' || currentUser?.role === 'admin' ? (
              <Pressable accessibilityRole="button" onPress={() => router.push('/vehicle/form')} style={styles.emptyAddButton}>
                <AppSymbol name="plus" color={theme.commandText} size={18} />
                <Text style={styles.addButtonLabel}>Add first vehicle</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {vehicles.length > 0 ? (
          <>
            <View style={styles.controls}>
              <TextInput
                accessibilityLabel="Search fleet"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Search unit, type, VIN, or plate"
                placeholderTextColor={theme.secondary}
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
              <FilterSelect
                accessibilityLabel="Organize fleet"
                onChange={setOrganizeMode}
                options={fleetOrganizeOptions}
                value={organizeMode}
              />
            </View>

            {filteredVehicles.length ? (
              <View style={styles.list}>
                {organized.groups.map((group) => (
                  <View key={group.type || 'name'} style={styles.group}>
                    {organizeMode === 'type' && group.type ? (
                      <View style={styles.groupHeading}>
                        <Text style={styles.groupTitle}>{group.type}</Text>
                        <Text style={styles.groupCount}>{group.vehicles.length}</Text>
                      </View>
                    ) : null}
                    {group.vehicles.map((vehicle) => (
                      <VehicleRow
                        key={vehicle.id}
                        vehicle={vehicle}
                        pendingLabel={pendingDetails?.[`vehicle:${vehicle.id}`]}
                        assignedName={crew.find((member) => member.id === vehicle.assignedTo)?.name}
                        issueCount={openIssues.filter((issue) => issue.vehicleId === vehicle.id).length}
                        styles={styles}
                        onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}` as never)}
                      />
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.filteredEmpty}>
                <Text style={styles.emptyTitle}>No vehicles found</Text>
                <Text style={styles.emptyText}>Try another search.</Text>
                <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.clearButton}>
                  <Text style={styles.clearLabel}>Clear search</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}

        {!loading && !error ? (
          <View style={styles.issuesSection}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Current issues</Text>
              <Text style={styles.sectionCount}>{openIssues.length} open</Text>
            </View>
            {openIssues.length ? (
              <View style={styles.issueList}>
                {openIssues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    pendingLabel={pendingDetails?.[`issue:${issue.id}`]}
                    vehicleName={vehicles.find((vehicle) => vehicle.id === issue.vehicleId)?.name ?? 'Unknown vehicle'}
                    styles={styles}
                    onPress={() => router.push(`/issue/${encodeURIComponent(issue.id)}` as never)}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.noIssues}>No open fleet issues.</Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.canvas },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 26 },
  pageTitle: { color: theme.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headingGroup: { flex: 1, gap: 5 },
  subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viprButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper, borderRadius: 12, paddingHorizontal: 13 },
  viprButtonLabel: { color: theme.ink, fontSize: 15, fontWeight: '800' },
  addButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 16 },
  addButtonPressed: { backgroundColor: theme.emberPressed },
  addButtonLabel: { color: theme.commandText, fontSize: 15, fontWeight: '800' },
  emptyAddButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 18, marginTop: 6 },
  controls: { gap: 12 },
  searchInput: { minHeight: 48, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, paddingHorizontal: 15, color: theme.ink, fontSize: 16 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
  group: {},
  groupHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingTop: 18, paddingBottom: 8 },
  groupTitle: { color: theme.ink, fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 0.2 },
  groupCount: { color: theme.secondary, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 92, paddingVertical: 17, paddingHorizontal: 6, marginHorizontal: -6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, borderRadius: 8 },
  vehicleRowPressed: { backgroundColor: theme.surfaceAlt },
  vehicleThumbnail: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 12, backgroundColor: theme.surfaceAlt },
  vehiclePhoto: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  vehiclePhotoLoading: { opacity: 0 },
  vehicleMain: { flex: 1, minWidth: 0, gap: 4 },
  vehicleHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  vehicleName: { flexShrink: 1, color: theme.commandForeground, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  vehicleMeta: { color: theme.secondary, fontSize: 14, lineHeight: 19 },
  location: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
  issueCount: { color: theme.danger, fontWeight: '600' },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { maxWidth: 90, color: theme.commandForeground, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'right' },
  icon: { color: theme.secondary },
  dotReady: { backgroundColor: theme.green },
  dotAssigned: { backgroundColor: theme.blue },
  dotAttention: { backgroundColor: theme.danger },
  emptyState: { flex: 1, justifyContent: 'center', paddingVertical: 72, gap: 8 },
  filteredEmpty: { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle: { color: theme.commandForeground, fontSize: 21, lineHeight: 27, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 24 },
  clearButton: { marginTop: 8, minHeight: 42, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.divider, paddingHorizontal: 15, backgroundColor: theme.paper },
  clearLabel: { color: theme.ink, fontSize: 14, fontWeight: '700' },
  issuesSection: { gap: 12, paddingTop: 6 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: theme.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  sectionCount: { color: theme.secondary, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  issueList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
  issueRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 16, paddingHorizontal: 6, marginHorizontal: -6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, borderRadius: 8 },
  issueRowPressed: { backgroundColor: theme.surfaceAlt },
  priorityMarker: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  priorityHighMarker: { backgroundColor: theme.danger },
  priorityMediumMarker: { backgroundColor: theme.warning },
  priorityLowMarker: { backgroundColor: theme.green },
  issueMain: { flex: 1, gap: 5 },
  issueHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  issueTitle: { flex: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  priorityLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  priorityHighLabel: { color: theme.danger },
  priorityMediumLabel: { color: theme.warning },
  priorityLowLabel: { color: theme.green },
  issueDescription: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
  issueMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
  noIssues: { color: theme.secondary, backgroundColor: theme.greenSurface, borderRadius: 12, padding: 16, fontSize: 14, lineHeight: 20 },
  errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 16, padding: 18, gap: 8 },
  errorTitle: { color: theme.danger, fontSize: 17, fontWeight: '700' },
  errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  retryLabel: { color: theme.canvas, fontSize: 15, fontWeight: '700' },
  });
}
