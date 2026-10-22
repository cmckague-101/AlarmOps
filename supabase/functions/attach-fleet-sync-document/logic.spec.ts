import {describe,expect,it,vi} from 'vitest';
import {attachFleetSyncDocument,parseAttachRequest,type AttachDeps} from './logic.ts';
const request={schemaVersion:1,requestId:'r',companyId:'c',entityType:'vehicle',entityId:'v',attachmentId:'a',documentName:'Doc',provenance:{userId:'u',deviceId:'d',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline'}};
const input=parseAttachRequest(request)!;
const copy={kind:'copy',sourcePath:'c/u/a',destinationPath:'c/u/sync-a',byteSize:3,sha256:'a'.repeat(64),contentType:'application/pdf'};
const stream=(...chunks:number[][])=>new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close()}});
const applied={kind:'applied',revision:'2',documentId:'a',path:'c/u/sync-a'};
function deps(overrides:Partial<AttachDeps>={}):AttachDeps{
  return {begin:vi.fn().mockResolvedValue(copy),complete:vi.fn().mockResolvedValue(applied),open:vi.fn(async()=>stream([1,2,3])),put:vi.fn().mockResolvedValue('stored'),remove:vi.fn().mockResolvedValue(undefined),
    sha256:vi.fn().mockResolvedValue('a'.repeat(64)),recordCopy:vi.fn().mockResolvedValue({kind:'ready'}),...overrides};
}
describe('attach verified sync bytes as a vehicle document',()=>{
  it('extracts only the identity used for service copy proof',()=>{
    expect(input).toMatchObject({companyId:'c',userId:'u',attachmentId:'a'});expect(parseAttachRequest({companyId:'c',attachmentId:'a'})).toBeNull();expect(parseAttachRequest(null)).toBeNull();
  });
  it('copies verified source bytes, proves the stored copy, then completes with the original request',async()=>{
    const d=deps();expect(await attachFleetSyncDocument(input,d)).toEqual({status:200,body:{kind:'completed',result:applied}});
    expect(d.open).toHaveBeenCalledWith('fleet-sync-files','c/u/a');expect(d.put).toHaveBeenCalledWith('c/u/sync-a',new Uint8Array([1,2,3]),'application/pdf');
    expect(d.recordCopy).toHaveBeenCalledWith(input,3,'a'.repeat(64));expect(d.complete).toHaveBeenCalledWith(request);
  });
  it('hashes an existing destination instead of trusting it',async()=>{
    const d=deps({put:vi.fn().mockResolvedValue('exists'),open:vi.fn().mockResolvedValueOnce(stream([1,2,3])).mockResolvedValueOnce(stream([9,9,9])),sha256:vi.fn().mockResolvedValueOnce('a'.repeat(64)).mockResolvedValueOnce('b'.repeat(64)),recordCopy:vi.fn().mockResolvedValue({kind:'mismatch'})});
    const result=await attachFleetSyncDocument(input,d);expect(result.status).toBe(409);expect(d.recordCopy).toHaveBeenCalledWith(input,3,'b'.repeat(64));expect(d.remove).toHaveBeenCalledWith('c/u/sync-a');expect(d.complete).not.toHaveBeenCalled();
  });
  it('refuses unavailable or changed source bytes before copying',async()=>{
    for(const open of [vi.fn().mockResolvedValue(null),vi.fn(async()=>stream([1,2,3,4]))]){const d=deps({open});expect((await attachFleetSyncDocument(input,d)).status).toBe(409);expect(d.put).not.toHaveBeenCalled()}
    const changed=deps({sha256:vi.fn().mockResolvedValue('c'.repeat(64))});expect((await attachFleetSyncDocument(input,changed)).status).toBe(409);expect(changed.put).not.toHaveBeenCalled();
  });
  it('replays completed results and resumes ready copies without copying again',async()=>{
    const done=deps({begin:vi.fn().mockResolvedValue({kind:'completed',result:applied})});expect((await attachFleetSyncDocument(input,done)).body.result).toEqual(applied);expect(done.complete).not.toHaveBeenCalled();
    const ready=deps({begin:vi.fn().mockResolvedValue({kind:'ready'})});expect((await attachFleetSyncDocument(input,ready)).status).toBe(200);expect(ready.open).not.toHaveBeenCalled();expect(ready.complete).toHaveBeenCalledOnce();
  });
  it('reports revoked access, missing copies and unknown results without completing',async()=>{
    expect((await attachFleetSyncDocument(input,deps({recordCopy:vi.fn().mockResolvedValue({kind:'access_revoked'})}))).status).toBe(403);
    const missing=deps({recordCopy:vi.fn().mockResolvedValue({kind:'missing'})});expect((await attachFleetSyncDocument(input,missing)).status).toBe(409);expect(missing.complete).not.toHaveBeenCalled();
    expect((await attachFleetSyncDocument(input,deps({complete:vi.fn().mockResolvedValue({kind:'odd'})}))).status).toBe(502);
  });
});
