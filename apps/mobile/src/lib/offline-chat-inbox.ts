import type { DeviceReply } from './offline-user-sync';

// Bridge from the provider-owned scoped outbox to the module-level inbox and
// Crew Chat stores. The provider publishes the current account's command
// service and overlays; stores use them only for the exact same account.
export type OfflineChatInbox = {
  companyId: string;
  userId: string;
  markNotificationRead(id: string): Promise<unknown>;
  markThreadSeen(threadId: string, seenThrough: string): Promise<unknown>;
  /** Notification IDs marked read on this device, with the device time. */
  reads: ReadonlyMap<string, string>;
  /** Highest seen marker per thread saved on this device. */
  seen: ReadonlyMap<string, string>;
  postReply(reply: { id: string; threadId: string; body: string }): Promise<unknown>;
  /** Client UUID for a new intended reply. */
  newId(): string;
  /** Crew Chat replies saved on this device (see deviceReplies). */
  replies: readonly DeviceReply[];
};

let current: OfflineChatInbox | null = null;
const listeners = new Set<() => void>();

export function publishOfflineChatInbox(value: OfflineChatInbox | null) {
  if (value === current) return;
  current = value;
  listeners.forEach((listener) => listener());
}

export function offlineChatInbox(companyId: string | null | undefined, userId: string | null | undefined) {
  return current && current.companyId === companyId && current.userId === userId ? current : null;
}

export function subscribeOfflineChatInbox(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
