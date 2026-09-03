import { useMemo, useState } from 'react';
import type { FleetIssue } from '@fireops/domain';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { FleetVehicle, refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function displayStatus(status: string) {
  const words = status.trim().replaceAll('_', ' ').replaceAll('-', ' ').split(' ');
  return words.map((word) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '').join(' ');
}

function statusTone(status: string): 'dotReady' | 'dotAttention' | 'dotAssigned' {
  const value = status.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
  if (['ready', 'available', 'in service', 'active'].includes(value)) return 'dotReady';
  if (['maintenance', 'inspection', 'out of service', 'offline'].includes(value)) return 'dotAttention';
  return 'dotAssigned';
}

type FleetStyles = ReturnType<typeof createStyles>;
type StatusFilter = 'All' | 'Ready' | 'Assigned' | 'Maintenance' | 'Out of service';
const statusFilters: StatusFilter[] = ['All', 'Ready', 'Assigned', 'Maintenance', 'Out of service'];

function VehicleRow({ vehicle, assignedName, issueCount, styles, onPress }: { vehicle: FleetVehicle; assignedName?: string; issueCount: number; styles: FleetStyles; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${vehicle.name}, ${displayStatus(vehicle.status)}`}
      accessibilityHint="Opens vehicle details"
      onPress={onPress}
      style={({ pressed }) => [styles.vehicleRow, pressed && styles.vehicleRowPressed]}
    >
      <View style={styles.vehicleMain}>
        <View style={styles.vehicleHeading}>
          <Text style={styles.vehicleName} numberOfLines={1}>{vehicle.name}</Text>
          <View style={[styles.statusDot, styles[statusTone(vehicle.status)]]} />
        </View>
        <Text style={styles.vehicleMeta} numberOfLines={1}>
          {[vehicle.type, vehicle.detail].filter(Boolean).join(' · ')}
        </Text>
        {assignedName || vehicle.location || issueCount > 0 ? (
          <Text style={[styles.location, issueCount > 0 && styles.issueCount]} numberOfLines={1}>
            {[assignedName ? `Assigned to ${assignedName}` : vehicle.location, issueCount > 0 ? `${issueCount} open ${issueCount === 1 ? 'issue' : 'issues'}` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowEnd}>
        <Text style={styles.status}>{displayStatus(vehicle.status)}</Text>
        <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={styles.icon.color} size={17} />
      </View>
    </Pressable>
  );
}

function IssueRow({ issue, vehicleName, styles, onPress }: { issue: FleetIssue; vehicleName: string; styles: FleetStyles; onPress: () => void }) {
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
  const { vehicles, issues, crew, loading, refreshing, error } = useFleetVehicles(companyId);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('All');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredVehicles = vehicles.filter((vehicle) => {
    const matchesStatus = filter === 'All' || vehicle.status === filter;
    const matchesQuery = !normalizedQuery || [vehicle.name, vehicle.type, vehicle.detail, vehicle.vin, vehicle.plate]
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
    return matchesStatus && matchesQuery;
  });
  const visibleIssues = issues.filter((issue) => {
    if (currentUser?.role === 'owner') return true;
    if (!currentUser) return false;
    return issue.createdById ? issue.createdById === currentUser.id : issue.createdBy === currentUser.name;
  });
  const openIssues = visibleIssues.filter((issue) => issue.status === 'Open');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.command} />}
      >
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Fleet</Text>
          <Text style={styles.subtitle}>{loading ? 'Loading vehicles…' : `${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`}</Text>
        </View>

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Fleet data unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshFleet} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && vehicles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No vehicles yet</Text>
            <Text style={styles.emptyText}>Vehicles added to your department will appear here automatically.</Text>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                {statusFilters.map((status) => {
                  const selected = filter === status;
                  return (
                    <Pressable
                      key={status}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setFilter(status)}
                      style={({ pressed }) => [styles.filterButton, selected && styles.filterButtonSelected, pressed && styles.filterButtonPressed]}
                    >
                      <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{status}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {filteredVehicles.length ? (
              <View style={styles.list}>
                {filteredVehicles.map((vehicle) => (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    assignedName={crew.find((member) => member.id === vehicle.assignedTo)?.name}
                    issueCount={openIssues.filter((issue) => issue.vehicleId === vehicle.id).length}
                    styles={styles}
                    onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}` as never)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.filteredEmpty}>
                <Text style={styles.emptyTitle}>No vehicles found</Text>
                <Text style={styles.emptyText}>Try another search or status filter.</Text>
                <Pressable accessibilityRole="button" onPress={() => { setQuery(''); setFilter('All'); }} style={styles.clearButton}>
                  <Text style={styles.clearLabel}>Clear filters</Text>
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
  headingGroup: { gap: 5 },
  title: { color: theme.command, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
  controls: { gap: 12 },
  searchInput: { minHeight: 48, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, paddingHorizontal: 15, color: theme.ink, fontSize: 16 },
  filters: { gap: 8, paddingRight: 20 },
  filterButton: { minHeight: 38, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, paddingHorizontal: 14, backgroundColor: theme.paper },
  filterButtonSelected: { backgroundColor: theme.command, borderColor: theme.command },
  filterButtonPressed: { opacity: 0.78 },
  filterLabel: { color: theme.secondary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  filterLabelSelected: { color: theme.commandText },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 92, paddingVertical: 17, paddingHorizontal: 6, marginHorizontal: -6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, borderRadius: 8 },
  vehicleRowPressed: { backgroundColor: theme.surfaceAlt },
  vehicleMain: { flex: 1, minWidth: 0, gap: 4 },
  vehicleHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  vehicleName: { flexShrink: 1, color: theme.command, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  vehicleMeta: { color: theme.secondary, fontSize: 14, lineHeight: 19 },
  location: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
  issueCount: { color: theme.danger, fontWeight: '600' },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { maxWidth: 90, color: theme.command, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'right' },
  icon: { color: theme.secondary },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotReady: { backgroundColor: '#23825E' },
  dotAssigned: { backgroundColor: '#B67822' },
  dotAttention: { backgroundColor: '#B74A3E' },
  emptyState: { flex: 1, justifyContent: 'center', paddingVertical: 72, gap: 8 },
  filteredEmpty: { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle: { color: theme.command, fontSize: 21, lineHeight: 27, fontWeight: '700', textAlign: 'center' },
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
