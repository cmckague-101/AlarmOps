import { describe, expect, it } from 'vitest';
import { createPayrollRows, normalizePayrollDay, normalizePayrollRows, payrollCtrAttachments, payrollCrewTotals, payrollDayName, payrollTotals, updatePayrollCrew, updatePayrollDate } from '@fireops/domain';

describe('payroll helpers', () => {
  it('leaves dates empty until the first date is selected', () => {
    const emptyRows = createPayrollRows();
    expect(emptyRows.every(row => row.date === '' && row.ctr === null)).toBe(true);

    const datedRows = updatePayrollDate(emptyRows, 0, '2026-01-05');
    expect(datedRows[0].date).toBe('2026-01-05');
    expect(datedRows[20].date).toBe('2026-01-25');
  });

  it('creates 21 consecutive days and derives weekday', () => {
    const rows = createPayrollRows('2026-01-05');
    expect(rows).toHaveLength(21);
    expect(rows[20].date).toBe('2026-01-25');
    expect(payrollDayName(rows[0].date)).toBe('Monday');
  });

  it('moves selected date and all future dates', () => {
    const rows = updatePayrollDate(createPayrollRows('2026-01-05'), 10, '2026-03-01');
    expect(rows[9].date).toBe('2026-01-14');
    expect(rows[10].date).toBe('2026-03-01');
    expect(rows[20].date).toBe('2026-03-11');
  });

  it('copies crew to future rows', () => {
    const rows = updatePayrollCrew(createPayrollRows('2026-01-05'), 4, ['a', 'b', 'a']);
    expect(rows[3].crewIds).toEqual([]);
    expect(rows[4].crewIds).toEqual(['a', 'b']);
    expect(rows[20].crewIds).toEqual(['a', 'b']);
  });

  it('calculates overtime independently for Monday-Sunday weeks', () => {
    const rows = createPayrollRows('2026-01-05').map((row, index) => ({ ...row, hoursWorked: index < 7 ? 8 : index < 14 ? 10 : 0 }));
    expect(payrollTotals(rows)).toEqual({ totalDays: 14, totalHours: 126, regularHours: 80, overtimeHours: 46 });
  });

  it('calculates hours and days independently for each crew member', () => {
    const rows = createPayrollRows('2026-01-05').map((row, index) => ({
      ...row,
      hoursWorked: index < 5 ? 10 : 0,
      crewIds: index < 3 ? ['a', 'b'] : index < 5 ? ['a'] : [],
    }));

    expect(payrollCrewTotals(rows)).toEqual([
      { crewId: 'a', totalDays: 5, totalHours: 50, regularHours: 40, overtimeHours: 10 },
      { crewId: 'b', totalDays: 3, totalHours: 30, regularHours: 30, overtimeHours: 0 },
    ]);
  });

  it('defaults missing CTR fields to null on legacy rows', () => {
    expect(normalizePayrollDay({date:'2026-01-05',hoursWorked:4,crewIds:[],notes:''}).ctr).toBeNull();
  });

  it('pads short row lists and collects CTR photos for cleanup', () => {
    const photo = { name: 'ctr.jpg', mimeType: 'image/jpeg', byteSize: 10, storagePath: 'c/u/forms/f/ctr.jpg' };
    const rows = normalizePayrollRows([{ date: '2026-01-05', hoursWorked: 8, crewIds: [], notes: '', ctr: photo }]);
    expect(rows).toHaveLength(21);
    expect(payrollCtrAttachments(rows)).toEqual([photo]);
  });
});
