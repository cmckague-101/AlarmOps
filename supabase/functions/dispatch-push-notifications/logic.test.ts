import {assertEquals, assertThrows} from 'jsr:@std/assert@1';
import {chunks, isInvalidTokenError, retryDelayMinutes} from './logic.ts';

Deno.test('chunks Expo requests at configured boundary', () => {
  assertEquals(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunks([], 100), []);
  assertThrows(() => chunks([1], 0), Error, 'positive integer');
});

Deno.test('backs failed jobs off exponentially with one-hour cap', () => {
  assertEquals([1, 2, 3, 4, 7, 8].map(retryDelayMinutes), [1, 2, 4, 8, 60, 60]);
});

Deno.test('only permanent unregistered-device errors disable tokens', () => {
  assertEquals(isInvalidTokenError('DeviceNotRegistered'), true);
  assertEquals(isInvalidTokenError('MessageTooBig'), false);
  assertEquals(isInvalidTokenError(undefined), false);
});
