import { File, Paths } from 'expo-file-system';
import type { NifcIncident } from '@fireops/domain';

// Last fire list loaded online (public NIFC data: id, name, state only), kept on
// the device so a fire can be assigned offline. Display/choice data only; the
// server still validates the assignment when it syncs.
export type DownloadedFire = Pick<NifcIncident, 'id' | 'name' | 'state'>;
export type DownloadedFireList = { savedAt: string; fires: DownloadedFire[] };
const file = () => new File(Paths.document, 'fireops-fire-list-v1.json');
const short = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200;

/** Decodes a stored list strictly; anything unexpected is ignored. */
export function decodeFireList(value: unknown): DownloadedFireList | null {
  const data = value as { savedAt?: unknown; fires?: unknown } | null;
  if (!data || typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt)) || !Array.isArray(data.fires) || data.fires.length > 5000) return null;
  const fires = data.fires.filter((fire): fire is DownloadedFire => !!fire && typeof fire === 'object' && short(fire.id) && short(fire.name) && short(fire.state));
  return fires.length === data.fires.length ? { savedAt: data.savedAt, fires } : null;
}

export function saveFireList(incidents: readonly NifcIncident[], now = new Date().toISOString()) {
  try { file().write(JSON.stringify({ savedAt: now, fires: incidents.filter((fire) => short(fire.id) && short(fire.name) && short(fire.state)).slice(0, 5000).map(({ id, name, state }) => ({ id, name, state })) })); } catch { /* The previous list stays; nothing else depends on it. */ }
}

export async function readFireList(): Promise<DownloadedFireList | null> {
  try { const stored = file(); return stored.exists ? decodeFireList(JSON.parse(await stored.text())) : null; } catch { return null; }
}
