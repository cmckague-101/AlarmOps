import * as SecureStore from 'expo-secure-store';

// Notifications cleared on this device that the server has not confirmed yet
// (offline, or the request failed). They stay hidden here and are sent to the
// server on the next online refresh; the server clear is what syncs devices.

const storagePrefix = 'fireops-dismissed-notifications';

export function dismissedNotificationsKey(companyId: string, userId: string) {
  return `${storagePrefix}.${companyId}.${userId}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function readDismissedNotificationIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function serializeDismissedNotificationIds(ids: Iterable<string>) {
  return JSON.stringify([...ids]);
}

export function addDismissedNotificationId(ids: Set<string>, id: string) {
  if (!id || ids.has(id)) return ids;
  const next = new Set(ids);
  next.add(id);
  return next;
}

export function addDismissedNotificationIds(ids: Set<string>, nextIds: Iterable<string>) {
  let changed = false;
  const next = new Set(ids);
  for (const id of nextIds) {
    if (!id || next.has(id)) continue;
    next.add(id);
    changed = true;
  }
  return changed ? next : ids;
}

export function withDismissedNotifications<
  T extends {id: string; readAt: string | null},
  V extends {notifications: T[]; unreadCount: number},
>(value: V, dismissed: Set<string> | null | undefined): V {
  if (!dismissed?.size) return value;
  let removedUnread = 0;
  const notifications = value.notifications.filter((item) => {
    if (!dismissed.has(item.id)) return true;
    if (!item.readAt) removedUnread += 1;
    return false;
  });
  if (notifications.length === value.notifications.length) return value;
  return {
    ...value,
    notifications,
    unreadCount: Math.max(0, value.unreadCount - removedUnread),
  };
}

type Account = {companyId: string; userId: string};

let active: Account | null = null;
let dismissed = new Set<string>();
let loadVersion = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

async function persist(account: Account, ids: Set<string>) {
  const key = dismissedNotificationsKey(account.companyId, account.userId);
  try {
    if (!ids.size) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await SecureStore.setItemAsync(key, serializeDismissedNotificationIds(ids));
  } catch {
    // Keep in-memory dismissals if secure storage is unavailable.
  }
}

export function subscribeDismissedNotifications(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentDismissedNotificationIds() {
  return dismissed;
}

export function selectDismissedNotificationsAccount(companyId: string | null, userId: string | null) {
  if (!companyId || !userId) {
    active = null;
    dismissed = new Set();
    loadVersion += 1;
    emit();
    return;
  }
  if (active?.companyId === companyId && active.userId === userId) return;
  active = {companyId, userId};
  dismissed = new Set();
  const version = ++loadVersion;
  emit();
  void SecureStore.getItemAsync(dismissedNotificationsKey(companyId, userId))
    .then((raw) => {
      if (version !== loadVersion || active?.companyId !== companyId || active.userId !== userId) return;
      dismissed = readDismissedNotificationIds(raw);
      emit();
    })
    .catch(() => undefined);
}

/** Hides notifications on this device right away and remembers them until the server confirms the clear. */
export async function rememberDismissedNotifications(ids: Iterable<string>) {
  if (!active) return;
  const account = active;
  const next = addDismissedNotificationIds(dismissed, ids);
  if (next === dismissed) return;
  dismissed = next;
  emit();
  await persist(account, next);
}

/** Drops ids the server has cleared; the inbox no longer returns them. */
export async function forgetDismissedNotifications(companyId: string, userId: string, ids: Iterable<string>) {
  if (active?.companyId !== companyId || active.userId !== userId) return;
  const account = active;
  const remove = new Set(ids);
  const next = new Set([...dismissed].filter((id) => !remove.has(id)));
  if (next.size === dismissed.size) return;
  dismissed = next;
  emit();
  await persist(account, next);
}

/** Test helper: replace in-memory dismissals without touching SecureStore. */
export function resetDismissedNotificationsForTests(ids: Iterable<string> = []) {
  active = {companyId: 'test-company', userId: 'test-user'};
  dismissed = new Set(ids);
  loadVersion += 1;
  emit();
}
