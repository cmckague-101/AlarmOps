import {useCallback, useEffect, useState} from 'react';
import {addDismissedNotificationId, addDismissedNotificationIds} from './dismissedNotifications';

/**
 * Notifications cleared in this session, hidden immediately. Live workspaces also
 * clear them on the server (useDashboardInbox), which is what persists them; demo
 * mode keeps them in memory only.
 */
export function useDismissedNotifications(userId: string) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setDismissed(new Set());
  }, [userId]);

  const dismiss = useCallback((id: string) => {
    setDismissed((before) => addDismissedNotificationId(before, id));
  }, []);

  const dismissAll = useCallback((ids: Iterable<string>) => {
    setDismissed((before) => addDismissedNotificationIds(before, ids));
  }, []);

  return {dismissed, dismiss, dismissAll};
}
