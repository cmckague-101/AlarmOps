export type ShopJobPriority = 'critical' | 'high' | 'medium' | 'low';
export type ShopJobStatus = 'parts' | 'approval' | 'blocked' | 'progress' | 'queued' | 'ready' | 'done';
export type ShopJobKind = 'general' | 'fleet';

export const shopJobPriorities: ReadonlyArray<{ value: ShopJobPriority; label: string }> = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export const shopJobStatuses: ReadonlyArray<{ value: ShopJobStatus; label: string; blocker: boolean }> = [
  { value: 'parts', label: 'Waiting on parts', blocker: true },
  { value: 'approval', label: 'Waiting on approval', blocker: true },
  { value: 'blocked', label: 'Blocked', blocker: true },
  { value: 'progress', label: 'In progress', blocker: false },
  { value: 'queued', label: 'Not started', blocker: false },
  { value: 'ready', label: 'Ready for pickup', blocker: false },
  { value: 'done', label: 'Done', blocker: false },
];

/** Statuses a tech picks on the board; others still display if set elsewhere. */
export const shopBoardStatuses: ReadonlyArray<ShopJobStatus> = ['queued', 'progress', 'parts'];
export const shopBlockerStatuses: ReadonlyArray<ShopJobStatus> = ['parts', 'approval', 'blocked'];
/** Default reason saved when a job moves to Waiting on parts without one. */
export const SHOP_PARTS_BLOCKER = 'Waiting on parts';

export function isShopBlockerStatus(status: ShopJobStatus): boolean {
  return shopBlockerStatuses.includes(status);
}

export function shopPriorityLabel(priority: ShopJobPriority): string {
  return shopJobPriorities.find((item) => item.value === priority)?.label ?? priority;
}

export function shopStatusLabel(status: ShopJobStatus): string {
  return shopJobStatuses.find((item) => item.value === status)?.label ?? status;
}

/** Shop writers (owners, admins, shop techs) create and work shop jobs and file repairs. */
export function canWorkShop(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'shop_tech';
}

