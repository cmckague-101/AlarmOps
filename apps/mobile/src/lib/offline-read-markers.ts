// Bridge from the provider-owned scoped outbox to the module-level inbox and
// Crew Chat stores. The provider publishes the current account's command
// service and overlays; stores use them only for the exact same account.
export type OfflineReadMarkers = {
  companyId: string;
  userId: string;
  markNotificationRead(id: string): Promise<unknown>;
  markThreadSeen(threadId: string, seenThrough: string): Promise<unknown>;
  /** Notification IDs marked read on this device, with the device time. */
  reads: ReadonlyMap<string, string>;
  /** Highest seen marker per thread saved on this device. */
  seen: ReadonlyMap<string, string>;
};

let current: OfflineReadMarkers | null = null;
const listeners = new Set<() => void>();

export function publishOfflineReadMarkers(value: OfflineReadMarkers | null) {
  if (value === current) return;
  current = value;
  listeners.forEach((listener) => listener());
}

export function offlineReadMarkers(companyId: string | null | undefined, userId: string | null | undefined) {
  return current && current.companyId === companyId && current.userId === userId ? current : null;
}

export function subscribeOfflineReadMarkers(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
