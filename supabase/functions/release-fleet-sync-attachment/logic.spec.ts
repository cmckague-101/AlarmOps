import {describe,expect,it,vi} from 'vitest';
import {parseReleaseRequest,releaseStagingObject,type ReleaseDeps} from './logic.ts';
const target={companyId:'c',userId:'u',attachmentId:'a'};
const deps=(overrides:Partial<ReleaseDeps>={}):ReleaseDeps=>({request:vi.fn().mockResolvedValue({kind:'remove',reason:'user_released',path:'c/u/a'}),remove:vi.fn().mockResolvedValue(undefined),confirm:vi.fn().mockResolvedValue({kind:'released'}),...overrides});
describe('staging object release',()=>{
  it('accepts only exact company/attachment UUID bodies',()=>{
    const ok={companyId:'10000000-0000-4000-8000-000000000001',attachmentId:'40000000-0000-4000-8000-000000000001'};expect(parseReleaseRequest(ok)).toEqual(ok);
    for(const value of [null,{...ok,userId:'x'},{companyId:'c',attachmentId:'a'}])expect(parseReleaseRequest(value)).toBeNull();
  });
  it('removes the requested staging object before confirming',async()=>{
    const d=deps();expect(await releaseStagingObject(target,d)).toEqual({kind:'released',reason:'user_released'});expect(d.remove).toHaveBeenCalledWith('c/u/a');expect(d.confirm).toHaveBeenCalledWith(target);
  });
  it('never removes attached or already-released files and reports pending removal truthfully',async()=>{
    for(const kind of ['attached','released']){const d=deps({request:vi.fn().mockResolvedValue({kind})});expect((await releaseStagingObject(target,d)).kind).toBe(kind);expect(d.remove).not.toHaveBeenCalled()}
    expect((await releaseStagingObject(target,deps({confirm:vi.fn().mockResolvedValue({kind:'remove_pending'})}))).kind).toBe('remove_pending');
    await expect(releaseStagingObject(target,deps({request:vi.fn().mockResolvedValue({kind:'odd'})}))).rejects.toThrow();
    const failing=deps({remove:vi.fn().mockRejectedValue(new Error('storage down'))});await expect(releaseStagingObject(target,failing)).rejects.toThrow('storage down');expect(failing.confirm).not.toHaveBeenCalled();
  });
  it('retries applied staging cleanup through the service path only after the user request says attached',async()=>{
    const applied=vi.fn().mockResolvedValue({kind:'remove',reason:'applied',path:'c/u/a'});const d=deps({request:vi.fn().mockResolvedValue({kind:'attached'}),applied});
    expect(await releaseStagingObject(target,d)).toEqual({kind:'released',reason:'applied'});expect(applied).toHaveBeenCalledWith(target);expect(d.remove).toHaveBeenCalledWith('c/u/a');
    const unreleased=deps();await releaseStagingObject(target,{...unreleased,applied});expect(applied).toHaveBeenCalledOnce();
  });
});