export type ShopJob = {
  id: string;
  companyId: string;
  jobNumber: string;
  title: string;
  description: string;
  priority: ShopJobPriority;
  status: ShopJobStatus;
  blockerReason?: string;
  kind: ShopJobKind;
  shopArea?: string;
  fleetVehicleId?: string;
  /** Set when the job was opened automatically for a fleet issue. */
  sourceFleetIssueId?: string;
  assignedTechId?: string;
  assignedTechName?: string;
  assignedAt?: string;
  location?: string;
  openedBy?: string;
  openedByName: string;
  openedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ShopJobNote = {
  id: string;
  companyId: string;
  jobId: string;
  body: string;
  kind: 'note' | 'system';
  statusSet?: ShopJobStatus;
  authorId?: string;
  authorName: string;
  createdAt: string;
};

export type ShopJobRow = {
  id: string; company_id: string; job_number: string; title: string; description: string | null;
  priority: ShopJobPriority; status: ShopJobStatus; blocker_reason: string | null; kind: ShopJobKind;
  shop_area: string | null; fleet_vehicle_id: string | null; source_fleet_issue_id: string | null;
  assigned_tech_id: string | null; assigned_tech_name: string | null; assigned_at: string | null;
  location: string | null; opened_by: string | null; opened_by_name: string; opened_at: string;
  created_at: string; updated_at: string;
};

export type ShopJobNoteRow = {
  id: string; company_id: string; job_id: string; body: string; kind: 'note' | 'system';
  status_set: ShopJobStatus | null; author_id: string | null; author_name: string; created_at: string;
};

export const SHOP_JOB_COLUMNS = 'id,company_id,job_number,title,description,priority,status,blocker_reason,kind,shop_area,fleet_vehicle_id,source_fleet_issue_id,assigned_tech_id,assigned_tech_name,assigned_at,location,opened_by,opened_by_name,opened_at,created_at,updated_at';
export const SHOP_JOB_NOTE_COLUMNS = 'id,company_id,job_id,body,kind,status_set,author_id,author_name,created_at';

const optional = (value: string | null | undefined) => (value === null || value === undefined || value === '' ? undefined : value);

export function shopJobFromRow(row: ShopJobRow): ShopJob {
  return {
    id: row.id, companyId: row.company_id, jobNumber: row.job_number, title: row.title, description: row.description ?? '',
    priority: row.priority, status: row.status, blockerReason: optional(row.blocker_reason), kind: row.kind,
    shopArea: optional(row.shop_area), fleetVehicleId: optional(row.fleet_vehicle_id), sourceFleetIssueId: optional(row.source_fleet_issue_id),
    assignedTechId: optional(row.assigned_tech_id), assignedTechName: optional(row.assigned_tech_name), assignedAt: optional(row.assigned_at),
    location: optional(row.location), openedBy: optional(row.opened_by), openedByName: row.opened_by_name, openedAt: row.opened_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function shopJobNoteFromRow(row: ShopJobNoteRow): ShopJobNote {
  return {
    id: row.id, companyId: row.company_id, jobId: row.job_id, body: row.body, kind: row.kind,
    statusSet: row.status_set ?? undefined, authorId: optional(row.author_id), authorName: row.author_name, createdAt: row.created_at,
  };
}

const priorityRank: Record<ShopJobPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const blockerRank = (status: ShopJobStatus) => (isShopBlockerStatus(status) ? 0 : 1);

/** Shared board sort: priority, then blockers first, then oldest opened_at. */
export function sortShopJobs<T extends Pick<ShopJob, 'priority' | 'status' | 'openedAt' | 'id'>>(jobs: readonly T[]): T[] {
  return [...jobs].sort((left, right) => {
    const byPriority = priorityRank[left.priority] - priorityRank[right.priority];
    if (byPriority !== 0) return byPriority;
    const byBlocker = blockerRank(left.status) - blockerRank(right.status);
    if (byBlocker !== 0) return byBlocker;
    const byOpened = Date.parse(left.openedAt) - Date.parse(right.openedAt);
    if (byOpened !== 0) return byOpened;
    return left.id.localeCompare(right.id);
  });
}

export function rankShopJobs<T extends Pick<ShopJob, 'priority' | 'status' | 'openedAt' | 'id'>>(jobs: readonly T[]): Array<T & { rank: number }> {
  return sortShopJobs(jobs).map((job, index) => ({ ...job, rank: index + 1 }));
}

export function validateShopJobBlocker(status: ShopJobStatus, blockerReason?: string): string | null {
  if (!isShopBlockerStatus(status)) return null;
  if (!blockerReason?.trim()) return 'Explain why this job cannot be worked.';
  return null;
}

export type ShopBoardFilter = 'open' | ShopJobStatus;

/** Open jobs matching a status filter and a search over title, area, unit, assignee and blocker. */
export function filterShopJobs<T extends ShopJob>(jobs: readonly T[], filter: ShopBoardFilter, query: string, unitFor: (job: T) => string | undefined): T[] {
  const needle = query.trim().toLowerCase();
  return jobs.filter((job) => {
    if (job.status === 'done') return false;
    if (filter !== 'open' && job.status !== filter) return false;
    if (!needle) return true;
    return [job.title, job.jobNumber, job.shopArea, unitFor(job), job.assignedTechName, job.blockerReason]
      .some((value) => value?.toLowerCase().includes(needle));
  });
}

export type ShopVehicleGroup<V> = { vehicle: V; jobs: ShopJob[]; openCount: number };

/** Units with open work, most open jobs first, then by unit name. */
export function groupShopJobsByVehicle<V extends { id: string; unit: string }>(vehicles: readonly V[], visibleJobs: readonly ShopJob[], allJobs: readonly ShopJob[]): ShopVehicleGroup<V>[] {
  return vehicles
    .map((vehicle) => ({
      vehicle,
      jobs: sortShopJobs(visibleJobs.filter((job) => job.kind === 'fleet' && job.fleetVehicleId === vehicle.id)),
      openCount: allJobs.filter((job) => job.status !== 'done' && job.kind === 'fleet' && job.fleetVehicleId === vehicle.id).length,
    }))
    .filter((group) => group.openCount > 0)
    .sort((a, b) => b.openCount - a.openCount || a.vehicle.unit.localeCompare(b.vehicle.unit));
}

/** Board status shown for a job; statuses outside the board set display as Not started. */
export function shopBoardStatus(status: ShopJobStatus): ShopJobStatus {
  return shopBoardStatuses.includes(status) ? status : status === 'done' ? 'done' : 'queued';
}

export type ShopStatusTone = { text: string; background: string };

/** Platform-agnostic status palette; web CSS mirrors these values. */
export function shopStatusPalette(mode: 'light' | 'dark'): Record<ShopJobStatus, ShopStatusTone> {
  if (mode === 'dark') {
    return {
      parts: { text: '#f0a93b', background: '#3a2c12' },
      approval: { text: '#b3a2f0', background: '#2a2340' },
      blocked: { text: '#ff7a66', background: '#3a1f1d' },
      progress: { text: '#6fa8e8', background: '#172b40' },
      queued: { text: '#b9c1ca', background: '#262d35' },
      ready: { text: '#5fc48a', background: '#173326' },
      done: { text: '#5fc48a', background: '#173326' },
    };
  }
  return {
    parts: { text: '#ad641e', background: '#fff0df' },
    approval: { text: '#6b4fa0', background: '#f0ebf8' },
    blocked: { text: '#a53d32', background: '#fae9e6' },
    progress: { text: '#32699b', background: '#e7f0f8' },
    queued: { text: '#647069', background: '#eef0ed' },
    ready: { text: '#26765a', background: '#e7f3ee' },
    done: { text: '#26765a', background: '#e7f3ee' },
  };
}

export function shopPriorityPalette(mode: 'light' | 'dark'): Record<ShopJobPriority, ShopStatusTone> {
  if (mode === 'dark') {
    return {
      critical: { text: '#ff7a66', background: '#3a1f1d' },
      high: { text: '#f0a93b', background: '#3a2c12' },
      medium: { text: '#b9c1ca', background: '#262d35' },
      low: { text: '#b9c1ca', background: '#262d35' },
    };
  }
  return {
    critical: { text: '#a53d32', background: '#fae9e6' },
    high: { text: '#ad641e', background: '#fff0df' },
    medium: { text: '#a97824', background: '#fff7e7' },
    low: { text: '#647069', background: '#eef0ed' },
  };
}
