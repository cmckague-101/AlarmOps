import {describe,expect,it} from 'vitest';
import {fleetSummaryCounts,vehicleNeedsAttention} from './fleet-summary';

const now=new Date('2026-11-10T12:00:00Z');

describe('fleetSummaryCounts',()=>{
  it('counts total, ready, and needs attention (out of service or oil change due)',()=>{
    const vehicles=[
      {status:'Ready'},
      {status:'Ready',nextOilChangeDue:'2026-11-01'},
      {status:'Assigned'},
      {status:'Assigned',nextOilChangeDue:'2026-12-01'},
      {status:'Out of service',nextOilChangeDue:'2026-11-01'},
    ];
    expect(fleetSummaryCounts(vehicles,now)).toEqual({total:5,ready:2,needsAttention:2});
  });

  it('is zero for an empty fleet',()=>{
    expect(fleetSummaryCounts([],now)).toEqual({total:0,ready:0,needsAttention:0});
  });

  it('matches status regardless of case or spacing',()=>{
    expect(vehicleNeedsAttention({status:' out of service '},now)).toBe(true);
    expect(fleetSummaryCounts([{status:'ready'}],now).ready).toBe(1);
  });

  it('flags an oil change due today but not a future or invalid date',()=>{
    expect(vehicleNeedsAttention({status:'Ready',nextOilChangeDue:'2026-11-10'},now)).toBe(true);
    expect(vehicleNeedsAttention({status:'Ready',nextOilChangeDue:'2026-11-11'},now)).toBe(false);
    expect(vehicleNeedsAttention({status:'Ready',nextOilChangeDue:'soon'},now)).toBe(false);
  });
});
