import { useEffect, useSyncExternalStore } from 'react';
import type { CommunicationReply, CommunicationThread, UserRole } from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { offlineChatInbox, subscribeOfflineChatInbox, type OfflineChatInbox } from './offline-chat-inbox';
import { laterTimestamp, type DeviceReply } from './offline-user-sync';
import { downloadedCompanyList, subscribeOfflineCompanyLists, type DownloadedListInfo } from './offline-company-lists';
import { isOffline } from '@/providers/network-provider';

type CommunicationThreadRow = {
  id: string;
  subject: string;
  description: string;
  created_by: string | null;
  created_by_name: string;
  created_by_role: UserRole;
  is_private: boolean;
  created_at: string;
};

type CommunicationReplyRow = {
  id: string;
  thread_id: string;
  body: string;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
};

type CommunicationReadRow = { thread_id: string; seen_at: string };

type CommunicationsSnapshot = {
  threads: CommunicationThread[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Replies shown from this device's saved commands, by reply ID. */
  deviceReplies?: Readonly<Record<string, DeviceReply['state']>>;
  /** Shown from the verified offline download, not a live read. */
  downloaded?: DownloadedListInfo | null;
};

let snapshot: CommunicationsSnapshot = {
  threads: [],
  loading: true,
  refreshing: false,
  error: null,
};
let activeCompanyId: string | null | undefined;
let activeUserId: string | null | undefined;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let requestVersion = -1;
let refreshQueued = false;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: CommunicationsSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** Overlays seen markers saved on this device onto the last downloaded threads. */
export function withOfflineSeen(value: CommunicationsSnapshot, markers: Pick<OfflineChatInbox, 'seen'> | null): CommunicationsSnapshot {
  if (!markers?.seen.size) return value;
  let changed = false;
  const threads = value.threads.map((thread) => {
    const saved = markers.seen.get(thread.id);
    if (saved === undefined) return thread;
    const seenAt = laterTimestamp(thread.seenAt, saved);
    if (seenAt === thread.seenAt) return thread;
    changed = true;
    return { ...thread, seenAt };
  });
  return changed ? { ...value, threads } : value;
}

/** Appends this device's saved replies the downloaded threads do not have yet. */
export function withOfflineReplies(value: CommunicationsSnapshot, inbox: Pick<OfflineChatInbox, 'replies'> | null, userId: string): CommunicationsSnapshot {
  if (!inbox?.replies.length) return value;
  const states: Record<string, DeviceReply['state']> = {};
  const threads = value.threads.map((thread) => {
    const saved = inbox.replies.filter((reply) => reply.threadId === thread.id && !thread.replies.some((item) => item.id === reply.id));
    if (!saved.length) return thread;
    for (const reply of saved) states[reply.id] = reply.state;
    return { ...thread, replies: [...thread.replies, ...saved.map((reply) => ({ id: reply.id, body: reply.body, createdBy: 'You', createdById: userId, createdAt: reply.createdAt ?? reply.savedAt }))] };
  });
  return Object.keys(states).length ? { ...value, threads, deviceReplies: states } : value;
}

let view: { source: CommunicationsSnapshot; markers: OfflineChatInbox | null; value: CommunicationsSnapshot } | null = null;
function currentView() {
  const markers = offlineChatInbox(activeCompanyId, activeUserId);
  if (view?.source !== snapshot || view.markers !== markers) view = { source: snapshot, markers, value: withOfflineReplies(withOfflineSeen(snapshot, markers), markers, activeUserId ?? '') };
  return view.value;
}
// One client ID per intended offline reply, reused when a failed device save is retried.
const offlineReplyIds = new Map<string, string>();
subscribeOfflineChatInbox(() => listeners.forEach((listener) => listener()));

/** Newest server timestamp this device displays for a thread, verbatim (keeps microseconds). */
export function displayedThroughOf(thread: CommunicationThread) {
  return thread.replies.reduce((latest, reply) => laterTimestamp(latest, reply.createdAt), thread.createdAt);
}

function orderThreads(threads: CommunicationThread[]) {
  return [...threads].sort((left, right) => {
    const leftDate = left.replies[left.replies.length - 1]?.createdAt ?? left.createdAt;
    const rightDate = right.replies[right.replies.length - 1]?.createdAt ?? right.createdAt;
    return Date.parse(rightDate) - Date.parse(leftDate);
  });
}

function replyFromRow(row: CommunicationReplyRow): CommunicationReply {
  return {
    id: row.id,
    body: row.body,
    createdBy: row.created_by_name,
    createdById: row.created_by ?? '',
    createdAt: row.created_at,
  };
}

subscribeOfflineCompanyLists(() => { if (isOffline() && activeCompanyId) void refreshCommunications(); });

export function refreshCommunications() {
  if (request && requestVersion === selectionVersion) {
    refreshQueued = true;
    return request;
  }

  refreshQueued = false;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  const userId = activeUserId;
  emit({
    ...snapshot,
    loading: snapshot.threads.length === 0,
    refreshing: snapshot.threads.length > 0,
    error: null,
  });

  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Communications could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId || !userId) {
      if (version === selectionVersion) emit({ threads: [], loading: false, refreshing: false, error: null });
      return;
    }

    try {
      // Offline, the verified download replaces cached HTTP reads.
      const downloaded = isOffline() ? downloadedCompanyList('crew_chat', companyId) : null;
      const [threadResult, replyResult, readResult] = downloaded ? [{ data: downloaded.tables.communication_threads, error: null }, { data: downloaded.tables.communication_replies, error: null }, { data: downloaded.tables.communication_reads, error: null }] : await Promise.all([
        supabase
          .from('communication_threads')
          .select('id,subject,description,created_by,created_by_name,created_by_role,is_private,created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        supabase
          .from('communication_replies')
          .select('id,thread_id,body,created_by,created_by_name,created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true }),
        supabase
          .from('communication_reads')
          .select('thread_id,seen_at')
          .eq('company_id', companyId)
          .eq('user_id', userId),
      ]);
      if (version !== selectionVersion) return;
      const failed = threadResult.error ?? replyResult.error ?? readResult.error;
      if (failed) {
        emit({ ...snapshot, loading: false, refreshing: false, error: `Communications could not load. ${failed.message}` });
        return;
      }

      const repliesByThread = new Map<string, CommunicationReplyRow[]>();
      for (const reply of (replyResult.data ?? []) as CommunicationReplyRow[]) {
        const replies = repliesByThread.get(reply.thread_id) ?? [];
        replies.push(reply);
        repliesByThread.set(reply.thread_id, replies);
      }
      const reads = new Map(((readResult.data ?? []) as CommunicationReadRow[]).map((read) => [read.thread_id, read.seen_at]));
      const threads = ((threadResult.data ?? []) as CommunicationThreadRow[]).map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        description: thread.description,
        createdBy: thread.created_by_name,
        createdById: thread.created_by ?? '',
        createdByRole: thread.created_by_role,
        createdAt: thread.created_at,
        seenAt: reads.get(thread.id),
        isPrivate: Boolean(thread.is_private),
        replies: (repliesByThread.get(thread.id) ?? []).map(replyFromRow),
      }));
      emit({ threads: orderThreads(threads), loading: false, refreshing: false, error: null, downloaded: downloaded?.info ?? null });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      const detail = loadError instanceof Error ? loadError.message : 'Network request failed.';
      emit({ ...snapshot, loading: false, refreshing: false, error: `Communications could not load. ${detail}` });
    }
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === selectionVersion) {
      refreshQueued = false;
      void refreshCommunications();
    }
  });
  requestVersion = version;
  return request;
}

