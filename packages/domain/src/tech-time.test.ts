import {describe, expect, it} from 'vitest';
import {seedAlarmBook, weekHours} from './alarm-ops';
import {
  approveTimesheet, createMockQboTimeClient, demoTechTime, emptyTechTime, jobsVisibleTo, mapEmployee,
  punchesVisibleTo, queueApprovedSync, recordPunch, setPayrollItemsEnabled, syncApprovedTime, type TimePunch,
} from './tech-time';

const stamp = {latitude: 43.615, longitude: -116.202, notes: ''};

function punch(partial: Partial<TimePunch> & Pick<TimePunch, 'id' | 'kind' | 'at'>): TimePunch {
  return {techId: 't-chris', jobId: 'j-capitol', latitude: stamp.latitude, longitude: stamp.longitude, notes: '', ...partial};
}

describe('tech time punches', () => {
  it('turns a clock in, break, and clock out into one time entry', () => {
    let log = emptyTechTime();
    log = recordPunch(log, punch({id: 'p1', kind: 'in', at: '2026-11-23T08:00:00'})).log;
    log = recordPunch(log, punch({id: 'p2', kind: 'break_start', at: '2026-11-23T12:00:00'})).log;
    log = recordPunch(log, punch({id: 'p3', kind: 'break_end', at: '2026-11-23T12:30:00'})).log;
    const closed = recordPunch(log, punch({id: 'p4', kind: 'out', at: '2026-11-23T16:30:00', notes: 'Reader online'}));
    expect(closed.entry).toMatchObject({id: 'shift-p4', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-23', hours: 8, notes: 'Reader online'});
    expect(closed.log.punches[0]).toMatchObject({latitude: 43.615, longitude: -116.202});
  });

  it('lets a technician see only their jobs and punches', () => {
    const book = seedAlarmBook();
    expect(jobsVisibleTo(book, 'shop_tech', 't-chris').map(job => job.id)).toEqual(['j-capitol']);
    expect(jobsVisibleTo(book, 'owner', null).length).toBe(book.jobs.length);
    const log = recordPunch(emptyTechTime(), punch({id: 'p1', kind: 'in', at: '2026-11-23T08:00:00'})).log;
    const withLena = recordPunch(log, punch({id: 'p2', techId: 't-lena', jobId: 'j-ready', kind: 'in', at: '2026-11-23T09:00:00'})).log;
    expect(punchesVisibleTo(withLena, 'fire_fighter', 't-lena').map(item => item.id)).toEqual(['p2']);
    expect(punchesVisibleTo(withLena, 'admin', null)).toHaveLength(2);
  });
});

describe('QuickBooks time sync', () => {
  it('syncs an approved week once, without a payroll item, through the mock client', async () => {
    const book = seedAlarmBook();
    const week = weekHours(book.timeEntries, 't-chris', '2026-11-16');
    expect(week.overtimeHours).toBe(8);
    expect(demoTechTime().payrollItemsEnabled).toBe(false);
    const approved = approveTimesheet(demoTechTime(), 't-chris', week.start, 'Elena Voss', '2026-11-23T18:00:00');
    const pending = queueApprovedSync(approved, book);
    expect(pending.syncs.every(item => item.status === 'pending')).toBe(true);
    const mock = createMockQboTimeClient();
    const synced = await syncApprovedTime(pending, book, mock.client, true);
    expect(synced.syncs.every(item => item.status === 'synced' && item.qboTimeActivityId)).toBe(true);
    expect(mock.calls.every(call => call.payrollItemRef === undefined)).toBe(true);
    expect(mock.calls[0]).toMatchObject({employeeId: '56', customerRef: 'ALM-2201', date: '2026-11-16'});
    const again = await syncApprovedTime(synced, book, mock.client, true);
    expect(mock.calls).toHaveLength(synced.syncs.length);
    expect(again.syncs).toEqual(synced.syncs);
  });

  it('marks a missing employee or a disconnected company as failed, then retries', async () => {
    const book = seedAlarmBook();
    const week = weekHours(book.timeEntries, 't-lena', '2026-11-16');
    const approved = approveTimesheet(emptyTechTime(), 't-lena', week.start, 'Elena Voss', '2026-11-23T18:00:00');
    const mock = createMockQboTimeClient();
    const unmapped = await syncApprovedTime(approved, book, mock.client, true);
    expect(unmapped.syncs[0]).toMatchObject({status: 'failed', error: 'Map this technician to a QuickBooks employee.'});
    const mapped = mapEmployee(unmapped, {techId: 't-lena', qboEmployeeId: '55', qboEmployeeName: 'Lena Ortiz'});
    const offline = await syncApprovedTime(mapped, book, mock.client, false);
    expect(offline.syncs[0].error).toBe('QuickBooks is not connected in API keys.');
    const online = await syncApprovedTime(offline, book, mock.client, true);
    expect(online.syncs.every(item => item.status === 'synced')).toBe(true);
    expect(mock.calls.every(call => call.employeeId === '55' && !call.payrollItemRef)).toBe(true);
  });

  it('sends Regular and Overtime payroll items only when the Silver setting is on', async () => {
    const book = seedAlarmBook();
    const week = weekHours(book.timeEntries, 't-chris', '2026-11-16');
    const approved = setPayrollItemsEnabled(approveTimesheet(demoTechTime(), 't-chris', week.start, 'Elena Voss', '2026-11-23T18:00:00'), true);
    const mock = createMockQboTimeClient();
    const synced = await syncApprovedTime(approved, book, mock.client, true);
    const kinds = mock.calls.map(call => call.payrollItemRef);
    expect(kinds).toContain('Regular');
    expect(kinds).toContain('Overtime');
    expect(synced.syncs.filter(item => item.idempotencyKey.endsWith(':overtime')).every(item => item.status === 'synced')).toBe(true);
    const keys = mock.calls.map(call => call.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
