import {copyVerifiedBytes, plan, type AttachDeps, type AttachResult} from '../attach-fleet-sync-document/logic.ts';
import {releaseStagingObject, type ReleaseDeps} from '../release-fleet-sync-attachment/logic.ts';

// Prepares the proven fleet-files copy a vehicle file slot may reference. The
// slot itself changes only through the verified detail-update RPC afterwards.
export type CopyDeps = Pick<AttachDeps, 'open' | 'put' | 'authorizeRemoval' | 'remove' | 'sha256' | 'recordCopy'> & {
  begin(companyId: string, attachmentId: string): Promise<unknown>;
  release: ReleaseDeps;
};
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function prepareSlotCopy(input: {companyId: string; userId: string; attachmentId: string}, deps: CopyDeps): Promise<AttachResult> {
  let started = record(await deps.begin(input.companyId, input.attachmentId));
  if (started?.kind === 'copy') {
    const copy = plan(started);
    if (!copy) return {status: 502, body: {error: 'File copy could not start.'}};
    const failed = await copyVerifiedBytes(copy, input, deps);
    if (failed) return failed;
    started = record(await deps.begin(input.companyId, input.attachmentId));
  }
  if (started?.kind !== 'ready' || !record(started.value)) return {status: 502, body: {error: 'File copy result was not recognized.'}};
  // The proven fleet-files copy is canonical; staging cleanup never fails the result.
  let stagingReleased = false;
  try { stagingReleased = (await releaseStagingObject(input, deps.release)).kind === 'released'; } catch { stagingReleased = false; }
  return {status: 200, body: {kind: 'ready', value: started.value, stagingReleased}};
}
