import {afterEach, describe, expect, it, vi} from 'vitest';

const runtime = await vi.hoisted(async () => {
  const {createHookRuntime} = await import('../../../packages/domain/test-fixtures/hook-runtime');
  return createHookRuntime();
});
vi.mock('react', () => runtime.hooks);

import {useDismissedNotifications} from './useDismissedNotifications';

const cleanups: (() => void)[] = [];
function hook<T>(fn: () => T) {
  const frame = runtime.frame();
  cleanups.push(() => {
    for (const slot of frame.slots) slot.cleanup?.();
  });
  return {
    render() {
      runtime.enter(frame);
      return fn();
    },
    effects() {
      for (const index of [...frame.effects]) {
        frame.effects.delete(index);
        const slot = frame.slots[index];
        slot.cleanup?.();
        slot.cleanup = slot.effect?.() ?? undefined;
      }
    },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('useDismissedNotifications', () => {
  it('hides cleared notifications for this session', () => {
    const f = hook(() => useDismissedNotifications('user-1'));
    f.render().dismiss('notice-1');
    f.render().dismissAll(['notice-2', 'notice-3']);
    expect([...f.render().dismissed].sort()).toEqual(['notice-1', 'notice-2', 'notice-3']);
  });

  it('starts empty for a different user', () => {
    let userId = 'user-1';
    const f = hook(() => useDismissedNotifications(userId));
    f.render();
    f.effects();
    f.render().dismiss('notice-1');
    userId = 'user-2';
    f.render();
    f.effects();
    expect([...f.render().dismissed]).toEqual([]);
  });
});
