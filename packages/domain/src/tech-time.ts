import {roundMoney, type AlarmBook, type TimeEntry} from './alarm-ops';
import type {UserRole} from './models';

/**
 * Field punches become timesheet rows. Approved rows sync to QuickBooks TimeActivity
 * once, using an idempotency key. Payroll item mapping (Regular vs Overtime) stays off
 * unless the company turns on Intuit's Premium Silver setting.
 */

export type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';
export type TimeActivityStatus = 'pending' | 'synced' | 'failed';

export type TimePunch = {
  id: string;
  techId: string;
  jobId: string;
  kind: PunchKind;
  at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string;
};

export type TimesheetApproval = {
  id: string;
  techId: string;
  weekStart: string;
  approvedBy: string;
  approvedAt: string;
};

export type TimeSync = {
  entryId: string;
  idempotencyKey: string;
  status: TimeActivityStatus;
  qboTimeActivityId: string;
  error: string;
};

export type EmployeeMapping = {techId: string; qboEmployeeId: string; qboEmployeeName: string};

export type TechTimeLog = {
  punches: TimePunch[];
  approvals: TimesheetApproval[];
  syncs: TimeSync[];
  employees: EmployeeMapping[];
  /** Intuit Premium Silver. Off by default, so TimeActivity records omit PayrollItemRef. */
  payrollItemsEnabled: boolean;
};

export type QboTimeActivity = {
  idempotencyKey: string;
  employeeId: string;
  customerRef: string;
  hours: number;
  date: string;
  description: string;
  payrollItemRef?: 'Regular' | 'Overtime';
};

export interface QboTimeClient {
  createTimeActivity(activity: QboTimeActivity): Promise<{id: string}>;
}

export class TechTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TechTimeError';
  }
}

export function emptyTechTime(): TechTimeLog {
  return {punches: [], approvals: [], syncs: [], employees: [], payrollItemsEnabled: false};
}

/** Demo QuickBooks employees. Payroll item mapping stays off. */
export function demoTechTime(): TechTimeLog {
  return mapEmployee(mapEmployee(mapEmployee(emptyTechTime(), {techId: 't-lena', qboEmployeeId: '55', qboEmployeeName: 'Lena Ortiz'}), {techId: 't-chris', qboEmployeeId: '56', qboEmployeeName: 'Chris Hale'}), {techId: 't-priya', qboEmployeeId: '57', qboEmployeeName: 'Priya Shah'});
}

export function techIdForViewer(book: AlarmBook, name: string) {
  return book.techs.find(tech => tech.name === name)?.id ?? null;
}

export function normalizeTechTime(value: unknown): TechTimeLog {
  if (!value || typeof value !== 'object') return emptyTechTime();
  const record = value as Partial<TechTimeLog>;
  return {
    punches: Array.isArray(record.punches) ? record.punches : [],
    approvals: Array.isArray(record.approvals) ? record.approvals : [],
    syncs: Array.isArray(record.syncs) ? record.syncs : [],
    employees: Array.isArray(record.employees) ? record.employees : [],
    payrollItemsEnabled: record.payrollItemsEnabled === true,
  };
}

export function isFieldTechnician(role: UserRole) {
  return role === 'shop_tech' || role === 'fire_fighter';
}

export function canApproveTimesheets(role: UserRole) {
  return role === 'owner' || role === 'admin';
}

export function jobsVisibleTo(book: AlarmBook, role: UserRole, techId: string | null) {
  if (!isFieldTechnician(role)) return book.jobs;
  return book.jobs.filter(job => job.assignedTechId === techId);
}

export function punchesVisibleTo(log: TechTimeLog, role: UserRole, techId: string | null) {
  if (!isFieldTechnician(role)) return log.punches;
  return log.punches.filter(punch => punch.techId === techId);
}

