import {describe, expect, it} from 'vitest';
import {seedAlarmBook, techTimesheet} from './alarm-ops';
import {addTimeOff, certificationState, placeJob, techTimeOff, unassignedJobs, updateFieldStatus, weekDates} from './field-service';

const TODAY = '2026-11-23';

describe('field service scheduling', () => {
  it('keeps an unassigned queue and places a job on a technician and day', () => {
    const book = seedAlarmBook();
    expect(unassignedJobs(book).map(job => job.id)).toEqual(['j-open']);
    const placed = placeJob(book, 'j-open', '2026-11-24', 't-lena');
    expect(placed.jobs.find(job => job.id === 'j-open')).toMatchObject({assignedTechId: 't-lena', scheduledOn: '2026-11-24'});
    expect(unassignedJobs(placed)).toEqual([]);
  });

  it('refuses to schedule a technician on a day they have off', () => {
    const book = seedAlarmBook();
    expect(techTimeOff(book, 't-priya', '2026-11-26')?.reason).toBe('Manufacturer training');
    expect(() => placeJob(book, 'j-coop', '2026-11-26', 't-priya')).toThrow(/off 2026-11-26/);
    const added = addTimeOff(book, {id: 'off-lena', techId: 't-lena', start: '2026-12-01', end: '2026-12-02', reason: 'Vacation'});
    expect(techTimeOff(added, 't-lena', '2026-12-02')?.reason).toBe('Vacation');
  });

  it('uses a Monday-Sunday week and the same overtime rule as payroll', () => {
    const book = seedAlarmBook();
    expect(weekDates(TODAY)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(techTimesheet(book.timeEntries, 't-chris').overtimeHours).toBe(8);
  });

  it('marks license expiry and advances field status from en route to complete', () => {
    const book = seedAlarmBook();
    expect(certificationState('2026-11-20', TODAY)).toBe('expired');
    expect(certificationState('2026-12-15', TODAY)).toBe('expiring');
    expect(certificationState('2027-04-30', TODAY)).toBe('current');
    let next = updateFieldStatus(book, 'j-open', 'en_route');
    expect(next.jobs.find(job => job.id === 'j-open')?.status).toBe('dispatched');
    next = updateFieldStatus(next, 'j-open', 'on_site');
    expect(next.jobs.find(job => job.id === 'j-open')?.status).toBe('in_progress');
    next = updateFieldStatus(next, 'j-open', 'complete');
    expect(next.jobs.find(job => job.id === 'j-open')?.status).toBe('complete');
  });
});
