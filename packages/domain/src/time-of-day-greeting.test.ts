import {describe,expect,it} from 'vitest';
import {getTimeOfDayGreeting} from './time-of-day-greeting';

describe('getTimeOfDayGreeting',()=>{
  it('switches at noon and 5 PM local time',()=>{
    const at=(hour:number,minute=0)=>new Date(2026,10,10,hour,minute);
    expect(getTimeOfDayGreeting(at(0))).toBe('Good Morning');
    expect(getTimeOfDayGreeting(at(11,59))).toBe('Good Morning');
    expect(getTimeOfDayGreeting(at(12))).toBe('Good Afternoon');
    expect(getTimeOfDayGreeting(at(16,59))).toBe('Good Afternoon');
    expect(getTimeOfDayGreeting(at(17))).toBe('Good Evening');
  });
});