export function shiftState(log: TechTimeLog, techId: string) {
  const punches = log.punches.filter(punch => punch.techId === techId).sort((a, b) => a.at.localeCompare(b.at));
  let openIn: TimePunch | null = null;
  let onBreak = false;
  for (const punch of punches) {
    if (punch.kind === 'in') {
      openIn = punch;
      onBreak = false;
    }
    if (punch.kind === 'out') openIn = null;
    if (punch.kind === 'break_start' && openIn) onBreak = true;
    if (punch.kind === 'break_end') onBreak = false;
  }
  return {clockedIn: Boolean(openIn), onBreak, jobId: openIn?.jobId ?? '', since: openIn?.at ?? ''};
}

export function recordPunch(log: TechTimeLog, punch: TimePunch): {log: TechTimeLog; entry: TimeEntry | null} {
  const state = shiftState(log, punch.techId);
  if (punch.kind === 'in' && state.clockedIn) throw new TechTimeError('Clock out before starting another shift.');
  if (punch.kind === 'out' && !state.clockedIn) throw new TechTimeError('Clock in before clocking out.');
  if (punch.kind === 'break_start' && (!state.clockedIn || state.onBreak)) throw new TechTimeError('Start a break only while clocked in.');
  if (punch.kind === 'break_end' && !state.onBreak) throw new TechTimeError('Start a break before ending it.');
  const next = {...log, punches: [...log.punches, punch]};
  if (punch.kind !== 'out') return {log: next, entry: null};
  return {log: next, entry: closeShift(next, punch)};
}

export function approveTimesheet(log: TechTimeLog, techId: string, weekStart: string, approvedBy: string, approvedAt: string): TechTimeLog {
  if (log.approvals.some(item => item.techId === techId && item.weekStart === weekStart)) return log;
  return {...log, approvals: [...log.approvals, {id: `approve-${techId}-${weekStart}`, techId, weekStart, approvedBy, approvedAt}]};
}

export function queueApprovedSync(log: TechTimeLog, book: AlarmBook): TechTimeLog {
  let syncs = [...log.syncs];
  for (const approval of log.approvals) {
    const weekEntries = book.timeEntries
      .filter(entry => entry.techId === approval.techId && weekStartOf(entry.date) === approval.weekStart)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let used = 0;
    for (const entry of weekEntries) {
      for (const piece of activitiesFor(entry, used, log.payrollItemsEnabled)) {
        if (!syncs.some(item => item.idempotencyKey === piece.idempotencyKey)) {
          syncs = upsertSync(syncs, {entryId: entry.id, idempotencyKey: piece.idempotencyKey, status: 'pending', qboTimeActivityId: '', error: ''});
        }
      }
      used = roundMoney(used + entry.hours);
    }
  }
  return {...log, syncs};
}

export function mapEmployee(log: TechTimeLog, mapping: EmployeeMapping): TechTimeLog {
  if (!mapping.qboEmployeeId.trim() || !mapping.qboEmployeeName.trim()) throw new TechTimeError('Choose a QuickBooks employee.');
  return {...log, employees: [...log.employees.filter(item => item.techId !== mapping.techId), {techId: mapping.techId, qboEmployeeId: mapping.qboEmployeeId.trim(), qboEmployeeName: mapping.qboEmployeeName.trim()}]};
}

export function setPayrollItemsEnabled(log: TechTimeLog, enabled: boolean): TechTimeLog {
  return {...log, payrollItemsEnabled: enabled};
}

