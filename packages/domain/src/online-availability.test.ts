import {afterEach,describe,expect,it,vi} from 'vitest';
import {createAvailabilityController,createOnlineAvailabilityWrite,type OnlineAvailabilityRequest} from './online-availability';
import type {AccountRpcTransport} from './online-write';
const actorId='20000000-0000-4000-8000-000000000001',target='20000000-0000-4000-8000-000000000002',other='20000000-0000-4000-8000-000000000003',companyId='10000000-0000-4000-8000-000000000001',date='2026-01-01T00:00:00Z';const scope={actorId,companyId};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
function fixture(){
  let n=0;const id=()=>`40000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
  const server={statuses:{} as Record<string,boolean>,receipts:new Map<string,unknown>()};
  function apply(request:OnlineAvailabilityRequest){
    const previous=server.receipts.get(request.requestId);if(previous)return previous;
    const current=server.statuses[request.userId]??null;const kept=current!==request.base&&current!==request.available;
    if(!kept)server.statuses[request.userId]=request.available;
    const result={...scope,userId:request.userId,requestId:request.requestId,receivedAt:date,kind:kept?'kept_current':'applied',available:kept?current:request.available};server.receipts.set(request.requestId,result);return result;
  }
  const invoke=vi.fn<AccountRpcTransport['invoke']>(async(name,args)=>name==='get_crew_availability'?{...scope,statuses:{...server.statuses}}:apply(args.request as OnlineAvailabilityRequest));
  const options={scope,id,transport:{invoke},now:()=>date,connectivity:()=> 'online' as const};
  return {server,apply,invoke,options,controller:createAvailabilityController(options)};
}
afterEach(()=>vi.useRealTimers());
describe('online availability request proofs',()=>{
  it('freezes target/base/provenance, serializes only explicit choice and returns current roster rather than historical receipt',async()=>{
    const f=fixture();const choice={userId:target,available:true,base:null};const write=createOnlineAvailabilityWrite(f.options,choice);choice.available=false;
    const value=await write.run(()=>true);expect(write.request.available).toBe(true);expect(value.snapshot.statuses[target]).toBe(true);expect(Object.isFrozen(write.request)).toBe(true);
    f.server.statuses[target]=false;expect((await write.run(()=>true)).snapshot.statuses[target]).toBe(false);expect(f.invoke.mock.calls.filter(call=>call[0]==='set_crew_availability_once')).toHaveLength(1);
  });
  it.each([{actorId:other},{companyId:other},{userId:other},{requestId:other},{available:'true'},{kind:'unknown'},{receivedAt:'yesterday'},{kind:'applied',available:false},{kind:'kept_current',available:true}])('rejects foreign or contradictory acknowledgments %j',async altered=>{
    const f=fixture();const write=createOnlineAvailabilityWrite(f.options,{userId:target,available:true,base:null});f.invoke.mockResolvedValueOnce({...f.apply(write.request) as object,...altered});await expect(write.run(()=>true)).rejects.toThrow();expect(write.acknowledged).toBe(false);expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed choices and roster values instead of inventing false/unset statuses',async()=>{
    const f=fixture();expect(()=>createOnlineAvailabilityWrite(f.options,{userId:target,available:true,base:undefined as never})).toThrow();
    f.invoke.mockResolvedValueOnce({...scope,statuses:{[target]:'false'}});expect(await f.controller.load(()=>true)).toBe(false);expect(f.controller.getSnapshot().verified).toBe(false);
  });
  it('times out without a replacement nonce or accepting a late proof',async()=>{
    vi.useFakeTimers();const f=fixture();const late=deferred<unknown>();const write=createOnlineAvailabilityWrite({...f.options,timeoutMs:1000},{userId:target,available:true,base:null});f.invoke.mockReturnValueOnce(late.promise);
    const result=write.run(()=>true);const rejected=expect(result).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(1000);await rejected;late.resolve(f.apply(write.request));await Promise.resolve();expect(write.acknowledged).toBe(false);await write.run(()=>true);expect(f.invoke.mock.calls[1][1]).toBe(f.invoke.mock.calls[0][1]);
  });
});
describe('shared actor/company availability controller',()=>{
  it('does not use missing/unverified cached rows as online mutation bases',async()=>{
    const f=fixture();expect(await f.controller.save(target,true,()=>true)).toBe(false);f.controller.showCached({[target]:false},()=>true);expect(await f.controller.save(target,true,()=>true)).toBe(false);expect(f.invoke).not.toHaveBeenCalled();
    await f.controller.load(()=>true);await f.controller.save(target,true,()=>true);expect((f.invoke.mock.calls[1][1].request as OnlineAvailabilityRequest).base).toBe(null);
  });
  it('captures the displayed base, keeps stale overlapping changes and never automatically resubmits them',async()=>{
    const f=fixture();f.server.statuses[target]=true;await f.controller.load(()=>true);f.server.statuses[target]=false;await f.controller.save(target,true,()=>true);
    expect(f.controller.getSnapshot().statuses[target]).toBe(false);expect(f.controller.getSnapshot().note).toContain('Another change was kept');expect(f.controller.getSnapshot().pending).toBe(null);await f.controller.load(()=>true);expect(f.invoke.mock.calls.filter(call=>call[0]==='set_crew_availability_once')).toHaveLength(1);
    await f.controller.save(target,true,()=>true);expect(f.controller.getSnapshot().statuses[target]).toBe(true);
  });
  it('retains original request after lost response; new choices cannot replace it and retry cannot overwrite later changes',async()=>{
    const f=fixture();await f.controller.load(()=>true);f.invoke.mockImplementationOnce(async(_name,args)=>{f.apply(args.request as OnlineAvailabilityRequest);throw new Error('Reply lost')});await f.controller.save(target,true,()=>true);
    const original=f.controller.getSnapshot().pending!;expect(await f.controller.save(other,false,()=>true)).toBe(false);f.server.statuses[target]=false;await f.controller.retry(()=>true);
    expect(f.invoke.mock.calls[2][1].request).toBe(original.request);expect(f.controller.getSnapshot().statuses[target]).toBe(false);expect(f.controller.getSnapshot().pending).toBe(null);
  });
  it('keeps known proof across failed canonical reads and performs only reads on retry',async()=>{
    const f=fixture();await f.controller.load(()=>true);f.invoke.mockImplementationOnce(async(_name,args)=>f.apply(args.request as OnlineAvailabilityRequest)).mockRejectedValueOnce(new Error('Read lost'));await f.controller.save(target,true,()=>true);
    expect(f.controller.getSnapshot().pending?.acknowledged).toBe(true);f.server.statuses[other]=false;await f.controller.retry(()=>true);expect(f.controller.getSnapshot().statuses[other]).toBe(false);expect(f.invoke.mock.calls.filter(call=>call[0]==='set_crew_availability_once')).toHaveLength(1);
  });
  it('rejects older reads and cannot restore denied data from a late response or read cache',async()=>{
    const f=fixture();const old=deferred<unknown>();f.invoke.mockReturnValueOnce(old.promise);const reading=f.controller.load(()=>true);f.invoke.mockRejectedValueOnce({code:'42501'});await f.controller.load(()=>true);old.resolve({...scope,statuses:{[target]:true}});await reading;f.controller.showCached({[target]:true},()=>true);
    expect(f.controller.getSnapshot().statuses).toEqual({});expect(f.controller.getSnapshot().verified).toBe(false);expect(f.controller.accessDenied).toBe(true);
    await f.controller.load(()=>true);expect(f.controller.accessDenied).toBe(false);
  });
  it('fences old owners across scope replacement and cannot let their finally clear the replacement retry',async()=>{
    const f=fixture();await f.controller.load(()=>true);const late=deferred<unknown>();f.invoke.mockReturnValueOnce(late.promise);let current=true;const old=f.controller.save(target,true,()=>current);const request=f.controller.getSnapshot().pending!.request;current=false;
    await f.controller.retry(()=>true);late.resolve(f.apply(request));await old;expect(f.controller.getSnapshot().pending).toBe(null);expect(f.controller.getSnapshot().busy).toBe(false);expect(f.controller.getSnapshot().statuses[target]).toBe(true);
  });
  it('invalidates permission-denied writes without fabricating a canonical empty roster',async()=>{
    const f=fixture();f.server.statuses[target]=true;await f.controller.load(()=>true);f.invoke.mockRejectedValueOnce({code:'42501'});await f.controller.save(target,false,()=>true);expect(f.controller.getSnapshot().verified).toBe(false);expect(f.controller.getSnapshot().pending).not.toBe(null);expect(f.controller.getSnapshot().error).toContain('permissions');
  });
});
