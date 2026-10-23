import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {OnlineDashboardRequest} from '@fireops/domain';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',()=>runtime.hooks);
const mocks=vi.hoisted(()=>({uid:'',items:new Map<string,Record<string,boolean>>(),receipts:new Map<string,unknown>(),write:vi.fn(),read:vi.fn(),client:{from:vi.fn(),rpc:vi.fn(),auth:{getSession:vi.fn()}},headers:vi.fn()}));
vi.mock('./supabase',()=>({supabase:mocks.client}));
import {useDashboardPreferences} from './useDashboardPreferences';
let user:string;let serial=0;
const cleanup:(()=>void)[]=[];
function hook<T>(fn:()=>T){const frame=runtime.frame();const f={render(){runtime.enter(frame);return fn()},effects(){for(const index of [...frame.effects]){frame.effects.delete(index);const slot=frame.slots[index];slot.cleanup?.();slot.cleanup=slot.effect?.()??undefined}},dispose(){frame.slots.forEach(slot=>slot.cleanup?.())}};cleanup.push(f.dispose);return f}
async function flush(){for(let i=0;i<25;i++)await Promise.resolve()}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
function apply(request:OnlineDashboardRequest){
  const previous=mocks.receipts.get(request.requestId);if(previous)return {data:previous,error:null};
  const items={...mocks.items.get(request.userId)};for(const [key,value] of Object.entries(request.changes)){if(value===null)delete items[key];else items[key]=value!}
  mocks.items.set(request.userId,items);const receipt={kind:'applied',userId:request.userId,requestId:request.requestId,receivedAt:new Date().toISOString(),items:{...items}};mocks.receipts.set(request.requestId,receipt);return {data:receipt,error:null};
}
beforeEach(()=>{
  vi.clearAllMocks();user=`20000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;mocks.uid=user;mocks.items=new Map();mocks.receipts=new Map();
  mocks.client.from.mockImplementation(()=>{throw new Error('Unsafe direct table endpoint')});mocks.write.mockReset().mockImplementation(async(request)=>apply(request));mocks.read.mockReset().mockImplementation(async()=>({data:{userId:mocks.uid,items:{...mocks.items.get(mocks.uid)}},error:null}));
  mocks.client.auth.getSession.mockImplementation(async()=>({data:{session:{user:{id:mocks.uid},access_token:`token:${mocks.uid}`}},error:null}));
  mocks.client.rpc.mockImplementation((name,args)=>({setHeader:mocks.headers.mockImplementation(()=>({abortSignal:()=>name==='get_dashboard_preferences'?mocks.read():mocks.write(args.request)}))}));
});
afterEach(()=>{cleanup.splice(0).forEach(fn=>fn());vi.unstubAllGlobals()});

describe('production online-only dashboard hook and effects',()=>{
  it('sends one changed key, merges independent choices canonically and binds the actor JWT',async()=>{
    mocks.items.set(user,{tasks:false});const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();await f.render().save('greeting',false);
    expect(mocks.write.mock.calls[0][0].changes).toEqual({greeting:false});expect(f.render().visible('tasks')).toBe(false);expect(f.render().visible('greeting')).toBe(false);expect(mocks.headers).toHaveBeenCalledWith('Authorization',`Bearer token:${user}`);expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it('keeps original nonce/provenance on lost-response retry and rejects replacement choices',async()=>{
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.write.mockImplementationOnce(async(request)=>{apply(request);throw new Error('Response lost')});
    await f.render().save('greeting',false);const original=mocks.write.mock.calls[0][0];expect(f.render().retryRequired).toBe(true);await f.render().save('tasks',false);expect(mocks.write).toHaveBeenCalledTimes(1);
    mocks.items.set(user,{greeting:true,resources:false});await f.render().retry();expect(mocks.write.mock.calls[1][0]).toBe(original);expect(f.render().retryRequired).toBe(false);expect(f.render().visible('greeting')).toBe(true);expect(f.render().visible('resources')).toBe(false);
  });
  it('persists acknowledgment in memory before read failure and retries refresh only',async()=>{
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.read.mockRejectedValueOnce(new Error('Read unavailable'));await f.render().save('tasks',false);
    expect(f.render().pending?.acknowledged).toBe(true);expect(f.render().error).toContain('Saved on server');await f.render().retry();expect(mocks.write).toHaveBeenCalledTimes(1);expect(f.render().visible('tasks')).toBe(false);
  });
  it('does not silently fall back or create another request when migrations are missing',async()=>{
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.write.mockRejectedValueOnce({code:'PGRST202'});await f.render().save('tasks',false);
    expect(f.render().error).toContain('database setup');const original=mocks.write.mock.calls[0][0];f.render().reload();f.effects();await flush();expect(mocks.write).toHaveBeenCalledTimes(1);await f.render().retry();expect(mocks.write.mock.calls[1][0]).toBe(original);expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it('locks duplicate clicks synchronously before a rerender',async()=>{
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();const waiting=deferred<unknown>();mocks.write.mockReturnValueOnce(waiting.promise);const result=f.render();const saving=result.save('tasks',false);await result.save('greeting',false);await flush();expect(mocks.write).toHaveBeenCalledTimes(1);waiting.resolve(apply(mocks.write.mock.calls[0][0]));await saving;
  });
  it('fences old reads and retained callbacks on the account transition render',async()=>{
    const waiting=deferred<unknown>();mocks.read.mockReturnValueOnce(waiting.promise);let who=user;
    const f=hook(()=>useDashboardPreferences(who));const original=f.render();f.effects();await flush();who='20000000-0000-4000-8000-999999999999';mocks.uid=who;expect(f.render().items).toEqual({});await original.save('tasks',false);expect(mocks.write).not.toHaveBeenCalled();f.effects();await flush();waiting.resolve({data:{userId:user,items:{tasks:false}},error:null});await flush();expect(f.render().items).toEqual({});
  });
  it('retains uncertain work across A → B → A, with explicit retry and no old-response unlock',async()=>{
    let who=user;const waiting=deferred<unknown>();const f=hook(()=>useDashboardPreferences(who));f.render();f.effects();await flush();mocks.write.mockReturnValueOnce(waiting.promise);const old=f.render().save('tasks',false);await flush();
    who='20000000-0000-4000-8000-888888888888';mocks.uid=who;f.render();f.effects();await flush();who=user;mocks.uid=user;f.render();f.effects();await flush();expect(f.render().retryRequired).toBe(true);expect(f.render().saving).toBe(false);expect(mocks.write).toHaveBeenCalledTimes(1);
    await f.render().retry();waiting.resolve(apply(mocks.write.mock.calls[0][0]));await old;expect(f.render().retryRequired).toBe(false);expect(f.render().visible('tasks')).toBe(false);expect(mocks.write.mock.calls[1][0]).toBe(mocks.write.mock.calls[0][0]);
  });
  it('warns on page exit while unconfirmed, without storing or automatically replaying requests',async()=>{
    const browser={addEventListener:vi.fn(),removeEventListener:vi.fn()};const storage={setItem:vi.fn()};vi.stubGlobal('window',browser);vi.stubGlobal('localStorage',storage);
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.write.mockRejectedValueOnce(new Error('Network lost'));await f.render().save('tasks',false);
    const event={preventDefault:vi.fn(),returnValue:'unchanged'};const handler=browser.addEventListener.mock.calls.find(call=>call[0]==='beforeunload')![1];handler(event);expect(event.preventDefault).toHaveBeenCalled();expect(event.returnValue).toBe('');
    f.render();f.effects();await flush();expect(mocks.write).toHaveBeenCalledTimes(1);expect(storage.setItem).not.toHaveBeenCalled();await f.render().retry();
  });
});
