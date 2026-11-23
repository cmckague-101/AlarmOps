import {AlarmOpsError, addCalendarDays, transitionJob, workweekStart, type AlarmBook, type AlarmJob, type JobStatus} from './alarm-ops';

/** Field words for the existing job pipeline: en route, on site, then complete. */
export type FieldStatus = 'en_route' | 'on_site' | 'complete';

const FIELD_TARGET: Record<FieldStatus, JobStatus> = {
  en_route: 'dispatched',
  on_site: 'in_progress',
  complete: 'complete',
};

export const fieldStatusLabel: Record<FieldStatus, string> = {
  en_route: 'En route',
  on_site: 'On site',
  complete: 'Complete',
};

export function unassignedJobs(book: AlarmBook) {
  return book.jobs.filter(job => !job.assignedTechId && job.status !== 'complete' && job.status !== 'invoiced');
}

export function jobsOn(book: AlarmBook, techId: string, date: string) {
  return book.jobs.filter(job => job.assignedTechId === techId && job.scheduledOn === date);
}

export function weekDates(anyDate: string) {
  const start = workweekStart(anyDate);
  return Array.from({length: 7}, (_, index) => addCalendarDays(start, index));
}

export function techTimeOff(book: AlarmBook, techId: string, date: string) {
  return (book.timeOff ?? []).find(item => item.techId === techId && item.start <= date && date <= item.end);
}

export function certificationState(expiresOn: string, today: string): 'current' | 'expiring' | 'expired' {
  if (expiresOn < today) return 'expired';
  const limit = addCalendarDays(today, 30);
  return expiresOn <= limit ? 'expiring' : 'current';
}

export function placeJob(book: AlarmBook, jobId: string, scheduledOn: string, techId: string): AlarmBook {
  const job = book.jobs.find(item => item.id === jobId);
  if (!job) throw new AlarmOpsError('Job was not found.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledOn)) throw new AlarmOpsError('Choose a schedule date.');
  if (techId) {
    const tech = book.techs.find(item => item.id === techId);
    if (!tech) throw new AlarmOpsError('Technician was not found.');
    const off = techTimeOff(book, techId, scheduledOn);
    if (off) throw new AlarmOpsError(`${tech.name} is off ${scheduledOn}${off.reason ? ` (${off.reason})` : ''}.`);
  }
  const moved: AlarmJob = {...job, scheduledOn, assignedTechId: techId};
  return {...book, jobs: book.jobs.map(item => item.id === jobId ? moved : item)};
}

export function updateFieldStatus(book: AlarmBook, jobId: string, status: FieldStatus) {
  return transitionJob(book, jobId, FIELD_TARGET[status]);
}

export function addTimeOff(book: AlarmBook, entry: AlarmBook['timeOff'][number]): AlarmBook {
  if (!book.techs.some(tech => tech.id === entry.techId)) throw new AlarmOpsError('Technician was not found.');
  if (!entry.reason.trim()) throw new AlarmOpsError('Add a reason for the time off.');
  if (entry.end < entry.start) throw new AlarmOpsError('Time off must end on or after it starts.');
  return {...book, timeOff: [entry, ...(book.timeOff ?? [])]};
}

export function availableFieldActions(status: JobStatus): FieldStatus[] {
  if (status === 'scheduled') return ['en_route', 'on_site'];
  if (status === 'dispatched') return ['on_site'];
  if (status === 'in_progress') return ['complete'];
  return [];
}
