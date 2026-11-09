import { useMemo } from 'react';
import { isCompanyManager, isThreadUnread, type CommunicationThread } from '@fireops/domain';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeviceSavedList } from '@/components/device-saved-list';
import { useOfflineUserSync } from '@/lib/use-offline-user-sync';
import { deviceThreads, scopedUserEntries } from '@/lib/offline-user-sync';
import { DownloadedListNotice } from '@/components/downloaded-list-notice';
import { AppSymbol } from '@/components/app-symbol';
import { refreshCommunications, useCommunications } from '@/lib/communications-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';
import {HeroTitle} from '@/components/hero-title';

function latestDate(thread: CommunicationThread) {
  return thread.replies[thread.replies.length - 1]?.createdAt ?? thread.createdAt;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function CommunicationsScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { threads, loading, refreshing, error, downloaded } = useCommunications(member?.company.id ?? null, member?.user.id ?? null);
  // Threads started on this device that the list does not include yet.
  const deviceSync = useOfflineUserSync(member?.company.id, member?.user.id);
  const savedThreads = useMemo(() => member ? deviceThreads(scopedUserEntries(deviceSync.entries, member.user.id, member.company.id)).filter((thread) => !threads.some((item) => item.id === thread.id)) : [], [deviceSync.entries, member, threads]);
  const unreadCount = member ? threads.filter((thread) => isThreadUnread(thread, member.user)).length : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCommunications} tintColor={theme.commandForeground} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <HeroTitle style={styles.pageTitle}>Communications</HeroTitle>
            <View style={styles.headingMeta}>
              <Text style={styles.sectionMeta}>{threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}</Text>
              {unreadCount > 0 ? <Text accessibilityLabel={`${unreadCount} unread`} style={styles.unreadCount}>{unreadCount} unread</Text> : null}
            </View>
          </View>
          {member && isCompanyManager(member.user.role) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new thread"
              onPress={() => router.push('/communication/new' as never)}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={20} />
              <Text style={styles.addButtonLabel}>New</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? <Text style={styles.stateText}>Loading company threads…</Text> : null}
        <DownloadedListNotice info={downloaded} />
        <DeviceSavedList rows={savedThreads.map((thread) => ({ id: thread.id, title: thread.subject, state: thread.state }))} />
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Communications unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshCommunications} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && threads.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <AppSymbol name={{ ios: 'bubble.left.and.bubble.right', android: 'forum' } as never} color={theme.secondary} size={27} />
            </View>
            <Text style={styles.emptyTitle}>No threads yet</Text>
            <Text style={styles.emptyText}>{member && isCompanyManager(member.user.role) ? 'Start a thread to share an update or ask the crew a question.' : 'Company owners and admins can start crew conversations.'}</Text>
          </View>
        ) : null}

        {!error && threads.length > 0 ? (
          <View style={styles.list}>
            {threads.map((thread, index) => {
              const latest = thread.replies[thread.replies.length - 1];
              const unread = member ? isThreadUnread(thread, member.user) : false;
              return (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${thread.subject}${thread.isPrivate ? ', private' : ''}${unread ? ', unread' : ''}, ${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`}
                  onPress={() => router.push(`/communication/${encodeURIComponent(thread.id)}` as never)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, unread && styles.unreadRow, pressed && styles.pressed]}
                >
                  <View style={[styles.threadIcon, unread && styles.threadIconUnread]}>
                    <AppSymbol name={{ ios: 'message.fill', android: 'chat_bubble' } as never} color={unread ? theme.ember : theme.secondary} size={18} />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.rowTitleLine}>
                      <Text numberOfLines={1} style={[styles.rowTitle, unread && styles.rowTitleUnread]}>{thread.subject}</Text>
                      {thread.isPrivate ? <AppSymbol name={{ ios: 'lock.fill', android: 'lock' } as never} color={theme.secondary} size={13} /> : null}
                      {unread ? <View style={styles.unreadDot} /> : null}
                    </View>
                    <Text numberOfLines={2} style={styles.preview}>{latest?.body ?? thread.description}</Text>
                    <Text style={styles.rowMeta}>{latest ? `${latest.createdBy} replied` : `Started by ${thread.createdBy}`} · {formatDate(latestDate(thread))}</Text>
                  </View>
                  <View style={styles.replyCount}>
                    <AppSymbol name={{ ios: 'bubble.left', android: 'chat_bubble_outline' } as never} color={theme.secondary} size={14} />
                    <Text style={styles.replyCountText}>{thread.replies.length}</Text>
                  </View>
                  <AppSymbol name={{ ios: 'chevron.right', android: 'chevron_right' } as never} color={theme.secondary} size={16} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 42, gap: 22 },
    pageTitle: { color: theme.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
    headingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    headingCopy: { flex: 1, gap: 4 },
    headingMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
    company: { color: theme.secondary, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 },
    addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 },
    addButtonLabel: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontWeight: '800' },
    sectionMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
    unreadCount: { overflow: 'hidden', color: theme.ember, backgroundColor: theme.dangerSurface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '800' },
    stateText: { color: theme.secondary, fontSize: 15, lineHeight: 21, paddingVertical: 24 },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper },
    row: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 14 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    unreadRow: { backgroundColor: theme.dangerSurface },
    threadIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: theme.surfaceAlt },
    threadIconUnread: { backgroundColor: theme.paper },
    rowCopy: { flex: 1, gap: 4 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    rowTitle: { flexShrink: 1, color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    rowTitleUnread: { fontWeight: '800' },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.ember },
    preview: { color: theme.secondary, fontSize: 14, lineHeight: 19 },
    rowMeta: { color: theme.secondary, fontSize: 11, lineHeight: 16 },
    replyCount: { alignItems: 'center', gap: 2 },
    replyCountText: { color: theme.secondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 46, gap: 8 },
    emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt, marginBottom: 5 },
    emptyTitle: { color: theme.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    emptyText: { maxWidth: 310, color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    errorBlock: { backgroundColor: theme.dangerSurface, borderRadius: 14, padding: 17, gap: 7 },
    errorTitle: { color: theme.danger, fontSize: 17, lineHeight: 22, fontWeight: '700' },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 },
    retryButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 9, paddingHorizontal: 14, marginTop: 3 },
    retryLabel: { color: theme.commandText, fontSize: 13, fontWeight: '700' },
    pressed: { opacity: 0.68 },
  });
}
