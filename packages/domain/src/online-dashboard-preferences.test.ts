import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDashboardPreferenceTransport,createOnlineDashboardWrite,decodeDashboardPreferenceChanges,type DashboardPreferenceTransport,type OnlineDashboardRequest} from './online-dashboard-preferences';
const user='20000000-0000-4000-8000-000000000001',id='40000000-0000-4000-8000-000000000001',date='2026-01-01T12:00:00.000Z';
function receipt(request:OnlineDashboardRequest,items:Record<string,unknown>={tasks:false}){return {kind:'applied',requestId:request.requestId,userId:user,receivedAt:date,items}}
function setup(changes:Record<string,boolean|null>={tasks:false}){
  const invoke=vi.fn<DashboardPreferenceTransport['invoke']>(async(name,args)=>name==='get_dashboard_preferences'?{userId:user,items:{tasks:false}}:receipt(args.request as OnlineDashboardRequest));
  const write=createOnlineDashboardWrite({userId:user,id:()=>id,now:()=>date,connectivity:()=> 'online',transport:{invoke},timeoutMs:1000},changes);
  return {write,invoke};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
afterEach(()=>{vi.useRealTimers()});
describe('memory-only online dashboard writes',()=>{
  it('rejects empty, unknown, non-boolean and non-JSON changes before issuing a request',()=>{
    for(const value of [{},{unknown:false},{tasks:{}},{tasks:'false'},{tasks:undefined},[],null])expect(()=>decodeDashboardPreferenceChanges(value)).toThrow();
    expect(decodeDashboardPreferenceChanges({tasks:null,greeting:true})).toEqual({tasks:null,greeting:true});
  });
  it('freezes original input and provenance before asynchronous delivery and reads current data after acknowledgment',async()=>{
    const input={tasks:false};const f=setup(input);input.tasks=true;
    f.invoke.mockResolvedValueOnce(receipt(f.write.request)).mockResolvedValueOnce({userId:user,items:{tasks:true,resources:false}});
    expect(await f.write.run(()=>true)).toEqual({tasks:true,resources:false});expect(f.write.request.changes).toEqual({tasks:false});expect(Object.isFrozen(f.write.request)).toBe(true);expect(Object.isFrozen(f.write.request.changes)).toBe(true);expect(f.write.acknowledged).toBe(true);
  });
  it('coalesces simultaneous retries and rejects a stale caller rather than sharing its result',async()=>{
    const f=setup();const waiting=deferred<unknown>();f.invoke.mockReturnValueOnce(waiting.promise);const first=f.write.run(()=>true);expect(f.write.run(()=>true)).toBe(first);
    await expect(f.write.run(()=>false)).rejects.toThrow('account');waiting.resolve(receipt(f.write.request));await first;expect(f.invoke).toHaveBeenCalledTimes(2);
  });
  it('retries uncertain mutation using the same nonce/body/time with no endpoint fallback',async()=>{
    const f=setup();f.invoke.mockRejectedValueOnce(new Error('Response lost'));await expect(f.write.run(()=>true)).rejects.toThrow('lost');expect(f.write.acknowledged).toBe(false);
    await f.write.run(()=>true);expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['set_dashboard_preferences_once','set_dashboard_preferences_once','get_dashboard_preferences']);expect(f.invoke.mock.calls[1][1]).toBe(f.invoke.mock.calls[0][1]);
  });
  it('retries only canonical read after a valid acknowledgment, never repeating completed work',async()=>{
    const f=setup();f.invoke.mockResolvedValueOnce(receipt(f.write.request)).mockRejectedValueOnce(new Error('Read lost'));
    await expect(f.write.run(()=>true)).rejects.toThrow('Read lost');expect(f.write.acknowledged).toBe(true);await f.write.run(()=>true);expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['set_dashboard_preferences_once','get_dashboard_preferences','get_dashboard_preferences']);
  });
  it.each([{userId:'wrong'},{requestId:'wrong'},{kind:'unknown'},{receivedAt:'bad'},{items:{tasks:true}},{items:{}}])('does not promote malformed or foreign acknowledgment %j',async altered=>{
    const f=setup();f.invoke.mockResolvedValueOnce({...receipt(f.write.request),...altered});await expect(f.write.run(()=>true)).rejects.toThrow();expect(f.write.acknowledged).toBe(false);expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('validates explicit removal proof, preserves unknown stored fields without exposing them',async()=>{
    const f=setup({tasks:null});f.invoke.mockResolvedValueOnce(receipt(f.write.request,{legacy:{retained:true}})).mockResolvedValueOnce({userId:user,items:{legacy:{retained:true},resources:false}});
    expect(await f.write.run(()=>true)).toEqual({resources:false});
  });
  it('ignores late results after scope loss and allows explicit same-user retry from a new scope',async()=>{
    const f=setup();const waiting=deferred<unknown>();let current=true;f.invoke.mockReturnValueOnce(waiting.promise);const old=f.write.run(()=>current);const failed=expect(old).rejects.toThrow('account');current=false;
    const next=f.write.run(()=>true);await failed;waiting.resolve(receipt(f.write.request));expect(await next).toEqual({tasks:false});expect(f.write.acknowledged).toBe(true);
  });
  it('times out without replacing the request or accepting a late acknowledgment',async()=>{
    vi.useFakeTimers();const f=setup();const waiting=deferred<unknown>();f.invoke.mockReturnValueOnce(waiting.promise);const result=f.write.run(()=>true);const failed=expect(result).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(1000);await failed;waiting.resolve(receipt(f.write.request));await Promise.resolve();expect(f.write.acknowledged).toBe(false);await f.write.run(()=>true);expect(f.invoke.mock.calls[1][1]).toEqual(f.invoke.mock.calls[0][1]);
  });
});
describe('account-bound dashboard POST transport',()=>{
  it('binds the expected bearer token, never sends after identity/scope/connectivity changes',async()=>{
    const rpc={setHeader:vi.fn().mockReturnThis(),abortSignal:vi.fn().mockResolvedValue({data:{},error:null})};
    const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:user},access_token:'bound'}},error:null})},rpc:vi.fn(()=>rpc)};
    let online=true;let current=true;const transport=createDashboardPreferenceTransport(client,user,()=>online);const signal=new AbortController().signal;
    await transport.invoke('get_dashboard_preferences',{},signal,()=>current);expect(rpc.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound');client.rpc.mockClear();
    client.auth.getSession.mockImplementation(async()=>{current=false;return {data:{session:{user:{id:user},access_token:'bound'}},error:null}});await expect(transport.invoke('get_dashboard_preferences',{},signal,()=>current)).rejects.toThrow('account');expect(client.rpc).not.toHaveBeenCalled();
    current=true;online=false;await expect(transport.invoke('get_dashboard_preferences',{},signal,()=>current)).rejects.toThrow('connection');expect(client.rpc).not.toHaveBeenCalled();
    online=true;client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'wrong'}},error:null});await expect(transport.invoke('get_dashboard_preferences',{},signal,()=>current)).rejects.toThrow('account');expect(client.rpc).not.toHaveBeenCalled();
  });
});
