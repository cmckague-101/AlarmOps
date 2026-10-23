import { useRef } from 'react';
import { createFleetId } from '@/lib/fleet-store';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';

/** This exact account's offline command writer (null for another account/company), the network state and saved entries. */
export function useOfflineUserSync(companyId: string | null | undefined, userId: string | null | undefined) {
  const offlineSync = useOptionalOfflineSync();
  const userSync = offlineSync?.userSync && offlineSync.userSync.scope.companyId === companyId && offlineSync.userSync.scope.userId === userId ? offlineSync.userSync : null;
  return { offline: !!offlineSync?.offline, userSync, entries: offlineSync?.state.entries ?? [] };
}

/** One client ID per intended record: retries of the same content reuse it; changed content gets a new one. */
export function useIntentId() {
  const current = useRef<{ key: string; id: string } | null>(null);
  return {
    for(content: unknown) { const key = JSON.stringify(content); if (current.current?.key !== key) current.current = { key, id: createFleetId() }; return current.current.id; },
    reset() { current.current = null; },
  };
}
