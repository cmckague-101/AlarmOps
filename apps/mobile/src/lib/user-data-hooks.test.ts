import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {OutboxEntry} from './offline-outbox';

// Execute production hooks and effects with persistent hook slots. No DOM,
// native UI, server, or visual rendering. Effects flush explicitly so tests
// can inspect the account-switch render before old effects clean up.
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',()=>runtime.hooks);
const mocks=vi.hoisted(()=>({
  context:{offline:true,available:true,userSync:{scope:{userId:'',companyId:''},createTask:vi.fn(),completeTask:vi.fn(),setAvailability:vi.fn(),setDashboard:vi.fn()},state:{entries:[] as OutboxEntry[]}},
  client:{from:vi.fn(),rpc:vi.fn(),auth:{getSession:vi.fn()},channel:vi.fn(),removeChannel:vi.fn()},
  execute:vi.fn(),canonical:vi.fn(),availability:vi.fn(),onlineWrite:vi.fn(),onlineRead:vi.fn(),headers:vi.fn(),events:[] as (()=>void)[],id:0,
}));
vi.mock('./supabase',()=>({supabase:mocks.client}));
vi.mock('@/lib/supabase',()=>({supabase:mocks.client}));
vi.mock('@/providers/offline-sync-provider',()=>({useOptionalOfflineSync:()=>mocks.context}));
vi.mock('@/providers/network-provider',()=>({isOffline:()=>mocks.context.offline}));
vi.mock('./fleet-store',()=>({createFleetId:()=>`40000000-0000-4000-8000-${String(++mocks.id).padStart(12,'0')}`}));
import {usePersonalTasks} from './use-personal-tasks';
import {useAvailability} from './use-availability';
import {useDashboardPreferences} from './use-dashboard-preferences';
import {readUserSetting} from './read-user-setting';
import type {SupabaseClient} from '@supabase/supabase-js';

