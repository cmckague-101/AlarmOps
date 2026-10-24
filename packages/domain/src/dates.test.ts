import {describe,expect,it} from 'vitest';
import {formatCalendarDate,formatCalendarRange} from './dates';

describe('calendar dates',()=>{
  it('formats stored dates without shifting the day',()=>{expect(formatCalendarDate('2026-10-01')).toBe(new Date(2026,9,1).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))});
  it('uses the fallback for empty or invalid dates',()=>{expect(formatCalendarDate('')).toBe('—');expect(formatCalendarDate('soon','')).toBe('')});
  it('drops the repeated year from a range in one year',()=>{expect(formatCalendarRange('2026-10-01','2026-10-21')).toBe(`${new Date(2026,9,1).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${formatCalendarDate('2026-10-21')}`)});
  it('keeps both years when a range crosses years',()=>{expect(formatCalendarRange('2026-12-25','2027-01-14')).toBe(`${formatCalendarDate('2026-12-25')} – ${formatCalendarDate('2027-01-14')}`)});
  it('shows the start date when the end is missing',()=>{expect(formatCalendarRange('2026-10-01','')).toBe(formatCalendarDate('2026-10-01'));expect(formatCalendarRange('','')).toBe('—')});
});
