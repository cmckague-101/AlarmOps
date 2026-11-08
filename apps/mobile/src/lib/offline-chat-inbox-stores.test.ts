import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// Inbox and Crew Chat stores with mocked Supabase/network; executes the real
// store hooks with persistent hook slots. No UI, server or device.
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',()=>runtime.hooks);
const mocks=vi.hoisted(()=>({offline:true,tables:{} as Record<string,{data:unknown;error:null;count?:number}>,writes:[] as {table:string;action:string}[],rpcs:[] as {name:string;args:Record<string,unknown>}[]}));
vi.mock('expo-notifications',()=>({setBadgeCountAsync:vi.fn(async()=>undefined)}));
vi.mock('@/providers/network-provider',()=>({isOffline:()=>mocks.offline}));
vi.mock('@/lib/supabase',()=>{
  const query=(table:string)=>{const chain:Record<string,unknown>={};
    for(const name of ['select','eq','order','limit','in','is'])chain[name]=()=>chain;
    for(const name of ['update','upsert','insert','delete'])chain[name]=()=>{mocks.writes.push({table,action:name});return chain};
    chain.maybeSingle=()=>chain;chain.single=()=>chain;
    chain.then=(yes:(value:unknown)=>unknown,no:(error:unknown)=>unknown)=>Promise.resolve(mocks.tables[table]??{data:[],error:null}).then(yes,no);return chain};
  const channel={on:()=>channel,subscribe:()=>channel};
  return {supabase:{from:query,rpc:async(name:string,args:Record<string,unknown>)=>{mocks.rpcs.push({name,args});return {data:1,error:null}},channel:()=>channel,removeChannel:async()=>undefined}};
});
import {publishOfflineChatInbox,type OfflineChatInbox} from './offline-chat-inbox';
import {publishOfflineCompanyLists} from './offline-company-lists';
import {clearInboxNotifications,dismissInboxNotification,markAllInboxNotificationsRead,markInboxNotificationRead,refreshNotificationInbox,saveNotificationPreferences,useNotificationInbox,withOfflineReads} from './notification-inbox-store';
import {currentDismissedNotificationIds,resetDismissedNotificationsForTests,selectDismissedNotificationsAccount} from './dismissed-notifications';
import {displayedThroughOf,markCommunicationThreadSeen,refreshCommunications,replyToCommunicationThread,useCommunications,withOfflineReplies,withOfflineSeen} from './communications-store';

vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(async()=>null),setItemAsync:vi.fn(async()=>undefined),deleteItemAsync:vi.fn(async()=>undefined)}));

