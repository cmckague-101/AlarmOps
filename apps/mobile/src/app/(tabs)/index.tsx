import { useMemo } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Activity, type FleetIssue } from '@fireops/domain';
import { AppSymbol } from '@/components/app-symbol';
import { type FleetVehicle, refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
import { markInboxNotificationRead, refreshNotificationInbox, type InboxNotification, useNotificationInbox } from '@/lib/notification-inbox-store';
import { useFleetFileUrl } from '@/lib/use-fleet-file-url';
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

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function DashboardScreen() {
  const theme = useFireOpsTheme();
  const router = useRouter();
  const { access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { vehicles, issues, activities, loading, refreshing, error } = useFleetVehicles(companyId);
  const { notifications: inboxNotifications, unreadCount: unreadNotifications, refreshing: notificationsRefreshing } = useNotificationInbox(companyId, user?.id ?? null);

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
  const notifications = inboxNotifications.slice(0, 10);

  const openIssue = (issue: FleetIssue) => router.push(`/issue/${encodeURIComponent(issue.id)}`);
  const openActivity = (activity: Activity) => {
    if (!activity.targetId) return;
    if (activity.targetType === 'issue') router.push(`/issue/${encodeURIComponent(activity.targetId)}`);
    if (activity.targetType === 'vehicle') router.push(`/vehicle/${encodeURIComponent(activity.targetId)}`);
  };
  const openNotification = (notification: InboxNotification) => {
    if (!notification.readAt) void markInboxNotificationRead(notification.id).catch(() => undefined);
    router.push(notification.path as never);
  };
  const refreshDashboard = () => {
    void refreshFleet();
    void refreshNotificationInbox();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing || notificationsRefreshing} onRefresh={refreshDashboard} tintColor={theme.commandForeground} />}
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
            <Pressable accessibilityRole="button" onPress={() => void refreshFleet()} style={styles.retryButton}>
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

            {attention > 0 ? (
              <View style={styles.summaryRow}>
                <Text style={styles.sectionTitle}>Current picture</Text>
                <Text style={styles.summaryText}>
                  {attention} {attention === 1 ? 'vehicle needs' : 'vehicles need'} attention.
                </Text>
              </View>
            ) : null}

            {openIssues.length > 0 ? (
              <DashboardSection title="Open-issue blockers" count={openIssues.length} styles={styles}>
                {openIssues.slice(0, 5).map((issue) => (
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
                ))}
              </DashboardSection>
            ) : null}

            {assignedVehicles.length > 0 ? (
              <DashboardSection title="Assigned to me" count={assignedVehicles.length} styles={styles}>
                {assignedVehicles.slice(0, 5).map((vehicle) => (
                  <AssignedVehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    issueCount={openIssues.filter((issue) => issue.vehicleId === vehicle.id).length}
                    onPress={() => router.push(`/vehicle/${encodeURIComponent(vehicle.id)}`)}
                    styles={styles}
                    iconColor={theme.secondary}
                  />
                ))}
              </DashboardSection>
            ) : null}

            {notifications.length > 0 ? (
              <DashboardSection title="Notifications" count={unreadNotifications} styles={styles}>
                <>
                  {notifications.map((notification) => (
                    <Pressable
                      key={notification.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open notification ${notification.title}${notification.readAt ? '' : ', unread'}`}
                      onPress={() => void openNotification(notification)}
                      style={({ pressed }) => [styles.notificationRow, !notification.readAt && styles.unreadRow, pressed && styles.pressed]}
                    >
                      <View style={[styles.notificationIcon, !notification.readAt && styles.notificationIconUnread]}>
                        <AppSymbol
                          name={notification.entityType === 'communication'
                            ? ({ ios: 'message.fill', android: 'chat_bubble' } as never)
                            : notification.entityType === 'training'
                              ? ({ ios: 'graduationcap.fill', android: 'school' } as never)
                              : notification.entityType === 'vehicle'
                                ? ({ ios: 'truck.box.fill', android: 'local_shipping' } as never)
                                : notification.entityType === 'issue'
                                  ? ({ ios: 'wrench.and.screwdriver.fill', android: 'build' } as never)
                                  : ({ ios: 'doc.fill', android: 'description' } as never)}
                          size={17}
                          color={!notification.readAt ? theme.ember : theme.secondary}
                        />
                      </View>
                      <View style={styles.rowCopy}>
                        <View style={styles.notificationTitleLine}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{notification.title}</Text>
                          {!notification.readAt ? <View accessibilityLabel="Unread" style={styles.unreadDot} /> : null}
                        </View>
                        <Text style={styles.rowMeta} numberOfLines={1}>{notification.body}</Text>
                        <Text style={styles.notificationMeta}>{formatNotificationDate(notification.createdAt)}</Text>
                      </View>
                      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={theme.secondary} />
                    </Pressable>
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => router.push('/notifications' as never)} style={({pressed}) => [styles.allNotifications, pressed && styles.pressed]}>
                    <Text style={styles.allNotificationsLabel}>View all notifications</Text>
                    <AppSymbol name={{ios: 'chevron.right', android: 'chevron_right'} as never} size={16} color={theme.ember} />
                  </Pressable>
                </>
              </DashboardSection>
            ) : null}

            {recentActivities.length > 0 ? (
              <DashboardSection title="Recent fleet activity" count={activities.length} styles={styles}>
                {recentActivities.map((activity) => {
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
                })}
              </DashboardSection>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AssignedVehicleRow({ vehicle, issueCount, onPress, styles, iconColor }: { vehicle: FleetVehicle; issueCount: number; onPress: () => void; styles: ReturnType<typeof createStyles>; iconColor: string }) {
  const photoUrl = useFleetFileUrl(vehicle.photo);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${vehicle.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
    >
      <View style={styles.vehicleThumbnail}>
        {photoUrl ? (
          <Image
            accessibilityLabel={`${vehicle.name} vehicle photo`}
            resizeMode="cover"
            source={{ uri: photoUrl }}
            style={styles.vehiclePhoto}
          />
        ) : (
          <AppSymbol name={{ ios: 'truck.box.fill', android: 'local_shipping' } as never} size={20} color={iconColor} />
        )}
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{vehicle.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {vehicle.status}{issueCount > 0 ? ` · ${issueCount} open ${issueCount === 1 ? 'issue' : 'issues'}` : ''}
        </Text>
      </View>
      <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' }} size={17} color={iconColor} />
    </Pressable>
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
    title: { color: theme.commandForeground, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
    subtitle: { color: theme.secondary, fontSize: 16, lineHeight: 23 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 28 },
    readinessBlock: { backgroundColor: theme.greenSurface, borderRadius: 18, padding: 20, gap: 22 },
    readinessHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: theme.commandForeground, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    total: { color: theme.secondary, fontSize: 14, fontVariant: ['tabular-nums'] },
    metrics: { flexDirection: 'row', alignItems: 'stretch' },
    metric: { flex: 1, gap: 5 },
    metricValue: { color: theme.commandForeground, fontSize: 30, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
    notificationRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 11 },
    unreadRow: { backgroundColor: theme.dangerSurface },
    notificationIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: theme.surfaceAlt },
    notificationIconUnread: { backgroundColor: theme.paper },
    notificationTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.ember },
    notificationMeta: { color: theme.secondary, fontSize: 11, lineHeight: 15 },
    allNotifications: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    allNotificationsLabel: { color: theme.ember, fontSize: 14, fontWeight: '700' },
    rowCopy: { flex: 1, gap: 4 },
    vehicleThumbnail: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 10, backgroundColor: theme.surfaceAlt },
    vehiclePhoto: { width: '100%', height: '100%' },
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
