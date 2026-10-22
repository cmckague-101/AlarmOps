import {describe,expect,it,vi} from 'vitest';
import {prepareSlotCopy,type CopyDeps} from './logic.ts';
const input={companyId:'c',userId:'u',attachmentId:'a'};
const plan={kind:'copy',sourcePath:'c/u/a',destinationPath:'c/u/sync-a',byteSize:3,sha256:'a'.repeat(64),contentType:'image/jpeg'};
const value={name:'Front.jpg',type:'image/jpeg',dataUrl:'',path:'c/u/sync-a'};
const stream=(...chunks:number[][])=>new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close()}});
function deps(overrides:Partial<CopyDeps>={}):CopyDeps{
  return {begin:vi.fn().mockResolvedValueOnce(plan).mockResolvedValue({kind:'ready',value}),open:vi.fn(async()=>stream([1,2,3])),put:vi.fn().mockResolvedValue('stored'),remove:vi.fn().mockResolvedValue(undefined),
    sha256:vi.fn().mockResolvedValue('a'.repeat(64)),recordCopy:vi.fn().mockResolvedValue({kind:'ready'}),
    release:{request:vi.fn().mockResolvedValue({kind:'remove',reason:'copied',path:'c/u/a'}),remove:vi.fn().mockResolvedValue(undefined),confirm:vi.fn().mockResolvedValue({kind:'released'})},...overrides};
}
describe('vehicle file slot copy preparation',()=>{
  it('copies verified bytes, proves them, returns the server-built slot value and releases staging',async()=>{
    const d=deps();expect(await prepareSlotCopy(input,d)).toEqual({status:200,body:{kind:'ready',value,stagingReleased:true}});
    expect(d.put).toHaveBeenCalledWith('c/u/sync-a',new Uint8Array([1,2,3]),'image/jpeg');expect(d.recordCopy).toHaveBeenCalledWith(input,3,'a'.repeat(64));expect(d.release.remove).toHaveBeenCalledWith('c/u/a');
  });
  it('returns an already-proven copy without copying again',async()=>{
    const d=deps({begin:vi.fn().mockResolvedValue({kind:'ready',value})});expect((await prepareSlotCopy(input,d)).body.value).toEqual(value);expect(d.open).not.toHaveBeenCalled();
  });
  it('stops on mismatched copies and keeps results when staging cleanup fails',async()=>{
    const mismatch=deps({recordCopy:vi.fn().mockResolvedValue({kind:'mismatch'})});expect((await prepareSlotCopy(input,mismatch)).status).toBe(409);expect(mismatch.remove).toHaveBeenCalledWith('c/u/sync-a');expect(mismatch.release.request).not.toHaveBeenCalled();
    const cleanup=deps();cleanup.release.remove=vi.fn().mockRejectedValue(new Error('down'));expect((await prepareSlotCopy(input,cleanup)).body).toMatchObject({kind:'ready',stagingReleased:false});
    expect((await prepareSlotCopy(input,deps({begin:vi.fn().mockResolvedValue({kind:'odd'})}))).status).toBe(502);
  });
});
