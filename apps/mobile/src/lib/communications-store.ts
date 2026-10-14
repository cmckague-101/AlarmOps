import { useEffect, useSyncExternalStore } from 'react';
import type { CommunicationReply, CommunicationThread, UserRole } from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type CommunicationThreadRow = {
  id: string;
  subject: string;
  description: string;
  created_by: string | null;
  created_by_name: string;
  created_by_role: UserRole;
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
      const [threadResult, replyResult, readResult] = await Promise.all([
        supabase
          .from('communication_threads')
          .select('id,subject,description,created_by,created_by_name,created_by_role,created_at')
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
        replies: (repliesByThread.get(thread.id) ?? []).map(replyFromRow),
      }));
      emit({ threads: orderThreads(threads), loading: false, refreshing: false, error: null });
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

export async function createCommunicationThread(subject: string, description: string) {
  if (!supabase || !activeCompanyId) throw new Error('Company communications are unavailable.');
  const { data, error } = await supabase
    .from('communication_threads')
    .insert({ company_id: activeCompanyId, subject, description })
    .select('id,subject,description,created_by,created_by_name,created_by_role,created_at')
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
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
