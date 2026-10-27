import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  open:vi.fn(),exec:vi.fn(),close:vi.fn(),read:vi.fn(),write:vi.fn(),
}));
vi.mock('react-native',()=>({Platform:{OS:'android'}}));
vi.mock('expo-sqlite',()=>({openDatabaseAsync:mocks.open}));

beforeEach(()=>{
  vi.resetModules();
  vi.resetAllMocks();
  mocks.open.mockResolvedValue({execAsync:mocks.exec,closeAsync:mocks.close,getFirstAsync:mocks.read,runAsync:mocks.write});
  mocks.exec.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  vi.spyOn(console,'warn').mockImplementation(()=>{});
});

describe('optional startup read cache',()=>{
  it('does not open SQLite for signed-out HTTP requests',async()=>{
    const cache=await import('./offline-cache');
    await expect(cache.loadReadResponse('GET /test')).resolves.toBeNull();
    await cache.storeReadResponse('GET /test',new Response('ok'));
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('allows online access when the database cannot open and retries later',async()=>{
    mocks.open.mockRejectedValueOnce(new Error('disk unavailable'));
    mocks.read.mockResolvedValue({value:'{"kind":"admin"}',verified_at:'today'});
    const cache=await import('./offline-cache');
    await expect(cache.loadAccountAccess('user')).resolves.toBeNull();
    await expect(cache.loadAccountAccess('user')).resolves.toEqual({value:{kind:'admin'},verifiedAt:'today'});
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it('closes failed schema initialization and permits retry without deleting data',async()=>{
    mocks.exec.mockRejectedValueOnce(new Error('database locked'));
    const cache=await import('./offline-cache');
    await expect(cache.loadAccountAccess('user')).resolves.toBeNull();
    expect(mocks.close).toHaveBeenCalledOnce();
    await cache.loadAccountAccess('user');
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it('does not reject fire-and-forget account cache writes',async()=>{
    const cache=await import('./offline-cache');
    mocks.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(cache.storeAccountAccess('user',{kind:'admin'})).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith('Account access cache write failed',expect.any(Error));
  });

  it('handles cache read failures and malformed cached JSON',async()=>{
    const cache=await import('./offline-cache');
    mocks.read.mockRejectedValueOnce(new Error('read failed'));
    await expect(cache.loadAccountAccess('user')).resolves.toBeNull();
    mocks.read.mockResolvedValueOnce({value:'broken json',verified_at:'today'});
    await expect(cache.loadAccountAccess('user')).resolves.toBeNull();
    cache.setOfflineCacheUser('user');
    mocks.read.mockRejectedValueOnce(new Error('read failed'));
    await expect(cache.loadReadResponse('GET /test')).resolves.toBeNull();
  });

  it('preserves successful account cache writes and reads',async()=>{
    const cache=await import('./offline-cache');
    await cache.storeAccountAccess('user',{kind:'admin'});
    expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE'),'user','{"kind":"admin"}',expect.any(String));
    mocks.read.mockResolvedValueOnce({value:'{"kind":"admin"}',verified_at:'today'});
    expect(await cache.loadAccountAccess('user')).toEqual({value:{kind:'admin'},verifiedAt:'today'});
  });
});
