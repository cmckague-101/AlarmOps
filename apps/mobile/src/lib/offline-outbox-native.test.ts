import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' }, open: vi.fn(), create: vi.fn(), close: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: mocks.open }));
vi.mock('./offline-outbox', () => ({ createOfflineOutbox: mocks.create }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.platform.OS = 'ios';
  mocks.close.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue({ closeAsync: mocks.close });
  mocks.create.mockResolvedValue({ activate: vi.fn(), pause: vi.fn() });
});

describe('native outbox entry point', () => {
  it('does not open storage or enable offline editing on web', async () => {
    mocks.platform.OS = 'web';
    const { getNativeOfflineOutbox } = await import('./offline-outbox-native');
    expect(() => getNativeOfflineOutbox()).toThrow(/only supported on iOS and Android/);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('lazily shares one initialized store on %s', async (platform) => {
    mocks.platform.OS = platform;
    const { getNativeOfflineOutbox } = await import('./offline-outbox-native');
    expect(mocks.open).not.toHaveBeenCalled();
    const first = getNativeOfflineOutbox();
    const second = getNativeOfflineOutbox();
    expect(first).toBe(second);
    expect(await first).toBe(await second);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith('fireops-sync.db');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('closes a failed initialization and allows a later retry', async () => {
    mocks.create.mockRejectedValueOnce(new Error('schema unavailable'));
    const { getNativeOfflineOutbox } = await import('./offline-outbox-native');
    await expect(getNativeOfflineOutbox()).rejects.toThrow('schema unavailable');
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await expect(getNativeOfflineOutbox()).resolves.toHaveProperty('activate');
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it('allows retry after a database-open failure', async () => {
    mocks.open.mockRejectedValueOnce(new Error('storage unavailable'));
    const { getNativeOfflineOutbox } = await import('./offline-outbox-native');
    await expect(getNativeOfflineOutbox()).rejects.toThrow('storage unavailable');
    expect(mocks.close).not.toHaveBeenCalled();
    await expect(getNativeOfflineOutbox()).resolves.toHaveProperty('activate');
  });
});
