import {beforeEach,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  last:vi.fn(),clear:vi.fn(),session:vi.fn(),open:vi.fn(),refresh:vi.fn(),
}));
vi.mock('react-native',()=>({Platform:{OS:'android'}}));
vi.mock('expo-constants',()=>({default:{}}));
vi.mock('expo-device',()=>({isDevice:false}));
vi.mock('expo-linking',()=>({openURL:mocks.open,createURL:(path:string)=>`fireops://${path}`}));
vi.mock('expo-notifications',()=>({
  setNotificationHandler:vi.fn(),addNotificationResponseReceivedListener:vi.fn(),
  addNotificationReceivedListener:vi.fn(),getLastNotificationResponseAsync:mocks.last,
  clearLastNotificationResponseAsync:mocks.clear,
}));
vi.mock('./communications-store',()=>({refreshCommunications:mocks.refresh}));
vi.mock('./supabase',()=>({isDemoActive:()=>false,supabase:{auth:{getSession:mocks.session,onAuthStateChange:vi.fn()}}}));

beforeEach(()=>{
  vi.resetModules();vi.resetAllMocks();
  globalThis.__fireOpsNotificationsStarted=false;
  mocks.last.mockResolvedValue(null);
  mocks.session.mockResolvedValue({data:{session:null}});
  mocks.open.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  vi.spyOn(console,'warn').mockImplementation(()=>{});
});

it('handles rejected native notification and secure-session restoration',async()=>{
  mocks.last.mockRejectedValue(new Error('native restoration failed'));
  mocks.session.mockRejectedValue(new Error('secure storage unavailable'));
  await import('./notifications');
  await vi.waitFor(()=>{
    expect(console.warn).toHaveBeenCalledWith('Notification response restoration failed:',expect.any(Error));
    expect(console.warn).toHaveBeenCalledWith('Notification session restoration failed:',expect.any(Error));
  });
});

it('handles rejected notification link and response cleanup at cold start',async()=>{
  mocks.last.mockResolvedValue({notification:{request:{content:{data:{path:'/communication/thread'}}}}});
  mocks.open.mockRejectedValue(new Error('link failed'));
  mocks.clear.mockRejectedValue(new Error('cleanup failed'));
  await import('./notifications');
  await vi.waitFor(()=>{
    expect(console.warn).toHaveBeenCalledWith('Notification link could not be opened:',expect.any(Error));
    expect(console.warn).toHaveBeenCalledWith('Notification response cleanup failed:',expect.any(Error));
  });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
