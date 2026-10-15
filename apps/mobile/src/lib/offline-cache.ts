import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

const databaseName = 'fireops-offline.db';
let activeUserId: string | null = null;
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

type CachedResponse = {
  request_url: string;
  status: number;
  headers: string;
  body: string;
};

type CachedAccess = {
  value: string;
  verified_at: string;
};

function database() {
  if (Platform.OS === 'web') return null;
  databasePromise ??= SQLite.openDatabaseAsync(databaseName).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS response_cache (
        cache_key TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        request_url TEXT NOT NULL,
        status INTEGER NOT NULL,
        headers TEXT NOT NULL,
        body TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_access_cache (
        user_id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );
    `);
    return db;
  });
  return databasePromise;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
}

function cacheKey(userId: string, requestKey: string) {
  return `${userId}:${hash(requestKey)}`;
}

export function setOfflineCacheUser(userId: string | null) {
  activeUserId = userId;
}

export async function storeReadResponse(requestKey: string, response: Response) {
  const userId = activeUserId;
  const db = database();
  if (!userId || !db || !response.ok) return;
  const copy = response.clone();
  const [databaseHandle, body] = await Promise.all([db, copy.text()]);
  const headers = JSON.stringify(Object.fromEntries(copy.headers.entries()));
  await databaseHandle.runAsync(
    `INSERT OR REPLACE INTO response_cache
      (cache_key, user_id, request_url, status, headers, body, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    cacheKey(userId, requestKey), userId, requestKey, copy.status, headers, body, new Date().toISOString(),
  );
}

export async function loadReadResponse(requestKey: string) {
  const userId = activeUserId;
  const db = database();
  if (!userId || !db) return null;
  const row = await (await db).getFirstAsync<CachedResponse>(
    'SELECT request_url, status, headers, body FROM response_cache WHERE cache_key = ? AND user_id = ?',
    cacheKey(userId, requestKey), userId,
  );
  if (!row || row.request_url !== requestKey) return null;
  const body = [204, 205, 304].includes(row.status) ? null : row.body;
  return new Response(body, { status: row.status, headers: JSON.parse(row.headers) as Record<string, string> });
}

export async function storeAccountAccess(userId: string, value: unknown) {
  const db = database();
  if (!db) return;
  await (await db).runAsync(
    'INSERT OR REPLACE INTO account_access_cache (user_id, value, verified_at) VALUES (?, ?, ?)',
    userId, JSON.stringify(value), new Date().toISOString(),
  );
}

export async function loadAccountAccess<T>(userId: string): Promise<{ value: T; verifiedAt: string } | null> {
  const db = database();
  if (!db) return null;
  const row = await (await db).getFirstAsync<CachedAccess>(
    'SELECT value, verified_at FROM account_access_cache WHERE user_id = ?', userId,
  );
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, verifiedAt: row.verified_at };
  } catch {
    return null;
  }
}
