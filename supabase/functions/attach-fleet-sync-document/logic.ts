import {readBounded} from '../verify-fleet-sync-attachment/logic.ts';
import {releaseStagingObject,type ReleaseDeps} from '../release-fleet-sync-attachment/logic.ts';

// Copies receipt-verified sync bytes into the legacy fleet-files bucket, proves
// the copy by hashing what is stored there, then completes the record mutation
// with the uploader's own JWT. The client never supplies observed bytes.
export type AttachCopyPlan = {kind: 'copy'; sourcePath: string; destinationPath: string; byteSize: number; sha256: string; contentType: string};
export type AttachDeps = {
  begin(request: unknown): Promise<unknown>;
  complete(request: unknown): Promise<unknown>;
  open(bucket: 'fleet-sync-files' | 'fleet-files', path: string): Promise<ReadableStream<Uint8Array> | null>;
  put(path: string, bytes: Uint8Array, contentType: string): Promise<'stored' | 'exists'>;
  /** Service check taken immediately before removing a mismatched copy. */
  authorizeRemoval(request: {companyId: string; userId: string; attachmentId: string}): Promise<unknown>;
  remove(path: string): Promise<void>;
  sha256(bytes: Uint8Array): Promise<string>;
  recordCopy(request: {companyId: string; userId: string; attachmentId: string}, size: number | null, digest: string | null): Promise<unknown>;
  /** Service-side release of an applied document's staging object. */
  release: ReleaseDeps;
};
export type AttachResult = {status: number; body: Record<string, unknown>};
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseAttachRequest(input: unknown): {companyId: string; userId: string; attachmentId: string; request: Record<string, unknown>} | null {
  const data = record(input);
  const provenance = record(data?.provenance);
  // Full validation happens in SQL; only identity needed for the copy proof.
  if (!data || typeof data.companyId !== 'string' || typeof data.attachmentId !== 'string' || typeof provenance?.userId !== 'string') return null;
  return {companyId: data.companyId, userId: provenance.userId, attachmentId: data.attachmentId, request: data};
}

export function plan(value: unknown): AttachCopyPlan | null {
  const data = record(value);
  return data?.kind === 'copy' && typeof data.sourcePath === 'string' && typeof data.destinationPath === 'string'
    && Number.isSafeInteger(data.byteSize) && typeof data.sha256 === 'string' && typeof data.contentType === 'string' ? data as AttachCopyPlan : null;
}

async function observe(deps: Pick<AttachDeps, 'open' | 'sha256'>, bucket: 'fleet-sync-files' | 'fleet-files', path: string, limit: number) {
  const stream = await deps.open(bucket, path);
  if (!stream) return null;
  const bytes = await readBounded(stream, limit);
  return bytes ? {bytes, size: bytes.byteLength, digest: await deps.sha256(bytes)} : {bytes: null, size: limit + 1, digest: null};
}

/** Copies receipt-verified bytes into fleet-files and records the hash proof. Null means ready. */
export async function copyVerifiedBytes(copy: AttachCopyPlan, input: {companyId: string; userId: string; attachmentId: string}, deps: Pick<AttachDeps, 'open' | 'put' | 'authorizeRemoval' | 'remove' | 'sha256' | 'recordCopy'>): Promise<AttachResult | null> {
  const source = await observe(deps, 'fleet-sync-files', copy.sourcePath, copy.byteSize);
  if (!source?.bytes || source.digest !== copy.sha256) return {status: 409, body: {kind: 'source_unavailable', error: 'Verified upload bytes are unavailable. Verify the upload again.'}};
  let observed: {size: number; digest: string | null} = source;
  if (await deps.put(copy.destinationPath, source.bytes, copy.contentType) === 'exists') {
    observed = await observe(deps, 'fleet-files', copy.destinationPath, copy.byteSize) ?? {size: 0, digest: null};
  }
  const proof = record(await deps.recordCopy(input, observed.size, observed.digest));
  if (proof?.kind === 'mismatch') {
    // Deterministic sync path: never a user's ordinary document. Removal is
    // path-only, so it is skipped once any copy of this upload is proven.
    const allowed = record(await deps.authorizeRemoval(input));
    if (allowed?.kind === 'remove' && allowed.path === copy.destinationPath) await deps.remove(copy.destinationPath);
    return {status: 409, body: {kind: 'copy_mismatch', error: 'File copy did not match the verified bytes. Retry.'}};
  }
  if (proof?.kind === 'access_revoked') return {status: 403, body: {kind: 'access_revoked', error: 'Company manager access required.'}};
  if (proof?.kind !== 'ready') return {status: 409, body: {kind: 'copy_missing', error: 'File copy is not available yet. Retry.'}};
  return null;
}

// Applied documents no longer need the staging copy. Cleanup failure never
// changes the business result; a later replay retries it.
async function completed(input: NonNullable<ReturnType<typeof parseAttachRequest>>, deps: AttachDeps, result: unknown): Promise<AttachResult> {
  let stagingReleased = false;
  if (record(result)?.kind === 'applied') {
    try { stagingReleased = (await releaseStagingObject(input, deps.release)).kind === 'released'; } catch { stagingReleased = false; }
  }
  return {status: 200, body: {kind: 'completed', result, stagingReleased}};
}

export async function attachFleetSyncDocument(input: NonNullable<ReturnType<typeof parseAttachRequest>>, deps: AttachDeps): Promise<AttachResult> {
  const started = record(await deps.begin(input.request));
  if (started?.kind === 'completed') return completed(input, deps, started.result);
  if (started?.kind !== 'ready') {
    const copy = plan(started);
    if (!copy) return {status: 502, body: {error: 'Attachment could not start.'}};
    const failed = await copyVerifiedBytes(copy, input, deps);
    if (failed) return failed;
  }
  const result = record(await deps.complete(input.request));
  if (!result || (result.kind !== 'applied' && result.kind !== 'rejected')) return {status: 502, body: {error: 'Attachment result was not recognized.'}};
  return completed(input, deps, result);
}
