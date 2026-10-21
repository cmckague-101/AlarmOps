import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({platform:{OS:'ios'},alert:vi.fn(),open:vi.fn(),count:vi.fn()}));
vi.mock('react-native',()=>({Platform:mocks.platform,Alert:{alert:mocks.alert}}));
vi.mock('./offline-outbox-native',()=>({getNativeOfflineOutbox:mocks.open}));
import {prepareOfflineSyncSignOut} from './offline-sync-sign-out';
import {offlineSyncSessionPaused,pauseOfflineSyncForSignOut,registerOfflineSyncSession} from './offline-sync-session';
beforeEach(()=>{vi.resetAllMocks();mocks.platform.OS='ios';mocks.open.mockResolvedValue({countUnresolvedForUser:mocks.count});mocks.count.mockResolvedValue(0)});
describe('native saved-work sign-out guard',()=>{
  it('does not add offline storage behavior to web',async()=>{
    mocks.platform.OS='web';expect(await prepareOfflineSyncSignOut('user',async()=>true)).toBe(true);expect(mocks.open).not.toHaveBeenCalled();
  });
  it('does not warn or read another account after an identity change',async()=>{
    expect(await prepareOfflineSyncSignOut('user',async()=>false)).toBe(false);expect(mocks.open).not.toHaveBeenCalled();
    const current=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);mocks.count.mockResolvedValue(3);
    expect(await prepareOfflineSyncSignOut('user',current)).toBe(false);expect(mocks.alert).not.toHaveBeenCalled();
  });
  it('allows sign-out without a warning when all that user’s companies are settled',async()=>{
    expect(await prepareOfflineSyncSignOut('user',async()=>true)).toBe(true);expect(mocks.count).toHaveBeenCalledWith('user');expect(mocks.alert).not.toHaveBeenCalled();
  });
  it('requires explicit account-bound retention and respects cancel',async()=>{
    mocks.count.mockResolvedValue(2);const leaving=prepareOfflineSyncSignOut('user',async()=>true);
    await vi.waitFor(()=>expect(mocks.alert).toHaveBeenCalledTimes(1));expect(mocks.alert.mock.calls[0][1]).toContain('no server backup');
    mocks.alert.mock.calls[0][2][0].onPress();expect(await leaving).toBe(false);
    const accepted=prepareOfflineSyncSignOut('user',async()=>true);await vi.waitFor(()=>expect(mocks.alert).toHaveBeenCalledTimes(2));
    expect(mocks.alert.mock.calls[1][2][1].text).toBe('Keep work & sign out');mocks.alert.mock.calls[1][2][1].onPress();expect(await accepted).toBe(true);
  });
  it('rechecks identity after confirmation and never logs out a replacement account',async()=>{
    mocks.count.mockResolvedValue(1);let same=true;const leaving=prepareOfflineSyncSignOut('user',async()=>same);
    await vi.waitFor(()=>expect(mocks.alert).toHaveBeenCalledTimes(1));same=false;mocks.alert.mock.calls[0][2][1].onPress();expect(await leaving).toBe(false);
  });
  it('does not force users to stay signed in when sync storage is unavailable',async()=>{
    mocks.open.mockRejectedValue(new Error('Storage unavailable'));const leaving=prepareOfflineSyncSignOut('user',async()=>true);
    await vi.waitFor(()=>expect(mocks.alert).toHaveBeenCalledTimes(1));expect(mocks.alert.mock.calls[0][0]).toBe('Sync status unavailable');
    expect(mocks.alert.mock.calls[0][2][1].text).toBe('Sign out anyway');mocks.alert.mock.calls[0][2][1].onPress();expect(await leaving).toBe(true);
  });
});
describe('scoped worker sign-out pause lifecycle',()=>{
  it('pauses until every sign-out attempt is finished and cannot resume another account',()=>{
    const pause=vi.fn(),resume=vi.fn();const unregister=registerOfflineSyncSession('first',{pause,resume});
    const one=pauseOfflineSyncForSignOut('first'),two=pauseOfflineSyncForSignOut('first');expect(pause).toHaveBeenCalledTimes(1);expect(offlineSyncSessionPaused('first')).toBe(true);
    one();one();expect(offlineSyncSessionPaused('first')).toBe(true);two();expect(resume).toHaveBeenCalledTimes(1);
    const late=pauseOfflineSyncForSignOut('first');const secondResume=vi.fn();const unregisterSecond=registerOfflineSyncSession('second',{pause:vi.fn(),resume:secondResume});
    unregister();late();expect(secondResume).not.toHaveBeenCalled();expect(offlineSyncSessionPaused('second')).toBe(false);unregisterSecond();
  });
});
