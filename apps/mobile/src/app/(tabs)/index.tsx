import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Activity, FleetIssue } from '@fireops/domain';
import { AppSymbol } from '@/components/app-symbol';
import { refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const READY_STATUSES = ['ready', 'available', 'in service', 'active'];
const ATTENTION_STATUSES = ['maintenance', 'inspection', 'out of service', 'offline'];
const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;

function normalized(status: string) {
  return status.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
}

function formatActivityDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export default function DashboardScreen() {
  const theme = useFireOpsTheme();
  const router = useRouter();
  const { access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { vehicles, issues, activities, loading, refreshing, error } = useFleetVehicles(companyId);

  const ready = vehicles.filter((vehicle) => READY_STATUSES.includes(normalized(vehicle.status))).length;
  const attention = vehicles.filter((vehicle) => ATTENTION_STATUSES.includes(normalized(vehicle.status))).length;
  const assignedVehicles = user ? vehicles.filter((vehicle) => vehicle.assignedTo === user.id) : [];
  const assigned = Math.max(vehicles.length - ready - attention, 0);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const openIssues = issues
    .filter((issue) => issue.status === 'Open')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recentActivities = [...activities]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);

  const openIssue = (issue: FleetIssue) => router.push(`/issue/${encodeURIComponent(issue.id)}`);
  const openActivity = (activity: Activity) => {
    if (!activity.targetId) return;
    if (activity.targetType === 'issue') router.push(`/issue/${encodeURIComponent(activity.targetId)}`);
    if (activity.targetType === 'vehicle') router.push(`/vehicle/${encodeURIComponent(activity.targetId)}`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.command} />}
      >
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Live fleet readiness across your department.</Text>
        </View>

        {loading ? <Text style={styles.stateText}>Loading fleet status…</Text> : null}

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Fleet data unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshFleet} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            <View style={styles.readinessBlock}>
              <View style={styles.readinessHeading}>
                <Text style={styles.sectionTitle}>Fleet readiness</Text>
                <Text style={styles.total}>{vehicles.length} total</Text>
              </View>
              <View style={styles.metrics}>
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, styles.readyValue]}>{ready}</Text>
                  <Text style={styles.metricLabel}>Ready</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{assigned}</Text>
                  <Text style={styles.metricLabel}>Other</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, attention > 0 && styles.attentionValue]}>{attention}</Text>
                  <Text style={styles.metricLabel}>Attention</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.sectionTitle}>Current picture</Text>
              <Text style={styles.summaryText}>
                {vehicles.length === 0
                  ? 'No vehicles have been added yet.'
                  : attention > 0
                    ? `${attention} ${attention === 1 ? 'vehicle needs' : 'vehicles need'} attention.`
                    : 'All reported vehicles are operational.'}
              </Text>
            </View>

            <DashboardSection title="Open-issue blockers" count={openIssues.length} styles={styles}>
              {openIssues.length === 0 ? (
                <Text style={styles.emptyText}>No open issues blocking fleet work.</Text>
              ) : (
                openIssues.slice(0, 5).map((issue) => (
                  <Pressable
                    key={issue.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open issue ${issue.title}`}
                    onPress={() => openIssue(issue)}
                    style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{issue.title}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {vehicleById.get(issue.vehicleId)?.name ?? 'Unknown vehicle'} · {issue.priority}
                      </Text>
                    </View>
                    <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                  </Pressable>
                ))
              )}
            </DashboardSection>

            <DashboardSection title="Assigned to me" count={assignedVehicles.length} styles={styles}>
              {assignedVehicles.length === 0 ? (
                <Text style={styles.emptyText}>No vehicles are assigned to you.</Text>
              ) : (
                assignedVehicles.slice(0, 5).map((vehicle) => {
                  const vehicleIssues = openIssues.filter((issue) => issue.vehicleId === vehicle.id).length;
                  return (
                    <Pressable
                      key={vehicle.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${vehicle.name}`}
                      onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}`)}
                      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{vehicle.name}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {vehicle.status}{vehicleIssues > 0 ? ` · ${vehicleIssues} open ${vehicleIssues === 1 ? 'issue' : 'issues'}` : ''}
                        </Text>
                      </View>
                      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                    </Pressable>
                  );
                })
              )}
            </DashboardSection>

            <DashboardSection title="Recent fleet activity" count={activities.length} styles={styles}>
              {recentActivities.length === 0 ? (
                <Text style={styles.emptyText}>Fleet changes will appear here.</Text>
              ) : (
                recentActivities.map((activity) => {
                  const canOpen = activity.targetType === 'issue' || activity.targetType === 'vehicle';
                  return (
                    <Pressable
                      key={activity.id}
                      accessibilityRole={canOpen ? 'button' : undefined}
                      accessibilityLabel={canOpen ? `Open activity: ${activity.action}` : undefined}
                      disabled={!canOpen}
                      onPress={() => openActivity(activity)}
                      style={({ pressed }) => [styles.activityRow, pressed && canOpen && styles.pressed]}
                    >
                      <View style={[styles.activityDot, activity.tone === 'urgent' && styles.urgentDot]} />
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{activity.action}</Text>
                        <Text style={styles.rowMeta} numberOfLines={2}>{activity.detail} · {formatActivityDate(activity.createdAt)}</Text>
                      </View>
                      {canOpen ? <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} /> : null}
                    </Pressable>
                  );
                })
              )}
            </DashboardSection>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DashboardSection({ title, count, children, styles }: { title: string; count: number; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.count}>{count}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 28 },
    headingGroup: { gap: 6 },
    title: { color: theme.command, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
    subtitle: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 28 },
    readinessBlock: { backgroundColor: theme.greenSurface, borderRadius: 18, padding: 20, gap: 22 },
    readinessHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: theme.command, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    total: { color: theme.secondary, fontSize: 14, fontVariant: ['tabular-nums'] },
    metrics: { flexDirection: 'row', alignItems: 'stretch' },
    metric: { flex: 1, gap: 5 },
    metricValue: { color: theme.command, fontSize: 30, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
    readyValue: { color: theme.green },
    attentionValue: { color: theme.warning },
    metricLabel: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    divider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.divider, marginHorizontal: 14 },
    summaryRow: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 20 },
    summaryText: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    section: { gap: 12 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    listRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 12 },
    activityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingVertical: 12 },
    rowCopy: { flex: 1, gap: 4 },
    rowTitle: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    rowMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.green },
    urgentDot: { backgroundColor: theme.danger },
    emptyText: { color: theme.secondary, fontSize: 15, lineHeight: 21, paddingVertical: 18 },
    pressed: { opacity: 0.58 },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 16, padding: 18, gap: 8 },
    errorTitle: { color: theme.danger, fontSize: 17, fontWeight: '700' },
    errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
    retryButton: { alignSelf: 'flex-start', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
    retryLabel: { color: theme.canvas, fontSize: 15, fontWeight: '700' },
  });
}
