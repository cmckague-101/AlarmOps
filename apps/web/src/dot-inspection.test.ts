import {describe,expect,it} from 'vitest';
import {dotInspectionWarning,commandAlerts,inspectionExpirationDate,inspectionReminderDate,localDateToday} from '@fireops/domain';

const vehicle=(inspectionDate?:string)=>({id:'engine',unit:'Engine 1',status:'Ready',documents:[{id:'dotInspection',name:'DOT Inspection',inspectionDate}]});
const alerts=(date:string,inspectionDate='2025-07-15')=>commandAlerts([vehicle(inspectionDate)],[],[],new Date(`${date}T12:00:00`));

describe('DOT inspection expiration',()=>{
  it('expires annually, clamping leap day to February 28',()=>{
    expect(inspectionExpirationDate('2025-07-15')).toBe('2026-07-15');
    expect(inspectionExpirationDate('2024-02-29')).toBe('2025-02-28');
    for(const date of ['', '07/15/2025', '2025-02-29', '2025-13-01'])expect(inspectionExpirationDate(date)).toBeNull();
  });
  it('starts reminders exactly one calendar month before expiration, clamping month ends',()=>{
    expect(alerts('2026-06-14')).toEqual([]);
    expect(alerts('2026-06-15')[0]).toMatchObject({title:'Engine 1 DOT inspection expires soon',badge:'Due soon',target:{type:'vehicle',id:'engine'}});
    expect(inspectionReminderDate('2026-03-31')).toBe('2026-02-28');
    expect(inspectionReminderDate('2028-03-31')).toBe('2028-02-29');
    expect(inspectionReminderDate('2026-01-15')).toBe('2025-12-15');
  });
  it('keeps alerts through expiration and afterwards until the inspection date is updated',()=>{
    expect(alerts('2026-07-14')).toHaveLength(1);
    expect(alerts('2026-07-15')[0]).toMatchObject({badge:'Expired',urgent:true});
    expect(alerts('2027-08-01')).toHaveLength(1);
    expect(alerts('2026-07-15','2026-07-15')).toEqual([]);
  });
  it('does not fabricate dates for existing documents without a date',()=>{
    expect(commandAlerts([vehicle(),vehicle('invalid')],[],[])).toEqual([]);
    expect(commandAlerts([{id:'other',unit:'Other',status:'Ready'}],[],[])).toEqual([]);
  });
  it('supports a document matched by label and preserves other dashboard alerts',()=>{
    const item={...vehicle(),documents:[{id:'legacy-id',name:'DOT Inspection',inspectionDate:'2025-07-15'}]};
    const result=commandAlerts([item],[],[{id:'payroll',createdByName:'Alex',engineNumber:'E1',incidents:'Fire',status:'pending'}],new Date('2026-07-01T12:00:00'));
    expect(result.map(alert=>alert.id)).toEqual(['dot-inspection-engine','payroll-payroll']);
    item.documents[0].inspectionDate='2026-07-01';
    expect(commandAlerts([item],[],[],new Date('2026-07-01T12:00:00'))).toEqual([]);
  });
  it('uses the same warning status for fleet rows and dashboard alerts',()=>{
    const item=vehicle('2025-07-15');
    expect(dotInspectionWarning(item,new Date('2026-06-14T12:00:00'))).toBeNull();
    expect(dotInspectionWarning(item,new Date('2026-06-15T12:00:00'))).toEqual({inspectionDate:'2025-07-15',expiration:'2026-07-15',expired:false});
    expect(dotInspectionWarning(item,new Date('2026-07-15T12:00:00'))?.expired).toBe(true);
    expect(dotInspectionWarning(vehicle('2026-07-15'),new Date('2026-07-15T12:00:00'))).toBeNull();
    expect(dotInspectionWarning(vehicle())).toBeNull();
  });
  it('formats today using the local calendar date',()=>{
    expect(localDateToday(new Date(2026,0,2,0,1))).toBe('2026-01-02');
  });
});
