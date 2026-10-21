import {describe,expect,it} from 'vitest';
import {commandAlerts,type CrewMember} from '@fireops/domain';

const member:CrewMember={id:'crew-1',name:'Alex Crew',email:'alex@example.com',phone:'',role:'fire_fighter',status:'Active',annualRecord:{rt130CompletionDate:'2025-07-15',rt130CurrencyDate:'2026-07-15',wctCompletionDate:'2025-08-20',wctCurrencyDate:'2026-08-20'}};
const alerts=(today:string,crew:CrewMember[]=[member])=>commandAlerts([],[],[],new Date(`${today}T12:00:00`),crew);

describe('annual record alerts for the owner/admin dashboard',()=>{
  it('starts each reminder exactly eleven calendar months after completion',()=>{
    expect(alerts('2026-06-14')).toEqual([]);
    expect(alerts('2026-06-15')).toEqual([expect.objectContaining({kind:'crew',title:'Alex Crew — RT-130 expires soon',detail:'Expires 2026-07-15 · Annual record needs updating',badge:'Due soon',urgent:false,target:{type:'crew',id:'crew-1'}})]);
    expect(alerts('2026-07-19')).toHaveLength(1);
    expect(alerts('2026-07-20')).toHaveLength(2);
    expect(alerts('2026-07-20')[1]).toMatchObject({title:'Alex Crew — Work capacity test expires soon',badge:'Due soon'});
  });
  it('marks records overdue at twelve months until completion dates are updated',()=>{
    expect(alerts('2026-07-15')[0]).toMatchObject({badge:'Expired',urgent:true});
    expect(alerts('2027-01-01')).toHaveLength(2);
    const updated={...member,annualRecord:{...member.annualRecord!,rt130CompletionDate:'2026-07-15'}};
    expect(alerts('2026-08-20',[updated])).toEqual([expect.objectContaining({title:'Alex Crew — Work capacity test expired',badge:'Expired'})]);
    updated.annualRecord.wctCompletionDate='2026-08-20';
    expect(alerts('2026-08-20',[updated])).toEqual([]);
  });
  it('clamps month-end reminders and handles year boundaries',()=>{
    const withDate=(completion:string)=>[{...member,annualRecord:{...member.annualRecord!,rt130CompletionDate:completion,wctCompletionDate:''}}];
    expect(alerts('2026-02-27',withDate('2025-03-31'))).toEqual([]);
    expect(alerts('2026-02-28',withDate('2025-03-31'))).toHaveLength(1);
    expect(alerts('2028-02-28',withDate('2027-03-31'))).toEqual([]);
    expect(alerts('2028-02-29',withDate('2027-03-31'))).toHaveLength(1);
    expect(alerts('2025-12-15',withDate('2025-01-15'))).toHaveLength(1);
    expect(alerts('2025-01-28',withDate('2024-02-29'))).toEqual([]);
    expect(alerts('2025-01-29',withDate('2024-02-29'))[0]).toMatchObject({badge:'Due soon',detail:'Expires 2025-02-28 · Annual record needs updating'});
    expect(alerts('2025-02-28',withDate('2024-02-29'))[0]).toMatchObject({badge:'Expired'});
  });
  it('ignores missing or invalid dates without fabricating expirations',()=>{
    expect(alerts('2026-07-01',[{...member,annualRecord:undefined}])).toEqual([]);
    for(const date of ['', 'invalid', '2026-02-30', '2026-13-01']){
      expect(alerts('2026-07-01',[{...member,annualRecord:{...member.annualRecord!,rt130CompletionDate:date,wctCompletionDate:date}}])).toEqual([]);
    }
  });
  it('uses completion dates regardless of the entered currency dates',()=>{
    const crew=[{...member,annualRecord:{...member.annualRecord!,rt130CurrencyDate:'2099-01-01',wctCurrencyDate:''}}];
    expect(alerts('2026-06-15',crew)[0]).toMatchObject({badge:'Due soon'});
    expect(alerts('2026-08-20',crew)).toHaveLength(2);
    expect(alerts('2026-08-20',crew).every(alert=>alert.badge==='Expired')).toBe(true);
  });
  it('keeps unique alerts for each crew member and annual requirement',()=>{
    const result=alerts('2026-08-20',[member,{...member,id:'crew-2',name:'Sam Crew'}]);
    expect(result).toHaveLength(4);
    expect(new Set(result.map(alert=>alert.id)).size).toBe(4);
    expect(result[2].target).toEqual({type:'crew',id:'crew-2'});
  });
});
