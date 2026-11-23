/**
 * Horizontal page-slide direction for the web shell.
 * Forward = new content enters from the right (iOS push).
 * Back = content enters from the left (iOS pop / leftward tab).
 */

export type PageSlideDirection = 'forward' | 'back';

/** Nested screens that slide back when returning to one of these parents. */
const nestedParents: Record<string, readonly string[]> = {
  'add-credential': ['qualifications'],
  'credential-detail': ['qualifications'],
  'qualification-experience': ['qualifications'],
  'experience-detail': ['qualifications'],
  'qualification-master-record': ['qualifications'],
  'qualification-card': ['qualifications'],
  'qualification-annual-records': ['qualifications'],
};

/**
 * Lateral order for tab-style moves.
 * Starts with the mobile primary tab bar (Operations → Fleet → Comms → News → Tools),
 * then the remaining sidebar destinations so left/right still feels directional.
 */
export const pageSlideOrder: readonly string[] = [
  'overview',
  'station',
  'customers',
  'jobs',
  'quotes',
  'compliance',
  'billing',
  'field-service',
  'vehicles',
  'communications',
  'news',
  'more',
  'hotels',
  'crew',
  'qualifications',
  'documents',
  'receipts',
  'invoices',
  'payroll',
  'availability',
  'training',
  'meetings',
  'inventory',
  'inspections',
  'readiness',
  'audit-log',
  'settings',
];

function slideIndex(page: string) {
  return pageSlideOrder.indexOf(page);
}

/** Whether `from` is a nested child that returns to `to`. */
export function isNestedReturn(from: string, to: string) {
  return (nestedParents[from] ?? []).includes(to);
}

/** Whether `to` is nested under `from`. */
export function isNestedPush(from: string, to: string) {
  return (nestedParents[to] ?? []).includes(from);
}

/**
 * Pick enter direction for a page change.
 * Primary-nav pairs use order; nested drill-ins push forward and returns go back.
 */
export function pageSlideDirection(from: string, to: string): PageSlideDirection {
  if (from === to) return 'forward';
  if (isNestedReturn(from, to)) return 'back';
  if (isNestedPush(from, to)) return 'forward';
  const fromIdx = slideIndex(from);
  const toIdx = slideIndex(to);
  if (fromIdx >= 0 && toIdx >= 0) return toIdx >= fromIdx ? 'forward' : 'back';
  // Leaving a nested/unknown screen for a primary page feels like popping.
  if (toIdx >= 0 && fromIdx < 0) return 'back';
  return 'forward';
}

export function pageStageClassName(direction: PageSlideDirection) {
  return `page-stage page-stage-${direction}`;
}
