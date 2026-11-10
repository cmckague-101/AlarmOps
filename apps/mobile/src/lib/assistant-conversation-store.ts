import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { ASSISTANT_MAX_THREADS, cleanAssistantThreads, type AssistantThread } from '@fireops/domain';

// Assistant chats stay on this phone only, per user and company. Owners cannot see them.
const DATABASE_NAME = 'fireops-assistant.db';
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function database() {
  if (Platform.OS === 'web') return null;
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS assistant_threads (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        thread_json TEXT NOT NULL,
        PRIMARY KEY (scope, id)
      );
      CREATE TABLE IF NOT EXISTS assistant_active (
        scope TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL
      );
    `);
    return db;
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

const scopeOf = (userId: string, companyId: string) => `${userId}:${companyId}`;

export async function loadAssistantChats(userId: string, companyId: string): Promise<{ threads: AssistantThread[]; activeId: string | null }> {
  const db = await database();
  if (!db) return { threads: [], activeId: null };
  const scope = scopeOf(userId, companyId);
  const rows = await db.getAllAsync<{ thread_json: string }>(
    'SELECT thread_json FROM assistant_threads WHERE scope = ? ORDER BY updated_at DESC LIMIT ?', scope, ASSISTANT_MAX_THREADS,
  );
  const threads = cleanAssistantThreads(rows.map((row) => { try { return JSON.parse(row.thread_json); } catch { return null; } }));
  const active = await db.getFirstAsync<{ thread_id: string }>('SELECT thread_id FROM assistant_active WHERE scope = ?', scope);
  return { threads, activeId: active?.thread_id ?? null };
}

let saving: Promise<void> = Promise.resolve();

/** Replace this user's saved chats with `threads` (already capped and ordered by the caller). Saves run one at a time, in order. */
export function saveAssistantChats(userId: string, companyId: string, threads: AssistantThread[], activeId: string | null) {
  saving = saving.then(() => writeChats(userId, companyId, threads, activeId)).catch((error) => console.warn('Assistant chats could not be saved', error));
  return saving;
}

async function writeChats(userId: string, companyId: string, threads: AssistantThread[], activeId: string | null) {
  const db = await database();
  if (!db) return;
  const scope = scopeOf(userId, companyId);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM assistant_threads WHERE scope = ?', scope);
    for (const thread of threads.slice(0, ASSISTANT_MAX_THREADS)) {
      await db.runAsync('INSERT INTO assistant_threads (scope, id, updated_at, thread_json) VALUES (?, ?, ?, ?)', scope, thread.id, thread.updatedAt, JSON.stringify(thread));
    }
    if (activeId) await db.runAsync('INSERT OR REPLACE INTO assistant_active (scope, thread_id) VALUES (?, ?)', scope, activeId);
    else await db.runAsync('DELETE FROM assistant_active WHERE scope = ?', scope);
  });
}