const company='10000000-0000-4000-8000-000000000001',user='20000000-0000-4000-8000-000000000001';
const first='30000000-0000-4000-8000-000000000001',second='30000000-0000-4000-8000-000000000002',thread='40000000-0000-4000-8000-000000000001';
const row=(id:string,read_at:string|null=null)=>({id,event_type:'system',entity_type:'system',entity_id:null,title:'T',body:'B',path:'/x',group_key:'g',read_at,created_at:'2026-01-01T10:00:00+00:00'});
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
function hook<T>(fn:()=>T){
  const frame=runtime.frame();
  return {render(){runtime.enter(frame);return fn()},effects(){for(const index of [...frame.effects]){frame.effects.delete(index);const value=frame.slots[index];value.cleanup?.();value.cleanup=value.effect?.()??undefined}}};
}
function markers(changes:Partial<OfflineChatInbox>={}):OfflineChatInbox{
  return {companyId:company,userId:user,markNotificationRead:vi.fn(async()=>({})),markThreadSeen:vi.fn(async()=>({})),reads:new Map(),seen:new Map(),postReply:vi.fn(async()=>({})),newId:vi.fn(()=>'50000000-0000-4000-8000-000000000001'),replies:[],savePreferences:vi.fn(async()=>({})),preferences:{},...changes};
}
beforeEach(()=>{
  mocks.offline=true;mocks.writes=[];mocks.rpcs=[];
  resetDismissedNotificationsForTests();
  selectDismissedNotificationsAccount(null,null);
  mocks.tables={user_notifications:{data:[row(first),row(second)],error:null,count:2},
    communication_threads:{data:[{id:thread,subject:'S',description:'D',created_by:'other',created_by_name:'O',created_by_role:'owner',created_at:'2026-01-01T09:00:00+00:00'}],error:null},
    communication_replies:{data:[{id:'r1',thread_id:thread,body:'Hi',created_by:'other',created_by_name:'O',created_at:'2026-01-01T10:00:00.123456+00:00'}],error:null},
    communication_reads:{data:[],error:null}};
});
afterEach(()=>{publishOfflineChatInbox(null);selectDismissedNotificationsAccount(null,null)});

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
    const queue=markers();publishOfflineChatInbox(queue);const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();await flush();
    expect(f.render().unreadCount).toBe(2);
    await markInboxNotificationRead(first);expect(queue.markNotificationRead).toHaveBeenCalledWith(first);expect(f.render().unreadCount).toBe(1);
    await markAllInboxNotificationsRead();expect(vi.mocked(queue.markNotificationRead).mock.calls.map(call=>call[0])).toEqual([first,second]);
    expect(mocks.writes).toEqual([]);
    publishOfflineChatInbox(markers({userId:'20000000-0000-4000-8000-000000000009'}));await expect(markInboxNotificationRead(second)).rejects.toThrow('unavailable');
  });
  it('reverts an offline read whose device save fails and overlays saved reads after refresh',async()=>{
    const failing=markers({markNotificationRead:vi.fn(async()=>{throw new Error('disk full')})});publishOfflineChatInbox(failing);
    // Module-level store: reload the downloaded list left over from the previous test.
    const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();await refreshNotificationInbox();await flush();
    await expect(markInboxNotificationRead(first)).rejects.toThrow('disk full');expect(f.render().notifications.find(item=>item.id===first)?.readAt).toBeNull();expect(f.render().error).toContain('disk full');
    publishOfflineChatInbox(markers({reads:new Map([[first,'2026-01-02T00:00:00Z']])}));expect(f.render().notifications.find(item=>item.id===first)?.readAt).toBe('2026-01-02T00:00:00Z');expect(f.render().unreadCount).toBe(1);
  });
  it('marks threads seen through the newest displayed reply offline, and only after saving',async()=>{
    const queue=markers();publishOfflineChatInbox(queue);const f=hook(()=>useCommunications(company,user));f.render();f.effects();await flush();
    expect(await markCommunicationThreadSeen(thread)).toBe('2026-01-01T10:00:00.123456+00:00');
    expect(queue.markThreadSeen).toHaveBeenCalledWith(thread,'2026-01-01T10:00:00.123456+00:00');expect(f.render().threads[0].seenAt).toBe('2026-01-01T10:00:00.123456+00:00');
    const failing=markers({markThreadSeen:vi.fn(async()=>{throw new Error('locked')})});publishOfflineChatInbox(failing);const before=f.render();
    await expect(markCommunicationThreadSeen(thread)).rejects.toThrow('locked');expect(f.render()).toBe(before);expect(mocks.writes).toEqual([]);
  });
  it('saves offline replies with one stable ID across failed saves and never inserts directly',async()=>{
    const failing=markers({postReply:vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue({}),newId:vi.fn().mockReturnValueOnce('50000000-0000-4000-8000-000000000001').mockReturnValue('50000000-0000-4000-8000-000000000002')});
    publishOfflineChatInbox(failing);const f=hook(()=>useCommunications(company,user));f.render();f.effects();await refreshCommunications();await flush();
    await expect(replyToCommunicationThread(thread,' On my way ')).rejects.toThrow('busy');const saved=await replyToCommunicationThread(thread,'On my way');
    expect(vi.mocked(failing.postReply).mock.calls.map(call=>call[0])).toEqual([{id:'50000000-0000-4000-8000-000000000001',threadId:thread,body:'On my way'},{id:'50000000-0000-4000-8000-000000000001',threadId:thread,body:'On my way'}]);
    expect(saved.id).toBe('50000000-0000-4000-8000-000000000001');expect(mocks.writes).toEqual([]);
    publishOfflineChatInbox(markers({userId:'20000000-0000-4000-8000-000000000009'}));await expect(replyToCommunicationThread(thread,'Hi')).rejects.toThrow('unavailable');
    publishOfflineChatInbox(markers());await expect(replyToCommunicationThread('40000000-0000-4000-8000-00000000ffff','Hi')).rejects.toThrow('unavailable');
  });
  it('shows saved replies until the downloaded thread has them, and seen markers ignore device times',async()=>{
    const downloaded={threads:[{id:thread,createdAt:'2026-01-01T09:00:00+00:00',replies:[{id:'r1',createdAt:'2026-01-01T10:00:00+00:00'}]}],loading:false,refreshing:false,error:null} as never;
    const replies=[{id:'r1',threadId:thread,body:'Old',savedAt:'x',state:'posted' as const,createdAt:'2026-01-01T10:00:00+00:00'},{id:'r2',threadId:thread,body:'New',savedAt:'2030-01-01T00:00:00Z',state:'saved' as const}];
    const view=withOfflineReplies(downloaded,{replies},user);
    expect(view.threads[0].replies.map(reply=>[reply.id,reply.createdById])).toEqual([['r1',undefined],['r2',user]]);expect(view.deviceReplies).toEqual({r2:'saved'});
    expect(withOfflineReplies(downloaded,{replies:[]},user)).toBe(downloaded);
    const queue=markers({replies});publishOfflineChatInbox(queue);const f=hook(()=>useCommunications(company,user));f.render();f.effects();await refreshCommunications();await flush();
    expect(f.render().threads[0].replies.at(-1)?.id).toBe('r2');await markCommunicationThreadSeen(thread);expect(queue.markThreadSeen).toHaveBeenCalledWith(thread,'2026-01-01T10:00:00.123456+00:00');
  });
  it('queues notification preferences per key offline and overlays them until synced',async()=>{
    const value=markers();publishOfflineChatInbox(value);
    await saveNotificationPreferences({trainingCreated:false});
    expect(value.savePreferences).toHaveBeenCalledWith({trainingCreated:false});expect(mocks.writes).toEqual([]);
    const base={notifications:[],unreadCount:0,loading:false,refreshing:false,error:null,preferences:{pushEnabled:true,communicationReplies:true,documentAdded:true,trainingCreated:true,issueUpdates:true},savingPreferences:false} as never;
    expect((withOfflineReads(base,{reads:new Map(),preferences:{trainingCreated:false}}) as {preferences:{trainingCreated:boolean;pushEnabled:boolean}}).preferences).toMatchObject({trainingCreated:false,pushEnabled:true});
    publishOfflineChatInbox(null);await expect(saveNotificationPreferences({pushEnabled:false})).rejects.toThrow(/unavailable/);
  });
  it('reads the verified inbox and Crew Chat downloads offline instead of cached HTTP responses',async()=>{
    publishOfflineChatInbox(null);
    const download=(section:string,tables:Record<string,unknown[]>)=>({snapshot:{schemaVersion:1 as const,section:section as never,companyId:company,userId:user,serverRequestAt:'2026-01-02T00:00:00Z',receiptWatermark:'3',tables:tables as never},verifiedAt:'2026-01-02T00:00:01Z'});
    publishOfflineCompanyLists({companyId:company,userId:user,sections:{
      notifications:download('notifications',{user_notifications:[row(first,'2026-01-01T11:00:00Z'),row(second)],notification_preferences:[{push_enabled:false,communication_replies:true,document_added:true,training_created:true,issue_updates:true}]}),
      crew_chat:download('crew_chat',{communication_threads:[{id:thread,subject:'Downloaded',description:'D',created_by:'other',created_by_name:'O',created_by_role:'owner',created_at:'2026-01-01T09:00:00+00:00'}],communication_replies:[],communication_reads:[]}),
    }});
    mocks.tables={};
    const inbox=hook(()=>useNotificationInbox(company,user));inbox.render();inbox.effects();await refreshNotificationInbox();await flush();
    const value=inbox.render();expect(value.notifications.map(item=>item.id)).toEqual([first,second]);expect(value.unreadCount).toBe(1);expect(value.preferences.pushEnabled).toBe(false);expect(value.downloaded?.receiptWatermark).toBe('3');
    const chat=hook(()=>useCommunications(company,user));chat.render();chat.effects();await refreshCommunications();await flush();
    expect(chat.render().threads.map(item=>item.subject)).toEqual(['Downloaded']);
    mocks.offline=false;await refreshNotificationInbox();await flush();expect(inbox.render().downloaded).toBeFalsy();
    publishOfflineCompanyLists(null);
  });
});
describe('clearing notifications',()=>{
  it('hides clears offline, then sends them to the server on the next online refresh',async()=>{
    publishOfflineChatInbox(null);mocks.offline=false;mocks.tables={user_notifications:{data:[row(first),row(second)],error:null,count:2}};
    const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();selectDismissedNotificationsAccount(company,user);await refreshNotificationInbox();await flush();
    mocks.offline=true;
    await dismissInboxNotification(first);
    expect(f.render().notifications.map(item=>item.id)).toEqual([second]);expect(mocks.rpcs).toEqual([]);
    mocks.offline=false;await refreshNotificationInbox();await flush();
    expect(mocks.rpcs).toEqual([{name:'dismiss_user_notifications',args:{target_company_id:company,notification_ids:[first],event_types:null}}]);
    expect([...currentDismissedNotificationIds()]).toEqual([]);
  });
  it('clear all online clears everything the inbox lists on the server',async()=>{
    publishOfflineChatInbox(null);mocks.offline=false;mocks.tables={user_notifications:{data:[row(first),row(second)],error:null,count:2}};
    const f=hook(()=>useNotificationInbox(company,user));f.render();f.effects();selectDismissedNotificationsAccount(company,user);await refreshNotificationInbox();await flush();
    await clearInboxNotifications([first,second]);
    expect(mocks.rpcs).toEqual([{name:'dismiss_user_notifications',args:{target_company_id:company,notification_ids:null,event_types:null}}]);
    expect([...currentDismissedNotificationIds()]).toEqual([]);
  });
});
