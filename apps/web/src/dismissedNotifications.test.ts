import {describe, expect, it} from 'vitest';
import {
  addDismissedNotificationId,
  addDismissedNotificationIds,
  filterDismissedNotifications,
} from './dismissedNotifications';

describe('dismissedNotifications', () => {
  it('adds one or many ids without duplicating', () => {
    const first = addDismissedNotificationId(new Set(['a']), 'b');
    expect([...first].sort()).toEqual(['a', 'b']);
    expect(addDismissedNotificationId(first, 'b')).toBe(first);
    const many = addDismissedNotificationIds(first, ['b', 'c', '']);
    expect([...many].sort()).toEqual(['a', 'b', 'c']);
    expect(addDismissedNotificationIds(many, ['a', 'b'])).toBe(many);
  });

  it('filters visible notifications', () => {
    const dismissed = new Set(['notice-1', 'notice-2']);
    expect(filterDismissedNotifications([
      {id: 'notice-1'},
      {id: 'notice-3'},
      {id: 'notice-2'},
    ], dismissed)).toEqual([{id: 'notice-3'}]);
    expect(filterDismissedNotifications([{id: 'notice-3'}], new Set())).toEqual([{id: 'notice-3'}]);
  });
});
