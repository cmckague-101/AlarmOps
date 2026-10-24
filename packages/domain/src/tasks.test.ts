import {describe,expect,it} from 'vitest';
import {taskDueStatus} from './tasks';

describe('taskDueStatus',()=>{
  const today=new Date(2026,9,24,23,30);
  it('marks earlier dates overdue',()=>expect(taskDueStatus('2026-10-23',today)).toBe('overdue'));
  it('treats the local calendar day as today, even late in the evening',()=>expect(taskDueStatus('2026-10-24',today)).toBe('today'));
  it('marks later dates upcoming',()=>expect(taskDueStatus('2026-11-01',today)).toBe('upcoming'));
});
