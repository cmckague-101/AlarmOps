import {describe,expect,it,vi} from 'vitest';

vi.mock('./fleet-store',()=>({createFleetId:()=>'entry-1'}));
const {offlineIssueChange,offlineIssueChangeKey}=await import('./offline-issue-changes');

describe('offline issue changes',()=>{
  const author={id:'crew-1',name:'Crew One'};const now=new Date('2026-10-24T12:00:00.000Z');
  const existing={id:'old',text:'Earlier',createdBy:'Owner',createdById:'owner-1',createdAt:'2026-10-20T00:00:00.000Z'};
  const entry={id:'entry-1',text:'Replaced hose',createdBy:'Crew One',createdById:'crew-1',createdAt:now.toISOString()};
  it('prepends a note without touching status',()=>{
    expect(offlineIssueChange({kind:'note',text:'Replaced hose'},{status:'Open',updates:[existing]},author,now)).toEqual({values:{updates:[entry,existing]},extras:{}});
  });
  it('resolves with a note and records when it was resolved',()=>{
    expect(offlineIssueChange({kind:'status',status:'Resolved',note:'Replaced hose'},{status:'Open'},author,now)).toEqual({values:{status:'Resolved',resolvedAt:now.toISOString(),updates:[entry]},extras:{}});
  });
  it('reopens and clears the resolved time',()=>{
    expect(offlineIssueChange({kind:'status',status:'Open'},{status:'Resolved',resolvedAt:'x'},author,now)).toEqual({values:{status:'Open'},extras:{remove:['resolvedAt']}});
  });
  it('keys notes, status, and status with a note separately',()=>{
    expect(offlineIssueChangeKey({kind:'note',text:'a'})).toBe('note');
    expect(offlineIssueChangeKey({kind:'status',status:'Open'})).toBe('status');
    expect(offlineIssueChangeKey({kind:'status',status:'Resolved',note:'a'})).toBe('status-note');
  });
});