export async function syncApprovedTime(log: TechTimeLog, book: AlarmBook, client: QboTimeClient, quickBooksConnected: boolean): Promise<TechTimeLog> {
  let syncs = [...log.syncs];
  for (const approval of log.approvals) {
    const weekEntries = book.timeEntries
      .filter(entry => entry.techId === approval.techId && weekStartOf(entry.date) === approval.weekStart)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let used = 0;
    for (const entry of weekEntries) {
      const pieces = activitiesFor(entry, used, log.payrollItemsEnabled);
      used = roundMoney(used + entry.hours);
      for (const piece of pieces) {
        const existing = syncs.find(item => item.idempotencyKey === piece.idempotencyKey);
        if (existing?.status === 'synced') continue;
        const employee = log.employees.find(item => item.techId === entry.techId);
        const job = book.jobs.find(item => item.id === entry.jobId);
        const customer = job ? book.customers.find(item => item.id === job.customerId) : undefined;
        const base = {entryId: entry.id, idempotencyKey: piece.idempotencyKey, qboTimeActivityId: '', error: ''};
        if (!quickBooksConnected) {
          syncs = upsertSync(syncs, {...base, status: 'failed', error: 'QuickBooks is not connected in API keys.'});
          continue;
        }
        if (!employee) {
          syncs = upsertSync(syncs, {...base, status: 'failed', error: 'Map this technician to a QuickBooks employee.'});
          continue;
        }
        try {
          const created = await client.createTimeActivity({
            idempotencyKey: piece.idempotencyKey,
            employeeId: employee.qboEmployeeId,
            customerRef: customer?.accountNumber ?? '',
            hours: piece.hours,
            date: entry.date,
            description: entry.notes || job?.title || 'Field time',
            ...(piece.payrollItemRef ? {payrollItemRef: piece.payrollItemRef} : {}),
          });
          syncs = upsertSync(syncs, {...base, status: 'synced', qboTimeActivityId: created.id});
        } catch {
          syncs = upsertSync(syncs, {...base, status: 'failed', error: 'QuickBooks did not accept the time activity.'});
        }
      }
    }
  }
  return {...log, syncs};
}

export function createMockQboTimeClient(failKeys: string[] = []) {
  const sent = new Map<string, {id: string}>();
  const calls: QboTimeActivity[] = [];
  const client: QboTimeClient = {
    async createTimeActivity(activity) {
      const existing = sent.get(activity.idempotencyKey);
      if (existing) return existing;
      if (failKeys.includes(activity.idempotencyKey)) throw new Error('mock reject');
      calls.push(activity);
      const created = {id: `qbo-${sent.size + 1}`};
      sent.set(activity.idempotencyKey, created);
      return created;
    },
  };
  return {client, calls, sent};
}

function activitiesFor(entry: TimeEntry, used: number, payrollItems: boolean) {
  if (!payrollItems) return [{hours: entry.hours, idempotencyKey: `time:${entry.id}`, payrollItemRef: undefined as 'Regular' | 'Overtime' | undefined}];
  const regular = roundMoney(Math.min(entry.hours, Math.max(0, 40 - used)));
  const overtime = roundMoney(entry.hours - regular);
  return [
    {hours: regular, idempotencyKey: `time:${entry.id}:regular`, payrollItemRef: 'Regular' as const},
    {hours: overtime, idempotencyKey: `time:${entry.id}:overtime`, payrollItemRef: 'Overtime' as const},
  ].filter(piece => piece.hours > 0);
}

function closeShift(log: TechTimeLog, out: TimePunch): TimeEntry {
  const punches = log.punches.filter(punch => punch.techId === out.techId && punch.at <= out.at).sort((a, b) => a.at.localeCompare(b.at));
  const start = [...punches].reverse().find(punch => punch.kind === 'in' && punch.at < out.at);
  if (!start) throw new TechTimeError('Clock in before clocking out.');
  let breakMs = 0;
  let breakStart = '';
  for (const punch of punches) {
    if (punch.at < start.at || punch.at > out.at) continue;
    if (punch.kind === 'break_start') breakStart = punch.at;
    if (punch.kind === 'break_end' && breakStart) {
      breakMs += Date.parse(punch.at) - Date.parse(breakStart);
      breakStart = '';
    }
  }
  const hours = roundMoney((Date.parse(out.at) - Date.parse(start.at) - breakMs) / 3_600_000);
  if (!(hours > 0) || hours > 24) throw new TechTimeError('That shift is outside 0 to 24 hours.');
  return {id: `shift-${out.id}`, techId: out.techId, jobId: start.jobId || undefined, date: start.at.slice(0, 10), hours, notes: out.notes || 'Clocked shift'};
}

function weekStartOf(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function upsertSync(syncs: TimeSync[], next: TimeSync) {
  return [...syncs.filter(item => item.idempotencyKey !== next.idempotencyKey), next];
}
