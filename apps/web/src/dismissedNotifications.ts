export function addDismissedNotificationId(ids: Set<string>, id: string) {
  if (!id || ids.has(id)) return ids;
  const next = new Set(ids);
  next.add(id);
  return next;
}

export function addDismissedNotificationIds(ids: Set<string>, nextIds: Iterable<string>) {
  let changed = false;
  const next = new Set(ids);
  for (const id of nextIds) {
    if (!id || next.has(id)) continue;
    next.add(id);
    changed = true;
  }
  return changed ? next : ids;
}

export function filterDismissedNotifications<T extends {id: string}>(items: T[], dismissed: Set<string>) {
  return dismissed.size ? items.filter((item) => !dismissed.has(item.id)) : items;
}