export async function createCommunicationThread(subject: string, description: string, isPrivate = false) {
  if (!supabase || !activeCompanyId) throw new Error('Company communications are unavailable.');
  const { data, error } = await supabase
    .from('communication_threads')
    .insert({ company_id: activeCompanyId, subject, description, is_private: isPrivate })
    .select('id,subject,description,created_by,created_by_name,created_by_role,is_private,created_at')
    .single<CommunicationThreadRow>();
  if (error) throw new Error(error.message);
  const thread: CommunicationThread = {
    id: data.id,
    subject: data.subject,
    description: data.description,
    createdBy: data.created_by_name,
    createdById: data.created_by ?? '',
    createdByRole: data.created_by_role,
    createdAt: data.created_at,
    seenAt: data.created_at,
    isPrivate: data.is_private,
    replies: [],
  };
  emit({ ...snapshot, threads: orderThreads([thread, ...snapshot.threads.filter((item) => item.id !== thread.id)]) });
  return thread;
}

export async function deleteCommunicationThread(threadId: string) {
  if (!supabase || !activeCompanyId) throw new Error('Company communications are unavailable.');
  const { error } = await supabase
    .from('communication_threads')
    .delete()
    .eq('id', threadId)
    .eq('company_id', activeCompanyId);
  if (error) throw new Error(error.message);
  emit({ ...snapshot, threads: snapshot.threads.filter((thread) => thread.id !== threadId) });
}

