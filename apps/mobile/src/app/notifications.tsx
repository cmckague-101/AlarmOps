import {useMemo, useRef} from 'react';
import {Redirect, Stack, useRouter} from 'expo-router';
import {Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import Swipeable, {SwipeDirection, type SwipeableMethods} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {SafeAreaView} from 'react-native-safe-area-context';

import { DownloadedListNotice } from '@/components/downloaded-list-notice';
import {AppSymbol} from '@/components/app-symbol';
import {
  clearInboxNotifications,
  dismissInboxNotification,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
  refreshNotificationInbox,
  type InboxNotification,
  useNotificationInbox,
} from '@/lib/notification-inbox-store';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme, useFireOpsTheme} from '@/theme';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

function iconFor(notification: InboxNotification) {
  if (notification.groupKey.startsWith('app-feedback:')) return {ios: 'bubble.left.and.bubble.right.fill', android: 'feedback'} as const;
  switch (notification.entityType) {
    case 'communication': return {ios: 'message.fill', android: 'chat_bubble'} as const;
    case 'document': return {ios: 'doc.fill', android: 'description'} as const;
    case 'training': return {ios: 'graduationcap.fill', android: 'school'} as const;
    case 'vehicle': return {ios: 'truck.box.fill', android: 'local_shipping'} as const;
    case 'issue': return {ios: 'wrench.and.screwdriver.fill', android: 'build'} as const;
    default: return {ios: 'bell.fill', android: 'notifications'} as const;
  }
}

