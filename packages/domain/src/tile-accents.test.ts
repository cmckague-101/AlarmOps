import {describe,expect,it} from 'vitest';
import {failedInspectionCount,isUrgentCommandCard,overdueTaskCount} from './tile-accents';

describe('tile accents',()=>{
  it('marks only incidents and Needs Attention with rows as urgent',()=>{
    expect(isUrgentCommandCard({id:'incidents',rows:[1]})).toBe(true);
    expect(isUrgentCommandCard({id:'attention',rows:[1]})).toBe(true);
    expect(isUrgentCommandCard({id:'attention',rows:[]})).toBe(false);
    expect(isUrgentCommandCard({id:'personnel',rows:[1]})).toBe(false);
    expect(isUrgentCommandCard({id:'resources',rows:[1]})).toBe(false);
  });
  it('counts tasks due before today as overdue',()=>{
    const today=new Date(2026,10,9,9);
    expect(overdueTaskCount(['2026-11-08','2026-11-09','2026-11-10','2025-01-01'],today)).toBe(2);
    expect(overdueTaskCount([],today)).toBe(0);
  });
  it('counts this year\'s failed inspections and skips hidden ones',()=>{
    const inspection=(id:string,createdAt:string,result:string)=>({id,createdAt,items:[{result:'Pass'},{result}]});
    const vehicles=[{inspections:[inspection('a','2026-03-01T12:00:00Z','Fail'),inspection('b','2026-04-01T12:00:00Z','Pass'),inspection('c','2025-06-01T12:00:00Z','Fail')]},{inspections:[inspection('d','2026-05-01T12:00:00Z','Fail')]},{}];
    expect(failedInspectionCount(vehicles,2026)).toBe(2);
    expect(failedInspectionCount(vehicles,2026,id=>id==='d')).toBe(1);
    expect(failedInspectionCount(vehicles,2025)).toBe(1);
  });
});
