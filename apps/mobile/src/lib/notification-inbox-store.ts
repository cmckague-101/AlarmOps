import {useEffect, useSyncExternalStore} from 'react';
import * as Notifications from 'expo-notifications';
import type {RealtimeChannel} from '@supabase/supabase-js';

import {supabase} from '@/lib/supabase';

export type NotificationEventType =
  | 'communication_reply'
  | 'document_added'
  | 'training_created'
  | 'vehicle_assigned'
  | 'issue_updated'
  | 'system';

export type InboxNotification = {
  id: string;
  eventType: NotificationEventType;
  entityType: 'communication' | 'document' | 'training' | 'vehicle' | 'issue' | 'system';
  entityId: string | null;
  title: string;
  body: string;
  path: string;
  groupKey: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreferences = {
  pushEnabled: boolean;
  communicationReplies: boolean;
  documentAdded: boolean;
  trainingCreated: boolean;
  vehicleAssigned: boolean;
  issueUpdates: boolean;
};

type NotificationRow = {
  id: string;
  event_type: NotificationEventType;
  entity_type: InboxNotification['entityType'];
  entity_id: string | null;
  title: string;
  body: string;
  path: string;
  group_key: string;
  read_at: string | null;
  created_at: string;
};

type PreferenceRow = {
  push_enabled: boolean;
  communication_replies: boolean;
  document_added: boolean;
  training_created: boolean;
  vehicle_assigned: boolean;
  issue_updates: boolean;
};

type InboxSnapshot = {
  notifications: InboxNotification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  loading: boolean;
  refreshing: boolean;
  savingPreferences: boolean;
  error: string | null;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  communicationReplies: true,
  documentAdded: true,
  trainingCreated: true,
  vehicleAssigned: true,
  issueUpdates: true,
};

let snapshot: InboxSnapshot = {
  notifications: [],
  unreadCount: 0,
  preferences: defaultNotificationPreferences,
  loading: true,
  refreshing: false,
  savingPreferences: false,
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

function syncBadge(count: number) {
  void Notifications.setBadgeCountAsync(count).catch(() => undefined);
}

function emit(next: InboxSnapshot) {
  snapshot = next;
  syncBadge(next.unreadCount);
  listeners.forEach((listener) => listener());
}

function notificationFromRow(row: NotificationRow): InboxNotification {
  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    path: row.path,
    groupKey: row.group_key,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function preferencesFromRow(row?: PreferenceRow | null): NotificationPreferences {
  if (!row) return defaultNotificationPreferences;
  return {
    pushEnabled: row.push_enabled,
    communicationReplies: row.communication_replies,
    documentAdded: row.document_added,
    trainingCreated: row.training_created,
    vehicleAssigned: row.vehicle_assigned,
    issueUpdates: row.issue_updates,
  };
}

function preferenceValues(preferences: NotificationPreferences) {
  return {
    push_enabled: preferences.pushEnabled,
    communication_replies: preferences.communicationReplies,
    document_added: preferences.documentAdded,
    training_created: preferences.trainingCreated,
    vehicle_assigned: preferences.vehicleAssigned,
    issue_updates: preferences.issueUpdates,
  };
}

export function refreshNotificationInbox() {
  if (request && requestVersion === selectionVersion) {
    refreshQueued = true;
    return request;
  }
  refreshQueued = false;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  const userId = activeUserId;
  emit({...snapshot, loading: snapshot.notifications.length === 0, refreshing: snapshot.notifications.length > 0, error: null});

  request = (async () => {
    if (!supabase) {
      emit({...snapshot, loading: false, refreshing: false, error: 'Notifications could not load. Supabase is not configured for this build.'});
      return;
    }
    if (!companyId || !userId) {
      if (version === selectionVersion) emit({...snapshot, notifications: [], unreadCount: 0, preferences: defaultNotificationPreferences, loading: false, refreshing: false, error: null});
      return;
    }
    try {
      const [notificationResult, unreadResult, preferenceResult] = await Promise.all([
        supabase.from('user_notifications')
          .select('id,event_type,entity_type,entity_id,title,body,path,group_key,read_at,created_at')
          .eq('company_id', companyId).eq('user_id', userId)
          .neq('event_type', 'vehicle_assigned')
          .order('created_at', {ascending: false}).limit(100),
        supabase.from('user_notifications')
          .select('id', {count: 'exact', head: true})
          .eq('company_id', companyId).eq('user_id', userId)
          .neq('event_type', 'vehicle_assigned').is('read_at', null),
        supabase.from('notification_preferences')
          .select('push_enabled,communication_replies,document_added,training_created,vehicle_assigned,issue_updates')
          .eq('company_id', companyId).eq('user_id', userId).maybeSingle<PreferenceRow>(),
      ]);
      if (version !== selectionVersion) return;
      const failed = notificationResult.error ?? unreadResult.error ?? preferenceResult.error;
      if (failed) {
        emit({...snapshot, loading: false, refreshing: false, error: `Notifications could not load. ${failed.message}`});
        return;
      }
      emit({
        notifications: ((notificationResult.data ?? []) as NotificationRow[]).map(notificationFromRow),
        unreadCount: unreadResult.count ?? 0,
        preferences: preferencesFromRow(preferenceResult.data),
        loading: false,
        refreshing: false,
        savingPreferences: false,
        error: null,
      });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      const detail = loadError instanceof Error ? loadError.message : 'Network request failed.';
      emit({...snapshot, loading: false, refreshing: false, error: `Notifications could not load. ${detail}`});
    }
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === selectionVersion) {
      refreshQueued = false;
      void refreshNotificationInbox();
    }
  });
  requestVersion = version;
  return request;
}

export async function markInboxNotificationRead(notificationId: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Notifications are unavailable.');
  const readAt = new Date().toISOString();
  const previous = snapshot.notifications;
  const wasUnread = previous.some((item) => item.id === notificationId && !item.readAt);
  emit({...snapshot, unreadCount: Math.max(0, snapshot.unreadCount - (wasUnread ? 1 : 0)), notifications: previous.map((item) => item.id === notificationId ? {...item, readAt} : item)});
  const {error} = await supabase.from('user_notifications').update({read_at: readAt})
    .eq('company_id', activeCompanyId).eq('user_id', activeUserId).eq('id', notificationId);
  if (error) {
    emit({...snapshot, unreadCount: snapshot.unreadCount + (wasUnread ? 1 : 0), notifications: previous, error: `Notification could not be marked read. ${error.message}`});
    throw new Error(error.message);
  }
}

export async function markAllInboxNotificationsRead() {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Notifications are unavailable.');
  const readAt = new Date().toISOString();
  const previous = snapshot.notifications;
  const previousUnreadCount = snapshot.unreadCount;
  emit({...snapshot, unreadCount: 0, notifications: previous.map((item) => item.readAt ? item : {...item, readAt})});
  const {error} = await supabase.from('user_notifications').update({read_at: readAt})
    .eq('company_id', activeCompanyId).eq('user_id', activeUserId).is('read_at', null);
  if (error) {
    emit({...snapshot, unreadCount: previousUnreadCount, notifications: previous, error: `Notifications could not be marked read. ${error.message}`});
    throw new Error(error.message);
  }
}

export async function saveNotificationPreferences(patch: Partial<NotificationPreferences>) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Notification preferences are unavailable.');
  const previous = snapshot.preferences;
  const next = {...previous, ...patch};
  emit({...snapshot, preferences: next, savingPreferences: true, error: null});
  const {error} = await supabase.from('notification_preferences').upsert({
    company_id: activeCompanyId,
    user_id: activeUserId,
    ...preferenceValues(next),
  }, {onConflict: 'company_id,user_id'});
  if (error) {
    emit({...snapshot, preferences: previous, savingPreferences: false, error: `Notification preferences could not save. ${error.message}`});
    throw new Error(error.message);
  }
  emit({...snapshot, preferences: next, savingPreferences: false, error: null});
}

function selectAccount(companyId: string | null, userId: string | null) {
  if (companyId === activeCompanyId && userId === activeUserId) return;
  activeCompanyId = companyId;
  activeUserId = userId;
  selectionVersion += 1;
  refreshQueued = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({notifications: [], unreadCount: 0, preferences: defaultNotificationPreferences, loading: Boolean(companyId && userId), refreshing: false, savingPreferences: false, error: null});
  if (!companyId || !userId || !supabase) return;

  channel = supabase.channel(`mobile-notifications:${companyId}:${userId}`);
  ['user_notifications', 'notification_preferences'].forEach((table) => {
    channel = channel?.on('postgres_changes', {
      event: '*', schema: 'public', table, filter: `user_id=eq.${userId}`,
    }, () => void refreshNotificationInbox()) ?? null;
  });
  channel?.subscribe();
  void refreshNotificationInbox();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationInbox(companyId: string | null, userId: string | null) {
  useEffect(() => selectAccount(companyId, userId), [companyId, userId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
