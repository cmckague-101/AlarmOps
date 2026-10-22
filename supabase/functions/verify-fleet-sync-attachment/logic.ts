// Dependency-free verifier core. The Edge Function wires real Supabase clients;
// tests inject fakes. Observed size/digest always come from bytes read here.
export type VerificationLease = {kind: 'lease'; leaseToken: string; path: string; byteSize: number; sha256: string; objectId: string};
export type VerifierDeps = {
  /** Uploader-JWT RPC: rechecks their current access and takes a lease. */
  begin(companyId: string, attachmentId: string): Promise<unknown>;
  /** Service read of stored bytes; null when the object is gone. */
  open(path: string): Promise<ReadableStream<Uint8Array> | null>;
  sha256(bytes: Uint8Array): Promise<string>;
  complete(lease: string, objectId: string, size: number | null, digest: string | null): Promise<unknown>;
  remove(path: string): Promise<void>;
  release(lease: string, removed: boolean): Promise<unknown>;
};
export type VerifierResult = {status: number; body: Record<string, unknown>};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Reads at most `limit` bytes; anything longer is reported as oversized without buffering it. */
export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function parseVerificationRequest(input: unknown): {companyId: string; attachmentId: string} | null {
  const data = record(input);
  if (!data || Object.keys(data).length !== 2) return null;
  const {companyId, attachmentId} = data;
  return typeof companyId === 'string' && uuid.test(companyId) && typeof attachmentId === 'string' && uuid.test(attachmentId)
    ? {companyId, attachmentId} : null;
}

function lease(value: unknown): VerificationLease | null {
  const data = record(value);
  if (data?.kind !== 'lease' || typeof data.leaseToken !== 'string' || !uuid.test(data.leaseToken) || typeof data.path !== 'string'
    || !Number.isSafeInteger(data.byteSize) || typeof data.sha256 !== 'string' || typeof data.objectId !== 'string') return null;
  return data as VerificationLease;
}

export async function verifyAttachmentUpload(request: {companyId: string; attachmentId: string}, deps: VerifierDeps): Promise<VerifierResult> {
  const started = record(await deps.begin(request.companyId, request.attachmentId));
  if (started?.kind === 'verified' || started?.kind === 'not_uploaded') return {status: 200, body: {kind: started.kind, reservation: started.reservation}};
  const held = lease(started);
  if (!held) return {status: 502, body: {error: 'Verification could not start.'}};
  let size: number | null = null;
  let digest: string | null = null;
  let objectId = held.objectId;
  const stream = await deps.open(held.path);
  if (!stream) objectId = '00000000-0000-0000-0000-000000000000'; // records 'missing'
  else {
    // One extra byte detects oversized content without trusting metadata.
    const bytes = await readBounded(stream, held.byteSize);
    if (bytes) { size = bytes.byteLength; digest = await deps.sha256(bytes); }
    else size = held.byteSize + 1;
  }
  const completed = record(await deps.complete(held.leaseToken, objectId, size, digest));
  const kind = completed?.kind;
  if (kind === 'verified') return {status: 200, body: {kind, reservation: completed!.reservation}};
  if (kind === 'mismatch') {
    let removed = false;
    try { await deps.remove(held.path); removed = true; } catch { removed = false; }
    await deps.release(held.leaseToken, removed);
    return {status: 409, body: {kind, objectRemoved: removed, error: 'Stored bytes did not match the retained attachment. Upload the original bytes again.'}};
  }
  if (kind === 'missing' || kind === 'expired') return {status: 409, body: {kind, error: 'Stored object changed or verification expired. Check the upload again.'}};
  if (kind === 'access_revoked') return {status: 403, body: {kind, error: 'Company manager access required.'}};
  return {status: 502, body: {error: 'Verification result was not recognized.'}};
}