export async function replyToCommunicationThread(threadId: string, body: string) {
  if (!supabase || !activeCompanyId) throw new Error('Company communications are unavailable.');
  if (isOffline()) {
    // Saved on the device and posted once when connected; a deleted thread posts nothing.
    const inbox = offlineChatInbox(activeCompanyId, activeUserId);
    if (!inbox || !activeUserId || !snapshot.threads.some((thread) => thread.id === threadId)) throw new Error('Replying offline is unavailable on this device.');
    const text = body.trim();
    const key = `${activeCompanyId}:${activeUserId}:${threadId}:${text}`;
    const id = offlineReplyIds.get(key) ?? inbox.newId();
    offlineReplyIds.set(key, id);
    await inbox.postReply({ id, threadId, body: text });
    offlineReplyIds.delete(key);
    return { id, body: text, createdBy: 'You', createdById: activeUserId, createdAt: new Date().toISOString() };
  }
  const { data, error } = await supabase
    .from('communication_replies')
    .insert({ company_id: activeCompanyId, thread_id: threadId, body })
    .select('id,thread_id,body,created_by,created_by_name,created_at')
    .single<CommunicationReplyRow>();
  if (error) throw new Error(error.message);
  const reply = replyFromRow(data);
  emit({
    ...snapshot,
    threads: orderThreads(snapshot.threads.map((thread) => thread.id === threadId
      ? { ...thread, replies: [...thread.replies.filter((item) => item.id !== reply.id), reply], seenAt: reply.createdAt }
      : thread)),
  });
  return reply;
}

export async function deleteCommunicationReply(threadId: string, replyId: string) {
  if (!supabase || !activeCompanyId) throw new Error('Company communications are unavailable.');
  const { error } = await supabase
    .from('communication_replies')
    .delete()
    .eq('id', replyId)
    .eq('thread_id', threadId)
    .eq('company_id', activeCompanyId);
  if (error) throw new Error(error.message);
  emit({
    ...snapshot,
    threads: snapshot.threads.map((thread) => thread.id === threadId
      ? { ...thread, replies: thread.replies.filter((reply) => reply.id !== replyId) }
      : thread),
  });
}

export async function markCommunicationThreadSeen(threadId: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Company communications are unavailable.');
  if (isOffline()) {
    // Offline: seen only through what this device displays, so replies posted
    // meanwhile stay unread. Saved first, then shown, so failures cannot loop.
    const markers = offlineChatInbox(activeCompanyId, activeUserId);
    const thread = snapshot.threads.find((item) => item.id === threadId);
    if (!markers || !thread) throw new Error('Marking this thread seen offline is unavailable on this device.');
    const seenThrough = displayedThroughOf(thread);
    await markers.markThreadSeen(threadId, seenThrough);
    emit({
      ...snapshot,
      threads: snapshot.threads.map((item) => item.id === threadId ? { ...item, seenAt: laterTimestamp(item.seenAt, seenThrough) } : item),
    });
    return seenThrough;
  }
  const seenAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('communication_reads')
    .upsert(
      { company_id: activeCompanyId, thread_id: threadId, user_id: activeUserId, seen_at: seenAt },
      { onConflict: 'company_id,thread_id,user_id' },
    )
    .select('seen_at')
    .single<{ seen_at: string }>();
  if (error) throw new Error(error.message);
  emit({
    ...snapshot,
    threads: snapshot.threads.map((thread) => thread.id === threadId ? { ...thread, seenAt: data.seen_at } : thread),
  });
  return data.seen_at;
}

function selectAccount(companyId: string | null, userId: string | null) {
  if (companyId === activeCompanyId && userId === activeUserId) return;
  activeCompanyId = companyId;
  activeUserId = userId;
  selectionVersion += 1;
  refreshQueued = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ threads: [], loading: Boolean(companyId && userId), refreshing: false, error: null });
  if (!companyId || !userId || !supabase) return;

  channel = supabase.channel(`mobile-communications:${companyId}:${userId}`);
  ['communication_threads', 'communication_replies', 'communication_reads'].forEach((table) => {
    channel = channel?.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
      () => void refreshCommunications(),
    ) ?? null;
  });
  channel?.subscribe();
  void refreshCommunications();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCommunications(companyId: string | null, userId: string | null) {
  useEffect(() => selectAccount(companyId, userId), [companyId, userId]);
  return useSyncExternalStore(subscribe, currentView, currentView);
}
