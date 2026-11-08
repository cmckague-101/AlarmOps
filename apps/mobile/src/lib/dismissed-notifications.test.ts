import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({store:new Map<string,string>(),getItemAsync:vi.fn(async(key:string)=>mocks.store.get(key)??null),setItemAsync:vi.fn(async(key:string,value:string)=>{mocks.store.set(key,value)}),deleteItemAsync:vi.fn(async(key:string)=>{mocks.store.delete(key)})}));
vi.mock('expo-secure-store',()=>({getItemAsync:mocks.getItemAsync,setItemAsync:mocks.setItemAsync,deleteItemAsync:mocks.deleteItemAsync}));

import {
  addDismissedNotificationId,
  addDismissedNotificationIds,
  currentDismissedNotificationIds,
  dismissedNotificationsKey,
  forgetDismissedNotifications,
  readDismissedNotificationIds,
  rememberDismissedNotifications,
  resetDismissedNotificationsForTests,
  selectDismissedNotificationsAccount,
  serializeDismissedNotificationIds,
  withDismissedNotifications,
} from './dismissed-notifications';

const company='10000000-0000-4000-8000-000000000001';
const user='20000000-0000-4000-8000-000000000001';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};

beforeEach(()=>{
  mocks.store.clear();
  vi.clearAllMocks();
  resetDismissedNotificationsForTests();
  selectDismissedNotificationsAccount(null,null);
});

afterEach(()=>selectDismissedNotificationsAccount(null,null));

describe('dismissed notification helpers',()=>{
  it('scopes storage keys and filters dismissed rows from unread counts',()=>{
    expect(dismissedNotificationsKey(company,user)).toBe(`fireops-dismissed-notifications.${company}.${user}`);
    const view=withDismissedNotifications({
      notifications:[{id:'a',readAt:null},{id:'b',readAt:'2026-01-01T00:00:00Z'},{id:'c',readAt:null}],
      unreadCount:4,
    },new Set(['a','b']));
    expect(view.notifications.map(item=>item.id)).toEqual(['c']);
    expect(view.unreadCount).toBe(3);
    expect([...readDismissedNotificationIds(serializeDismissedNotificationIds(['a','b']))].sort()).toEqual(['a','b']);
    expect(addDismissedNotificationId(new Set(['a']),'a')).toEqual(new Set(['a']));
    expect([...addDismissedNotificationIds(new Set(['a']),['a','b'])].sort()).toEqual(['a','b']);
  });
});

describe('dismissed notification store',()=>{
  it('keeps unconfirmed clears for the active account across reloads',async()=>{
    selectDismissedNotificationsAccount(company,user);await flush();
    await rememberDismissedNotifications(['notice-1']);
    await rememberDismissedNotifications(['notice-2','notice-3']);
    expect([...currentDismissedNotificationIds()].sort()).toEqual(['notice-1','notice-2','notice-3']);
    expect(mocks.setItemAsync).toHaveBeenCalled();

    selectDismissedNotificationsAccount(null,null);
    selectDismissedNotificationsAccount(company,user);await flush();
    expect([...currentDismissedNotificationIds()].sort()).toEqual(['notice-1','notice-2','notice-3']);
  });

  it('forgets clears the server confirmed, only for the same account',async()=>{
    selectDismissedNotificationsAccount(company,user);await flush();
    await rememberDismissedNotifications(['notice-1','notice-2']);
    await forgetDismissedNotifications(company,'someone-else',['notice-1']);
    expect([...currentDismissedNotificationIds()].sort()).toEqual(['notice-1','notice-2']);
    await forgetDismissedNotifications(company,user,['notice-1']);
    expect([...currentDismissedNotificationIds()]).toEqual(['notice-2']);
    await forgetDismissedNotifications(company,user,['notice-2']);
    expect(mocks.store.has(`fireops-dismissed-notifications.${company}.${user}`)).toBe(false);
  });
});
