import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// Inbox and Crew Chat stores with mocked Supabase/network; executes the real
// store hooks with persistent hook slots. No UI, server or device.
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',()=>runtime.hooks);
const mocks=vi.hoisted(()=>({offline:true,tables:{} as Record<string,{data:unknown;error:null;count?:number}>,writes:[] as {table:string;action:string}[]}));
vi.mock('expo-notifications',()=>({setBadgeCountAsync:vi.fn(async()=>undefined)}));
vi.mock('@/providers/network-provider',()=>({isOffline:()=>mocks.offline}));
vi.mock('@/lib/supabase',()=>{
  const query=(table:string)=>{const chain:Record<string,unknown>={};
    for(const name of ['select','eq','order','limit','in','is'])chain[name]=()=>chain;
    for(const name of ['update','upsert','insert','delete'])chain[name]=()=>{mocks.writes.push({table,action:name});return chain};
    chain.maybeSingle=()=>chain;chain.single=()=>chain;
    chain.then=(yes:(value:unknown)=>unknown,no:(error:unknown)=>unknown)=>Promise.resolve(mocks.tables[table]??{data:[],error:null}).then(yes,no);return chain};
  const channel={on:()=>channel,subscribe:()=>channel};
  return {supabase:{from:query,channel:()=>channel,removeChannel:async()=>undefined}};
});
import {publishOfflineReadMarkers,type OfflineReadMarkers} from './offline-read-markers';
import {markAllInboxNotificationsRead,markInboxNotificationRead,refreshNotificationInbox,useNotificationInbox,withOfflineReads} from './notification-inbox-store';
import {displayedThroughOf,markCommunicationThreadSeen,useCommunications,withOfflineSeen} from './communications-store';

const company='10000000-0000-4000-8000-000000000001',user='20000000-0000-4000-8000-000000000001';
const first='30000000-0000-4000-8000-000000000001',second='30000000-0000-4000-8000-000000000002',thread='40000000-0000-4000-8000-000000000001';
const row=(id:string,read_at:string|null=null)=>({id,event_type:'system',entity_type:'system',entity_id:null,title:'T',body:'B',path:'/x',group_key:'g',read_at,created_at:'2026-01-01T10:00:00+00:00'});
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
function hook<T>(fn:()=>T){
  const frame=runtime.frame();
  return {render(){runtime.enter(frame);return fn()},effects(){for(const index of [...frame.effects]){frame.effects.delete(index);const value=frame.slots[index];value.cleanup?.();value.cleanup=value.effect?.()??undefined}}};
}
function markers(changes:Partial<OfflineReadMarkers>={}):OfflineReadMarkers{
  return {companyId:company,userId:user,markNotificationRead:vi.fn(async()=>({})),markThreadSeen:vi.fn(async()=>({})),reads:new Map(),seen:new Map(),...changes};
}
beforeEach(()=>{
  mocks.offline=true;mocks.writes=[];
  mocks.tables={user_notifications:{data:[row(first),row(second)],error:null,count:2},
    communication_threads:{data:[{id:thread,subject:'S',description:'D',created_by:'other',created_by_name:'O',created_by_role:'owner',created_at:'2026-01-01T09:00:00+00:00'}],error:null},
    communication_replies:{data:[{id:'r1',thread_id:thread,body:'Hi',created_by:'other',created_by_name:'O',created_at:'2026-01-01T10:00:00.123456+00:00'}],error:null},
    communication_reads:{data:[],error:null}};
});
afterEach(()=>publishOfflineReadMarkers(null));

describe('offline read-marker overlays',()=>{
  it('marks downloaded unread notifications read without changing already-read ones',()=>{
    const base={notifications:[{id:first,readAt:null},{id:second,readAt:'2026-01-01T00:00:00Z'}],unreadCount:5} as never;
    const view=withOfflineReads(base,{reads:new Map([[first,'2026-01-02T00:00:00Z'],[second,'2026-01-03T00:00:00Z']])});
    expect(view.notifications.map(item=>item.readAt)).toEqual(['2026-01-02T00:00:00Z','2026-01-01T00:00:00Z']);expect(view.unreadCount).toBe(4);
    expect(withOfflineReads(base,null)).toBe(base);
  });
  it('raises thread seen markers forward only and uses verbatim server timestamps',()=>{
    const threads=[{id:thread,createdAt:'2026-01-01T09:00:00+00:00',seenAt:'2026-01-01T12:00:00Z',replies:[{createdAt:'2026-01-01T10:00:00.123456+00:00'}]}];
    expect(withOfflineSeen({threads} as never,{seen:new Map([[thread,'2026-01-01T11:00:00Z']])}).threads[0].seenAt).toBe('2026-01-01T12:00:00Z');
    expect(displayedThroughOf(threads[0] as never)).toBe('2026-01-01T10:00:00.123456+00:00');
  });
});
describe('offline store actions',()=>{
  it('queues notification reads for the exact account offline and never writes the table',async()=>{
    const queue=markers();publishOfflineReadMarkers(queue);const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();await flush();
    expect(f.render().unreadCount).toBe(2);
    await markInboxNotificationRead(first);expect(queue.markNotificationRead).toHaveBeenCalledWith(first);expect(f.render().unreadCount).toBe(1);
    await markAllInboxNotificationsRead();expect(vi.mocked(queue.markNotificationRead).mock.calls.map(call=>call[0])).toEqual([first,second]);
    expect(mocks.writes).toEqual([]);
    publishOfflineReadMarkers(markers({userId:'20000000-0000-4000-8000-000000000009'}));await expect(markInboxNotificationRead(second)).rejects.toThrow('unavailable');
  });
  it('reverts an offline read whose device save fails and overlays saved reads after refresh',async()=>{
    const failing=markers({markNotificationRead:vi.fn(async()=>{throw new Error('disk full')})});publishOfflineReadMarkers(failing);
    // Module-level store: reload the downloaded list left over from the previous test.
    const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();await refreshNotificationInbox();await flush();
    await expect(markInboxNotificationRead(first)).rejects.toThrow('disk full');expect(f.render().notifications.find(item=>item.id===first)?.readAt).toBeNull();expect(f.render().error).toContain('disk full');
    publishOfflineReadMarkers(markers({reads:new Map([[first,'2026-01-02T00:00:00Z']])}));expect(f.render().notifications.find(item=>item.id===first)?.readAt).toBe('2026-01-02T00:00:00Z');expect(f.render().unreadCount).toBe(1);
  });
  it('marks threads seen through the newest displayed reply offline, and only after saving',async()=>{
    const queue=markers();publishOfflineReadMarkers(queue);const f=hook(()=>useCommunications(company,user));f.render();f.effects();await flush();
    expect(await markCommunicationThreadSeen(thread)).toBe('2026-01-01T10:00:00.123456+00:00');
    expect(queue.markThreadSeen).toHaveBeenCalledWith(thread,'2026-01-01T10:00:00.123456+00:00');expect(f.render().threads[0].seenAt).toBe('2026-01-01T10:00:00.123456+00:00');
    const failing=markers({markThreadSeen:vi.fn(async()=>{throw new Error('locked')})});publishOfflineReadMarkers(failing);const before=f.render();
    await expect(markCommunicationThreadSeen(thread)).rejects.toThrow('locked');expect(f.render()).toBe(before);expect(mocks.writes).toEqual([]);
  });
});
