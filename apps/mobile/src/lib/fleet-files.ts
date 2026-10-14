import { File } from "expo-file-system";

import { createFleetId, type FleetVehicleFile } from "@/lib/fleet-store";
import { supabase } from "@/lib/supabase";

const bucket = "fleet-files";
const signedUrlLifetimeSeconds = 24 * 60 * 60;
const signedUrlCacheLifetimeMs = 23 * 60 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signedUrlQueue = new Map<string, { resolve: (url: string) => void; reject: (error: unknown) => void }[]>();
let signedUrlFlush: ReturnType<typeof setTimeout> | null = null;

async function flushSignedUrlQueue() {
  signedUrlFlush = null;
  const queued = new Map(signedUrlQueue);
  signedUrlQueue.clear();
  const paths = [...queued.keys()];
  if (!supabase) {
    const error = new Error("Attachment is unavailable.");
    queued.forEach((requests) => requests.forEach(({ reject }) => reject(error)));
    return;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, signedUrlLifetimeSeconds);
  if (error) {
    queued.forEach((requests) => requests.forEach(({ reject }) => reject(error)));
    return;
  }

  const urls = new Map(data.flatMap((item) => item.path ? [[item.path, item] as const] : []));
  queued.forEach((requests, path) => {
    const result = urls.get(path);
    if (!result?.signedUrl || result.error) {
      const requestError = new Error(result?.error ?? "Attachment is unavailable.");
      requests.forEach(({ reject }) => reject(requestError));
      return;
    }
    signedUrlCache.set(path, { url: result.signedUrl, expiresAt: Date.now() + signedUrlCacheLifetimeMs });
    requests.forEach(({ resolve }) => resolve(result.signedUrl!));
  });
}

export type LocalFleetFile = {
  uri: string;
  name: string;
  type: string | null;
};

function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "attachment";
}

export async function uploadFleetFile(
  companyId: string,
  userId: string,
  file: LocalFleetFile,
): Promise<FleetVehicleFile> {
  if (!supabase) throw new Error("File storage is unavailable for this build.");
  const path = `${companyId}/${userId}/${createFleetId()}-${safeFileName(file.name)}`;
  const localFile = new File(file.uri);
  if (!localFile.exists)
    throw new Error("Selected file is no longer available.");
  if (localFile.size > 8 * 1024 * 1024)
    throw new Error("Attachment must be 8 MB or smaller.");
  const body = await localFile.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType: file.type ?? "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { name: file.name, type: file.type, path };
}

export async function openFleetFile(file: FleetVehicleFile | { path: string }) {
  if (!supabase || !file.path) throw new Error("Attachment is unavailable.");
  const path = file.path;
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  signedUrlCache.delete(path);

  return new Promise<string>((resolve, reject) => {
    const requests = signedUrlQueue.get(path) ?? [];
    requests.push({ resolve, reject });
    signedUrlQueue.set(path, requests);
    if (!signedUrlFlush) signedUrlFlush = setTimeout(() => void flushSignedUrlQueue(), 0);
  });
}

export async function removeFleetFiles(paths: (string | null | undefined)[]) {
  if (!supabase) throw new Error("File storage is unavailable for this build.");
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  if (!uniquePaths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(uniquePaths);
  if (error) throw error;
  uniquePaths.forEach((path) => signedUrlCache.delete(path));
}
