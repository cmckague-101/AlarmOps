// Deletes a released fleet-sync-files staging object, then records removal.
// SQL confirms removal only when the Storage object is really gone.
export type ReleaseTarget = {companyId: string; userId: string; attachmentId: string};
export type ReleaseDeps = {
  /** Uploader JWT for explicit release; service for applied documents. */
  request(target: ReleaseTarget): Promise<unknown>;
  remove(path: string): Promise<void>;
  confirm(target: ReleaseTarget): Promise<unknown>;
  /** Service fallback: retries an applied document's staging cleanup. */
  applied?(target: ReleaseTarget): Promise<unknown>;
};
export type ReleaseResult = {kind: 'released' | 'remove_pending' | 'attached'; reason?: string};
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseReleaseRequest(input: unknown): {companyId: string; attachmentId: string} | null {
  const data = record(input);
  if (!data || Object.keys(data).length !== 2) return null;
  const {companyId, attachmentId} = data;
  return typeof companyId === 'string' && uuid.test(companyId) && typeof attachmentId === 'string' && uuid.test(attachmentId) ? {companyId, attachmentId} : null;
}

export async function releaseStagingObject(target: ReleaseTarget, deps: ReleaseDeps): Promise<ReleaseResult> {
  let requested = record(await deps.request(target));
  if (requested?.kind === 'attached') {
    if (!deps.applied) return {kind: 'attached'};
    requested = record(await deps.applied(target));
  }
  const reason = typeof requested?.reason === 'string' ? requested.reason : undefined;
  if (requested?.kind === 'released') return {kind: 'released', reason};
  if (requested?.kind !== 'remove' || typeof requested.path !== 'string') throw new Error('Release request was not recognized.');
  await deps.remove(requested.path);
  const confirmed = record(await deps.confirm(target));
  return {kind: confirmed?.kind === 'released' ? 'released' : 'remove_pending', reason};
}
