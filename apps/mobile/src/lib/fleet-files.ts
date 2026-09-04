import { File } from "expo-file-system";

import { createFleetId, type FleetVehicleFile } from "@/lib/fleet-store";
import { supabase } from "@/lib/supabase";

const bucket = "fleet-files";

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

export async function openFleetFile(file: FleetVehicleFile) {
  if (!supabase || !file.path) throw new Error("Attachment is unavailable.");
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(file.path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFleetFiles(paths: (string | null | undefined)[]) {
  if (!supabase) throw new Error("File storage is unavailable for this build.");
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  if (!uniquePaths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(uniquePaths);
  if (error) throw error;
}
