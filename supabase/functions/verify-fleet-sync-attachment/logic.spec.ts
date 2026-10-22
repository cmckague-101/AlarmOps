import {describe,expect,it,vi} from 'vitest';
import {parseVerificationRequest,readBounded,verifyAttachmentUpload,type VerifierDeps} from './logic.ts';
const lease={kind:'lease',leaseToken:'60000000-0000-4000-8000-000000000001',path:'c/u/a',byteSize:3,sha256:'a'.repeat(64),objectId:'50000000-0000-4000-8000-000000000001'};
const stream=(...chunks:number[][])=>new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close()}});
function deps(overrides:Partial<VerifierDeps>={}):VerifierDeps{
  return {begin:vi.fn().mockResolvedValue(lease),open:vi.fn().mockResolvedValue(stream([1,2],[3])),sha256:vi.fn().mockResolvedValue('a'.repeat(64)),
    complete:vi.fn().mockResolvedValue({kind:'verified',reservation:{receipt:{}}}),remove:vi.fn().mockResolvedValue(undefined),release:vi.fn().mockResolvedValue({kind:'released'}),...overrides};
}
const request={companyId:'10000000-0000-4000-8000-000000000001',attachmentId:'40000000-0000-4000-8000-000000000001'};
describe('trusted attachment verifier',()=>{
  it('accepts only exact company/attachment UUID requests',()=>{
    expect(parseVerificationRequest(request)).toEqual(request);
    for(const value of [null,[],{...request,sha256:'a'},{companyId:request.companyId},{...request,attachmentId:'../x'}])expect(parseVerificationRequest(value)).toBeNull();
  });
  it('hashes the bytes it read itself and reports the stored object it leased',async()=>{
    const d=deps();const result=await verifyAttachmentUpload(request,d);
    expect(result.status).toBe(200);expect(d.sha256).toHaveBeenCalledWith(new Uint8Array([1,2,3]));expect(d.complete).toHaveBeenCalledWith(lease.leaseToken,lease.objectId,3,'a'.repeat(64));expect(d.remove).not.toHaveBeenCalled();
  });
  it('returns existing receipts or unuploaded state without reading storage',async()=>{
    for(const kind of ['verified','not_uploaded']){const d=deps({begin:vi.fn().mockResolvedValue({kind,reservation:{path:'p'}})});expect(await verifyAttachmentUpload(request,d)).toEqual({status:200,body:{kind,reservation:{path:'p'}}});expect(d.open).not.toHaveBeenCalled()}
  });
  it('stops reading oversized objects and never hashes them',async()=>{
    const d=deps({open:vi.fn().mockResolvedValue(stream([1,2],[3,4])),complete:vi.fn().mockResolvedValue({kind:'mismatch'})});
    const result=await verifyAttachmentUpload(request,d);expect(d.sha256).not.toHaveBeenCalled();expect(d.complete).toHaveBeenCalledWith(lease.leaseToken,lease.objectId,4,null);
    expect(result.status).toBe(409);expect(d.remove).toHaveBeenCalledWith('c/u/a');expect(d.release).toHaveBeenCalledWith(lease.leaseToken,true);
  });
  it('records failed removal instead of claiming the mismatched object was cleaned up',async()=>{
    const d=deps({complete:vi.fn().mockResolvedValue({kind:'mismatch'}),remove:vi.fn().mockRejectedValue(new Error('down'))});
    expect((await verifyAttachmentUpload(request,d)).body.objectRemoved).toBe(false);expect(d.release).toHaveBeenCalledWith(lease.leaseToken,false);
  });
  it('reports missing objects, revoked access and unknown results without a receipt',async()=>{
    const missing=deps({open:vi.fn().mockResolvedValue(null),complete:vi.fn().mockResolvedValue({kind:'missing'})});expect((await verifyAttachmentUpload(request,missing)).status).toBe(409);expect(missing.complete).toHaveBeenCalledWith(lease.leaseToken,'00000000-0000-0000-0000-000000000000',null,null);
    expect((await verifyAttachmentUpload(request,deps({complete:vi.fn().mockResolvedValue({kind:'access_revoked'})}))).status).toBe(403);
    expect((await verifyAttachmentUpload(request,deps({complete:vi.fn().mockResolvedValue({kind:'surprise'})}))).status).toBe(502);
    expect((await verifyAttachmentUpload(request,deps({begin:vi.fn().mockResolvedValue({kind:'lease'})}))).status).toBe(502);
  });
  it('bounded reads return exact bytes within the limit',async()=>{
    expect(await readBounded(stream([1],[2,3]),3)).toEqual(new Uint8Array([1,2,3]));expect(await readBounded(stream([1,2,3,4]),3)).toBeNull();
  });
});
