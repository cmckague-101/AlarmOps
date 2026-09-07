import {describe, expect, it} from 'vitest';
import {
  chunks,
  isInvalidTokenError,
  retryDelayMinutes,
} from '../../../supabase/functions/dispatch-push-notifications/logic';

describe('push dispatcher', () => {
  it('chunks Expo requests at configured boundary', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 100)).toEqual([]);
    expect(() => chunks([1], 0)).toThrow('positive integer');
  });

  it('backs failed jobs off exponentially with one-hour cap', () => {
    expect([1, 2, 3, 4, 7, 8].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 60, 60]);
  });

  it('only disables permanently unregistered device tokens', () => {
    expect(isInvalidTokenError('DeviceNotRegistered')).toBe(true);
    expect(isInvalidTokenError('MessageTooBig')).toBe(false);
    expect(isInvalidTokenError(undefined)).toBe(false);
  });
});