const company='10000000-0000-4000-8000-000000000001',otherCompany='10000000-0000-4000-8000-000000000002';
let user:string;let serial=0;const nativeSync=mocks.context.userSync;
const disposals:(()=>void)[]=[];
function hook<T>(fn:()=>T){
  const frame=runtime.frame();
  const api={render(){runtime.enter(frame);return fn()},effects(){for(const index of [...frame.effects]){frame.effects.delete(index);const value=frame.slots[index];value.cleanup?.();value.cleanup=value.effect?.()??undefined}},dispose(){for(const value of frame.slots)value.cleanup?.()}};
  disposals.push(api.dispose);return api;
}
async function flush(){for(let i=0;i<25;i++)await Promise.resolve()}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const draft={subject:'Order filters',description:'Two cases',dueDate:'2026-01-05'};
function task(subject='Task',id='task'){return {id,company_id:company,user_id:user,subject,description:'',due_date:'2026-01-05',created_at:''}}
function entry(entity:'availability'|'dashboard'|'personal_task',command:string,payload:Record<string,unknown>,status:'pending'|'synced'='pending',record:Record<string,unknown>|null=null,sequence=1):OutboxEntry{
  return {sequence,status,attempts:0,error:null,projection:null,reviewOutcome:null,noticeDismissed:false,delivery:null,
    receipt:status==='synced'?{kind:'applied',revision:String(sequence),record:record as never,receivedAt:'2026-01-01T00:00:00Z'}:null,
    operation:{schemaVersion:1,operationId:`operation-${sequence}`,companyId:company,entityType:entity,entityId:entity==='personal_task'?'task':user,dependsOn:[],provenance:{userId:user,deviceId:'phone',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline'},mutation:{kind:'command',command,payload:payload as never}}};
}
beforeEach(()=>{
  vi.clearAllMocks();user=`20000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
  mocks.context.userSync=nativeSync;mocks.context.offline=true;mocks.context.available=true;mocks.context.state.entries=[];mocks.events=[];
  mocks.context.userSync.scope={userId:user,companyId:company};
  for(const method of ['createTask','completeTask','setAvailability','setDashboard'] as const)mocks.context.userSync[method].mockReset().mockResolvedValue({});
  mocks.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'bound-token'}},error:null});
  mocks.execute.mockReset().mockImplementation(async({table})=>({data:table==='dashboard_preferences'?{items:{}}:[],error:null}));
  mocks.canonical.mockReset().mockImplementation(async(args)=>({data:{revision:'100',record:{id:args.record_id,...(args.entity_type==='dashboard'?{items:{}}:{available:false})}},error:null}));
  mocks.onlineWrite.mockReset().mockImplementation(async(request)=>({data:{kind:'applied',requestId:request.requestId,userId:user,items:request.changes,receivedAt:'2026-01-01T00:00:00Z'},error:null}));
  mocks.availability.mockReset().mockImplementation(async(_name,args)=>({data:{actorId:user,companyId:args.target_company_id,statuses:{}},error:null}));
  mocks.onlineRead.mockReset().mockResolvedValue({data:{userId:user,items:{}},error:null});
  mocks.client.rpc.mockImplementation((name,args)=>({setHeader:mocks.headers.mockImplementation(()=>({abortSignal:()=>name==='get_dashboard_preferences'?mocks.onlineRead():name==='set_dashboard_preferences_once'?mocks.onlineWrite(args.request):name.includes('crew_availability')?mocks.availability(name,args):mocks.canonical(args)}))}));
  mocks.client.from.mockImplementation(table=>{
    const request={table,action:'read',data:undefined as unknown,filters:[] as unknown[]};
    const query={select(){return query},eq(...values:unknown[]){request.filters.push(values);return query},order(){return query},maybeSingle(){return query},
      insert(data:unknown){request.action='insert';request.data=data;return query},delete(){request.action='delete';return query},upsert(data:unknown){request.action='upsert';request.data=data;return query},setHeader(...args:unknown[]){mocks.headers(...args);return query},
      then(yes:(result:unknown)=>unknown,no:(error:unknown)=>unknown){return Promise.resolve().then(()=>mocks.execute(request)).then(yes,no)}};
    return query;
  });
  mocks.client.channel.mockImplementation(()=>{const channel={on(_event:unknown,_filter:unknown,callback:()=>void){mocks.events.push(callback);return channel},subscribe(){return channel}};return channel});
});
afterEach(()=>{for(const dispose of disposals.splice(0))dispose()});

describe('scoped personal-task hooks',()=>{
  it('hides old account data before effect cleanup and refuses retained old handlers',async()=>{
    mocks.execute.mockResolvedValue({data:[task('Private task')],error:null});let who=user;
    const f=hook(()=>usePersonalTasks(company,who));let result=f.render();f.effects();await flush();result=f.render();expect(result.tasks[0].subject).toBe('Private task');
    const old=result;who='replacement';expect(f.render().tasks).toEqual([]);expect(await old.save(draft)).toBe(false);expect(mocks.context.userSync.createTask).not.toHaveBeenCalled();
  });
  it('fences an old list response across A → B → A',async()=>{
    const old=deferred<unknown>();mocks.execute.mockReturnValueOnce(old.promise).mockImplementation(async()=>({data:[task('Fresh')],error:null}));let who=user;
    const f=hook(()=>usePersonalTasks(company,who));f.render();f.effects();await flush();who='other';f.render();f.effects();await flush();who=user;f.render();f.effects();await flush();old.resolve({data:[task('Stale private task')],error:null});await flush();expect(f.render().tasks.map(row=>row.subject)).toEqual(['Fresh']);
  });
  it('reuses task identity after failed local acknowledgment, even after reconnect',async()=>{
    mocks.context.userSync.createTask.mockRejectedValueOnce(new Error('Local acknowledgment lost')).mockResolvedValue({});
    const f=hook(()=>usePersonalTasks(company,user));const first=f.render();expect(await first.save(draft)).toBe(false);
    mocks.context.offline=false;expect(await f.render().save({...draft,subject:' Order filters '})).toBe(true);
    const calls=mocks.context.userSync.createTask.mock.calls;expect(calls[1][0]).toEqual(calls[0][0]);
    await f.render().save(draft);expect(calls[2][0].id).not.toBe(calls[0][0].id);expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it('queues completion after reconnect rather than deleting before a pending create',async()=>{
    mocks.context.state.entries=[entry('personal_task','task.create',draft)];mocks.context.offline=false;
    const f=hook(()=>usePersonalTasks(company,user));await f.render().remove('task');expect(mocks.context.userSync.completeTask).toHaveBeenCalledWith('task');expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it('filters foreign account/company proposals and keeps confirmed completions hidden from stale lists',async()=>{
    const own=entry('personal_task','task.create',draft);const foreign={...own,operation:{...own.operation,provenance:{...own.operation.provenance,userId:'other'}}};
    const elsewhere={...own,operation:{...own.operation,companyId:otherCompany}};mocks.context.state.entries=[own,foreign,elsewhere];
    const f=hook(()=>usePersonalTasks(company,user));expect(f.render().pendingCount).toBe(1);expect(f.render().tasks).toHaveLength(1);
    mocks.context.state.entries=[entry('personal_task','task.complete',{},'synced',null,2)];mocks.execute.mockResolvedValue({data:[task('Stale deleted task')],error:null});f.render();f.effects();await flush();expect(f.render().tasks).toEqual([]);
  });
  it('does not let an old save clear a replacement account’s busy state',async()=>{
    const old=deferred<unknown>();const next=deferred<unknown>();mocks.context.userSync.createTask.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);let who=user;
    const f=hook(()=>usePersonalTasks(company,who));const first=f.render().save(draft);who='other';mocks.context.userSync.scope={userId:who,companyId:company};const second=f.render().save(draft);
    old.reject(new Error('Old account failure'));await first;expect(f.render().busy).toBe(true);expect(f.render().error).toBe('');next.resolve({});await second;expect(f.render().busy).toBe(false);
  });
});

describe('scoped availability hooks',()=>{
  it('hides old-company statuses on the transition render',async()=>{
    mocks.execute.mockResolvedValue({data:[{user_id:user,available:true}],error:null});let tenant=company;
    const f=hook(()=>useAvailability(tenant,user));f.render();f.effects();await flush();expect(f.render().statuses[user]).toBe(true);tenant=otherCompany;expect(f.render().statuses).toEqual({});
  });
  it('uses verified kept-current acknowledgment as soon as its pending overlay disappears',()=>{
    mocks.context.state.entries=[entry('availability','availability.set',{available:true,base:false})];const f=hook(()=>useAvailability(company,user));expect(f.render().statuses[user]).toBe(true);
    mocks.context.state.entries=[entry('availability','availability.set',{available:true,base:false},'synced',{id:user,available:false})];expect(f.render().statuses[user]).toBe(false);
  });
  it('refreshes canonically after acknowledgment instead of replaying the historical result forever',async()=>{
    mocks.context.offline=false;mocks.context.state.entries=[entry('availability','availability.set',{available:false,base:false},'synced',{id:user,available:false})];
    mocks.execute.mockResolvedValue({data:[{user_id:user,available:false}],error:null});mocks.availability.mockResolvedValue({data:{actorId:user,companyId:company,statuses:{[user]:true}},error:null});
    const f=hook(()=>useAvailability(company,user));expect(f.render().statuses[user]).toBe(false);f.effects();await flush();expect(f.render().statuses[user]).toBe(true);expect(mocks.headers).toHaveBeenCalledWith('Authorization','Bearer bound-token');
  });
  it('ignores out-of-order roster responses and preserves newest pending intent',async()=>{
    const old=deferred<unknown>();mocks.execute.mockReturnValueOnce(old.promise).mockResolvedValue({data:[{user_id:user,available:true}],error:null});
    const f=hook(()=>useAvailability(company,user));f.render();f.effects();await flush();mocks.events[0]();await flush();old.resolve({data:[{user_id:user,available:false}],error:null});await flush();expect(f.render().statuses[user]).toBe(true);
    mocks.context.state.entries=[entry('availability','availability.set',{available:false,base:true})];expect(f.render().statuses[user]).toBe(false);
  });
  it('preserves rapid sequential reversals and freezes failed-request bases for retry',async()=>{
    const f=hook(()=>useAvailability(company,user));const result=f.render();await result.save(user,true);await result.save(user,false);
    expect(mocks.context.userSync.setAvailability.mock.calls.slice(0,2)).toEqual([[true,null],[false,true]]);
    mocks.context.userSync.setAvailability.mockRejectedValueOnce(new Error('Lost local acknowledgment'));
    await f.render().save(user,true);const failed=mocks.context.userSync.setAvailability.mock.calls.at(-1);
    mocks.context.state.entries=[entry('availability','availability.set',{available:true,base:false})];await f.render().save(user,true);expect(mocks.context.userSync.setAvailability.mock.calls.at(-1)).toEqual(failed);
  });
  it('binds online crew edits to the original actor and fences late acknowledgments',async()=>{
    mocks.context.offline=false;const crew='20000000-0000-4000-8000-999999999999';let tenant=company;const f=hook(()=>useAvailability(tenant,user));f.render();f.effects();await flush();expect(f.render().canSave(crew)).toBe(true);
    const response=deferred<unknown>();mocks.availability.mockImplementationOnce(()=>response.promise);const saving=f.render().save(crew,true);await flush();
    expect(mocks.availability).toHaveBeenLastCalledWith('set_crew_availability_once',expect.objectContaining({request:expect.objectContaining({actorId:user,companyId:company,userId:crew,available:true,base:null})}));expect(mocks.headers).toHaveBeenCalledWith('Authorization','Bearer bound-token');
    const {request}=mocks.availability.mock.lastCall![1] as {request:{requestId:string}};tenant=otherCompany;f.render();response.resolve({data:{actorId:user,companyId:company,userId:crew,requestId:request.requestId,receivedAt:'2026-01-01T00:00:00Z',kind:'applied',available:true},error:null});await saving;expect(f.render().statuses).toEqual({});expect(f.render().busy).toBe(false);
    expect(mocks.client.from).not.toHaveBeenCalledWith('crew_availability',expect.anything());expect(mocks.execute.mock.calls.some(([request])=>request.action==='upsert')).toBe(false);
  });
  it('locks duplicate saves synchronously and blocks foreign-scope command services',async()=>{
    const saving=deferred<unknown>();mocks.context.userSync.setAvailability.mockReturnValue(saving.promise);const f=hook(()=>useAvailability(company,user));const result=f.render();const first=result.save(user,true);await result.save(user,false);expect(mocks.context.userSync.setAvailability).toHaveBeenCalledTimes(1);saving.resolve({});await first;
    mocks.context.userSync.scope={userId:user,companyId:otherCompany};await f.render().save(user,true);expect(mocks.context.userSync.setAvailability).toHaveBeenCalledTimes(1);expect(f.render().error).toContain('unavailable');
  });
});

describe('scoped dashboard hooks',()=>{
  it('excludes other users’ pending layouts and never applies real pending values to demo',async()=>{
    const own=entry('dashboard','dashboard.set',{changes:{greeting:false}});const other={...own,operation:{...own.operation,provenance:{...own.operation.provenance,userId:'other'}}};mocks.context.state.entries=[other];
    const f=hook(()=>useDashboardPreferences(user));expect(f.render().visible('greeting')).toBe(true);
    mocks.context.state.entries=[entry('dashboard','dashboard.set',{changes:{greeting:false}})];const demo=hook(()=>useDashboardPreferences(user,true));expect(demo.render().visible('greeting')).toBe(true);await demo.render().save('greeting',false);expect(demo.render().visible('greeting')).toBe(false);expect(mocks.context.userSync.setDashboard).not.toHaveBeenCalled();
  });
  it('shows canonical acknowledgment immediately, then accepts a newer verified server layout',async()=>{
    mocks.context.state.entries=[entry('dashboard','dashboard.set',{changes:{greeting:false}})];const f=hook(()=>useDashboardPreferences(user));expect(f.render().visible('greeting')).toBe(false);
    mocks.context.state.entries=[entry('dashboard','dashboard.set',{changes:{greeting:false}},'synced',{id:user,items:{greeting:false}})];expect(f.render().visible('greeting')).toBe(false);
    mocks.context.offline=false;mocks.canonical.mockResolvedValue({data:{revision:'100',record:{id:user,items:{greeting:true,tasks:false}}},error:null});f.render();f.effects();await flush();expect(f.render().visible('greeting')).toBe(true);expect(f.render().visible('tasks')).toBe(false);
  });
  it('fences old saves across A → B → A without blocking the new scope or clearing its save',async()=>{
    const old=deferred<unknown>();const next=deferred<unknown>();mocks.context.userSync.setDashboard.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);let who=user;
    const f=hook(()=>useDashboardPreferences(who));const first=f.render().save('greeting',false);who='other';f.render();who=user;const second=f.render().save('tasks',false);
    expect(mocks.context.userSync.setDashboard).toHaveBeenCalledTimes(2);old.reject(new Error('Stale failure'));await first;expect(f.render().saving).toBe(true);expect(f.render().error).toBe('');next.resolve({});await second;expect(f.render().saving).toBe(false);
  });
  it('keeps offline preferences editable from a verified receipt when the read cache is unavailable',async()=>{
    mocks.context.state.entries=[entry('dashboard','dashboard.set',{changes:{tasks:false}},'synced',{id:user,items:{tasks:false}})];mocks.execute.mockRejectedValue(new Error('No cached response'));
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();expect(f.render().visible('tasks')).toBe(false);expect(f.render().loadFailed).toBe(false);await f.render().save('greeting',false);expect(mocks.context.userSync.setDashboard).toHaveBeenCalledWith({greeting:false});
  });
  it('retains mobile online fallback nonce/body and never falls back to table mutation',async()=>{
    mocks.context.available=false;mocks.context.offline=false;mocks.context.userSync=null as never;
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.onlineWrite.mockRejectedValueOnce(new Error('Response lost'));
    await f.render().save('greeting',false);expect(f.render().retryRequired).toBe(true);await f.render().save('tasks',false);expect(mocks.onlineWrite).toHaveBeenCalledTimes(1);
    mocks.onlineRead.mockResolvedValue({data:{userId:user,items:{greeting:false,tasks:false}},error:null});await f.render().retry();expect(mocks.onlineWrite.mock.calls[1][0]).toBe(mocks.onlineWrite.mock.calls[0][0]);expect(f.render().visible('tasks')).toBe(false);expect(f.render().retryRequired).toBe(false);expect(mocks.client.from).not.toHaveBeenCalled();
  });
  it('retries only refresh after mobile online acknowledgment, keeping current independent server choices',async()=>{
    mocks.context.available=false;mocks.context.offline=false;mocks.context.userSync=null as never;
    const f=hook(()=>useDashboardPreferences(user));f.render();f.effects();await flush();mocks.onlineRead.mockRejectedValueOnce(new Error('Read failed'));await f.render().save('greeting',false);
    expect(f.render().pending?.acknowledged).toBe(true);expect(f.render().error).toContain('Saved on server');mocks.onlineRead.mockResolvedValue({data:{userId:user,items:{greeting:true,resources:false}},error:null});await f.render().retry();expect(mocks.onlineWrite).toHaveBeenCalledTimes(1);expect(f.render().visible('greeting')).toBe(true);expect(f.render().visible('resources')).toBe(false);
  });
  it('queues native online toggles too, without bypassing earlier commands',async()=>{
    mocks.context.offline=false;const f=hook(()=>useDashboardPreferences(user));await f.render().save('greeting',false);expect(mocks.context.userSync.setDashboard).toHaveBeenCalledWith({greeting:false});expect(mocks.client.from).not.toHaveBeenCalled();
  });
});

describe('account-bound settings reads',()=>{
  it('rejects a replacement SDK identity before issuing an RPC',async()=>{
    mocks.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'replacement'},access_token:'wrong'}},error:null});
    await expect(readUserSetting(mocks.client as unknown as SupabaseClient,{userId:user,companyId:company},'dashboard',()=>true)).rejects.toThrow('account');expect(mocks.client.rpc).not.toHaveBeenCalled();
  });
  it('times out a stuck session restore without sending a late RPC',async()=>{
    vi.useFakeTimers();const pending=deferred<unknown>();mocks.client.auth.getSession.mockReturnValue(pending.promise);
    try{
      const reading=readUserSetting(mocks.client as unknown as SupabaseClient,{userId:user,companyId:company},'dashboard',()=>true);const check=expect(reading).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(15_000);await check;
      pending.resolve({data:{session:{user:{id:user},access_token:'late'}},error:null});await flush();expect(mocks.client.rpc).not.toHaveBeenCalled();
    }finally{vi.useRealTimers()}
  });
  it('rejects stale revisions and scope loss during token restoration',async()=>{
    mocks.canonical.mockResolvedValue({data:{revision:'1',record:{id:user,available:false}},error:null});
    await expect(readUserSetting(mocks.client as unknown as SupabaseClient,{userId:user,companyId:company},'availability',()=>true,'2')).rejects.toThrow('older');
    let current=true;mocks.client.auth.getSession.mockImplementation(async()=>{current=false;return {data:{session:{user:{id:user},access_token:'bound'}},error:null}});mocks.client.rpc.mockClear();
    await expect(readUserSetting(mocks.client as unknown as SupabaseClient,{userId:user,companyId:company},'availability',()=>current)).rejects.toThrow('account');expect(mocks.client.rpc).not.toHaveBeenCalled();
  });
});
