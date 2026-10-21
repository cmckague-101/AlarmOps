import { Platform } from 'react-native';
import { openDatabaseAsync } from 'expo-sqlite';
import { createOfflineOutbox } from './offline-outbox';

let storePromise: ReturnType<typeof createOfflineOutbox> | null = null;

/** Lazy native-only store; the session provider owns its active worker handle. */
export function getNativeOfflineOutbox() {
  if (Platform.OS === 'web') throw new Error('Offline editing is only supported on iOS and Android.');
  storePromise ??= (async () => {
    // Separate database/versioning from the existing read-response cache.
    const db = await openDatabaseAsync('fireops-sync.db');
    try {
      return await createOfflineOutbox(db);
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  })().catch((error) => {
    storePromise = null;
    throw error;
  });
  return storePromise;
}
