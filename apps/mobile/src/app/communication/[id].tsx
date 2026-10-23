import { useCallback, useEffect, useMemo, useState } from 'react';
import { isCompanyManager, isThreadUnread } from '@fireops/domain';
import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteCommunicationReply, deleteCommunicationThread, markCommunicationThreadSeen, refreshCommunications, replyToCommunicationThread, useCommunications } from '@/lib/communications-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function initial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export default function CommunicationThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const companyId = member?.company.id ?? null;
  const userId = member?.user.id ?? null;
  const { threads, loading, error, deviceReplies } = useCommunications(companyId, userId);
  const thread = threads.find((item) => item.id === id);
  const joined = Boolean(thread && (thread.createdById === member?.user.id || thread.replies.some((item) => item.createdById === member?.user.id)));
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!companyId || !userId) return;
    void refreshCommunications();
  }, [companyId, userId]));

  useEffect(() => {
    if (thread && member && isThreadUnread(thread, member.user)) {
      void markCommunicationThreadSeen(thread.id).catch(() => undefined);
    }
  }, [thread, member]);

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const postReply = async () => {
    if (!thread || !reply.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      await replyToCommunicationThread(thread.id, reply.trim());
      setReply('');
    } catch (replyError) {
      setSaveError(replyError instanceof Error ? replyError.message : 'Reply could not be posted. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const joinConversation = async () => {
    if (!thread || joined) return;
    setJoining(true);
    setSaveError('');
    try {
      await replyToCommunicationThread(thread.id, 'Joined the conversation.');
    } catch (joinError) {
      setSaveError(joinError instanceof Error ? joinError.message : 'Could not join the conversation. Check your connection and try again.');
    } finally {
      setJoining(false);
    }
  };

  const confirmDeleteReply = (replyId: string) => {
    if (!thread) return;
    Alert.alert('Delete comment?', 'This permanently deletes this crew comment.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingReplyId(replyId);
          setSaveError('');
          try {
            await deleteCommunicationReply(thread.id, replyId);
          } catch (deleteError) {
            setSaveError(deleteError instanceof Error ? deleteError.message : 'Comment could not be deleted.');
          } finally {
            setDeletingReplyId(null);
          }
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert('Delete thread?', 'This permanently deletes the thread and all replies.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setSaveError('');
          try {
            await deleteCommunicationThread(id);
            router.replace('/(tabs)/communications');
          } catch (deleteError) {
            setSaveError(deleteError instanceof Error ? deleteError.message : 'Thread could not be deleted.');
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{
        title: thread?.subject ?? 'Thread',
        headerRight: member && isCompanyManager(member.user.role) && thread ? () => (
          <Pressable accessibilityRole="button" disabled={deleting} onPress={confirmDelete}>
            <Text style={{ color: theme.danger, fontWeight: '700' }}>{deleting ? 'Deleting...' : 'Delete'}</Text>
          </Pressable>
        ) : undefined,
      }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          {loading ? <Text style={styles.stateText}>Loading thread…</Text> : null}
          {!loading && (error || !thread) ? (
            <View style={styles.message}>
              <Text style={styles.messageTitle}>{error ? 'Thread unavailable' : 'Thread not found'}</Text>
              <Text style={styles.messageText}>{error ?? 'This thread may have been removed or you may not have access.'}</Text>
            </View>
          ) : null}

          {thread ? (
            <>
              <View style={styles.opening}>
                <View style={styles.authorRow}>
                  <View style={styles.avatar}><Text style={styles.avatarLabel}>{initial(thread.createdBy)}</Text></View>
                  <View style={styles.authorCopy}>
                    <Text style={styles.authorName}>{thread.createdBy}</Text>
                    <Text style={styles.authorMeta}>{thread.createdByRole === 'owner' ? 'Company owner' : 'Crew'} · {formatDate(thread.createdAt)}</Text>
                  </View>
                </View>
                <Text accessibilityRole="header" style={styles.title}>{thread.subject}</Text>
                <Text selectable style={styles.body}>{thread.description}</Text>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.sectionTitle}>Replies</Text>
                  <Text style={styles.count}>{thread.replies.length}</Text>
                </View>
                {thread.replies.length ? (
                  <View style={styles.replyList}>
                    {thread.replies.map((item) => {
                      const mine = item.createdById === member?.user.id;
                      const device = deviceReplies?.[item.id];
                      return (
                        <View key={item.id} style={[styles.replyCard, mine && styles.myReplyCard]}>
                          <View style={styles.authorRow}>
                            <View style={[styles.smallAvatar, mine && styles.myAvatar]}><Text style={[styles.smallAvatarLabel, mine && styles.myAvatarLabel]}>{initial(item.createdBy)}</Text></View>
                            <View style={styles.authorCopy}>
                              <Text style={styles.replyAuthor}>{mine ? 'You' : item.createdBy}</Text>
                              <Text style={styles.authorMeta}>{device === 'saved' ? 'Saved on this device — posts when connected' : device === 'action_needed' ? 'Saved on this device — action needed in Saved changes & sync' : formatDate(item.createdAt)}</Text>
                            </View>
                            {member && isCompanyManager(member.user.role) && !device ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Delete comment from ${item.createdBy}`}
                                disabled={deletingReplyId !== null}
                                onPress={() => confirmDeleteReply(item.id)}
                                style={({ pressed }) => [styles.deleteReplyButton, pressed && styles.pressed]}
                              >
                                <Text style={styles.deleteReplyLabel}>{deletingReplyId === item.id ? 'Deleting…' : 'Delete'}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          <Text selectable style={styles.replyBody}>{item.body}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : <Text style={styles.emptyReplies}>No replies yet. Start the conversation below.</Text>}
              </View>

              <View style={styles.joinRow}>
                <Text style={styles.joinCopy}>Get notified when someone replies.</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={joined || joining || saving}
                  onPress={() => void joinConversation()}
                  style={({ pressed }) => [styles.joinButton, (joined || joining || saving) && styles.disabled, pressed && !joining && styles.pressed]}
                >
                  <Text style={styles.joinLabel}>{joined ? 'Joined' : joining ? 'Joining…' : 'Join conversation'}</Text>
                </Pressable>
              </View>
              {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}

              <View style={styles.replyForm}>
                <Text style={styles.label}>Reply to thread</Text>
                <TextInput
                  accessibilityLabel="Reply to thread"
                  maxLength={5000}
                  multiline
                  onChangeText={setReply}
                  placeholder="Write a reply"
                  placeholderTextColor={theme.secondary}
                  style={styles.input}
                  textAlignVertical="top"
                  value={reply}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || joining || !reply.trim()}
                  onPress={() => void postReply()}
                  style={({ pressed }) => [styles.submitButton, (saving || joining || !reply.trim()) && styles.disabled, pressed && !saving && styles.pressed]}
                >
                  <Text style={styles.submitLabel}>{saving ? 'Posting…' : 'Post reply'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 28 },
    stateText: { color: theme.secondary, fontSize: 16, paddingVertical: 32 },
    opening: { gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider, paddingBottom: 25 },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    avatar: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.command },
    avatarLabel: { color: theme.commandText, fontSize: 17, fontWeight: '800' },
    smallAvatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: theme.surfaceAlt },
    smallAvatarLabel: { color: theme.ink, fontSize: 13, fontWeight: '800' },
    myAvatar: { backgroundColor: theme.green },
    myAvatarLabel: { color: '#FFFFFF' },
    authorCopy: { flex: 1, gap: 2 },
    authorName: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    authorMeta: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
    body: { color: theme.ink, fontSize: 16, lineHeight: 24 },
    section: { gap: 13 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: theme.ink, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    count: { color: theme.secondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    replyList: { gap: 11 },
    replyCard: { gap: 11, borderWidth: 1, borderColor: theme.divider, borderRadius: 13, backgroundColor: theme.paper, padding: 14 },
    myReplyCard: { borderColor: theme.green, backgroundColor: theme.greenSurface },
    replyAuthor: { color: theme.ink, fontSize: 14, lineHeight: 19, fontWeight: '700' },
    replyBody: { color: theme.ink, fontSize: 15, lineHeight: 22 },
    deleteReplyButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 },
    deleteReplyLabel: { color: theme.danger, fontSize: 12, fontWeight: '700' },
    emptyReplies: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    joinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    joinCopy: { flex: 1, color: theme.secondary, fontSize: 13, lineHeight: 18 },
    joinButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 10, backgroundColor: theme.paper, paddingHorizontal: 14 },
    joinLabel: { color: theme.ink, fontSize: 14, fontWeight: '800' },
    replyForm: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingTop: 22 },
    label: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    input: { minHeight: 116, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 13, fontSize: 16, lineHeight: 23 },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    submitButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember, borderRadius: 11, paddingHorizontal: 17 },
    submitLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.45 },
  });
}