function NotificationRow({
  notification,
  styles,
  theme,
  onOpen,
  onClear,
}: {
  notification: InboxNotification;
  styles: ReturnType<typeof createStyles>;
  theme: FireOpsTheme;
  onOpen: (notification: InboxNotification) => void;
  onClear: (id: string) => void;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  return (
    <Swipeable
      ref={swipeable}
      overshootRight={false}
      rightThreshold={64}
      onSwipeableOpen={(direction) => {
        // Swiping the row left reveals the right-side Clear action.
        if (direction !== SwipeDirection.LEFT) return;
        onClear(notification.id);
      }}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear notification ${notification.title}`}
          onPress={() => {
            swipeable.current?.close();
            onClear(notification.id);
          }}
          style={({pressed}) => [styles.clearAction, pressed && styles.pressed]}
        >
          <Text style={styles.clearActionLabel}>Clear</Text>
        </Pressable>
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notification.title}${notification.readAt ? '' : ', unread'}`}
        onPress={() => void onOpen(notification)}
        style={({pressed}) => [styles.row, !notification.readAt && styles.unreadRow, pressed && styles.pressed]}
      >
        <View style={[styles.icon, !notification.readAt && styles.unreadIcon]}>
          <AppSymbol name={iconFor(notification) as never} color={!notification.readAt ? theme.ember : theme.secondary} size={18} />
        </View>
        <View style={styles.copy}>
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={styles.rowTitle}>{notification.title}</Text>
            {!notification.readAt ? <View accessibilityLabel="Unread" style={styles.dot} /> : null}
          </View>
          <Text numberOfLines={2} style={styles.body}>{notification.body}</Text>
          <Text style={styles.date}>{formatDate(notification.createdAt)}</Text>
        </View>
        <AppSymbol name={{ios: 'chevron.right', android: 'chevron_right'} as never} color={theme.secondary} size={17} />
      </Pressable>
    </Swipeable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {session, access} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const {notifications, unreadCount, loading, refreshing, error, downloaded} = useNotificationInbox(member?.company.id ?? null, member?.user.id ?? null, member?.user.role ?? null);
  const groups = useMemo(() => {
    const grouped = new Map<string, InboxNotification[]>();
    notifications.forEach((notification) => grouped.set(notification.groupKey, [...(grouped.get(notification.groupKey) ?? []), notification]));
    return [...grouped.entries()].map(([key, items]) => ({key, items}));
  }, [notifications]);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (!member) return <Redirect href="/" />;

  const open = (notification: InboxNotification) => {
    if (!notification.readAt) void markInboxNotificationRead(notification.id).catch(() => undefined);
    router.push(notification.path as never);
  };

  const clearOne = (id: string) => {
    void dismissInboxNotification(id);
  };

  const clearAll = () => {
    void clearInboxNotifications(notifications.map((notification) => notification.id));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{title: 'Notifications'}} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshNotificationInbox()} tintColor={theme.commandForeground} />}
      >
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
            <Text style={styles.subtitle}>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up.'}</Text>
          </View>
          <View style={styles.headingActions}>
            {notifications.length ? (
              <Pressable accessibilityRole="button" onPress={clearAll} style={({pressed}) => [styles.markAll, pressed && styles.pressed]}>
                <Text style={styles.markAllLabel}>Clear all</Text>
              </Pressable>
            ) : null}
            {unreadCount ? (
              <Pressable accessibilityRole="button" onPress={() => void markAllInboxNotificationsRead()} style={({pressed}) => [styles.markAll, pressed && styles.pressed]}>
                <Text style={styles.markAllLabel}>Mark all read</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {loading && notifications.length === 0 ? <Text style={styles.state}>Loading notifications…</Text> : null}
        <DownloadedListNotice info={downloaded} />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && notifications.length === 0 ? (
          <View style={styles.empty}>
            <AppSymbol name={{ios: 'bell.slash', android: 'notifications_off'} as never} color={theme.secondary} size={28} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyBody}>{member.user.role === 'owner' || member.user.role === 'admin' ? 'Company updates will appear here.' : 'Crew Chat, new training, and your approved qualifications will appear here.'}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {groups.map((group) => (
              <View key={group.key} style={styles.group}>
                {group.items.length > 1 ? <Text style={styles.groupLabel}>{group.items.length} related notifications</Text> : null}
                {group.items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    styles={styles}
                    theme={theme}
                    onOpen={open}
                    onClear={clearOne}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safe: {flex: 1, backgroundColor: theme.canvas},
    content: {flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 20},
    heading: {flexDirection: 'row', alignItems: 'center', gap: 14},
    headingCopy: {flex: 1, gap: 4},
    headingActions: {alignItems: 'flex-end', gap: 2},
    title: {color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800'},
    subtitle: {color: theme.secondary, fontSize: 14},
    markAll: {minHeight: 40, justifyContent: 'center', paddingHorizontal: 10},
    markAllLabel: {color: theme.ember, fontSize: 13, fontWeight: '700'},
    list: {gap: 12},
    group: {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, overflow: 'hidden'},
    groupLabel: {color: theme.secondary, backgroundColor: theme.surfaceAlt, fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 7},
    row: {minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 12, backgroundColor: theme.canvas},
    unreadRow: {backgroundColor: theme.dangerSurface},
    clearAction: {width: 88, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.danger},
    clearActionLabel: {color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase'},
    icon: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.surfaceAlt},
    unreadIcon: {backgroundColor: theme.paper},
    copy: {flex: 1, gap: 4},
    titleLine: {flexDirection: 'row', alignItems: 'center', gap: 7},
    rowTitle: {flexShrink: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700'},
    body: {color: theme.secondary, fontSize: 13, lineHeight: 18},
    date: {color: theme.secondary, fontSize: 11, lineHeight: 15},
    dot: {width: 7, height: 7, borderRadius: 4, backgroundColor: theme.ember},
    state: {color: theme.secondary, fontSize: 15, paddingVertical: 28},
    error: {color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19},
    empty: {alignItems: 'center', paddingVertical: 64, paddingHorizontal: 30, gap: 10},
    emptyTitle: {color: theme.ink, fontSize: 19, fontWeight: '700'},
    emptyBody: {color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center'},
    pressed: {opacity: 0.62},
  });
}
