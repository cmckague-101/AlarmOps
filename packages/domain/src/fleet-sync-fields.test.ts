import {describe,expect,it} from 'vitest';
import {addedIssueUpdates,fleetSyncRecordProblem,isFleetSyncField,mergeFleetSyncDetail} from './fleet-sync-fields';
const note=(id:string,text=id)=>({id,text,createdBy:'Owner',createdById:'u',createdAt:'2026-01-01T00:00:00Z'});
describe('fleet sync field policy (client mirror of the server adapter)',()=>{
  it('allows scalar, file slot, status/assignment and issue update fields only',()=>{
    for(const field of ['notes','photo','status','assignedTo','assignedFire','inspections'])expect(isFleetSyncField('vehicle',field)).toBe(true);
    for(const field of ['status','resolvedAt','updates'])expect(isFleetSyncField('issue',field)).toBe(true);
    for(const [entity,field] of [['vehicle','documents'],['issue','vehicleId'],['crew','name']])expect(isFleetSyncField(entity,field)).toBe(false);
  });
  it('treats status and assignment as one conflict group',()=>{
    const base={id:'v',status:'Assigned',assignedTo:'a',notes:'n'};
    expect(mergeFleetSyncDetail('vehicle',base,{...base,assignedTo:'b'},{status:{present:true,value:'Out of service'}}).kind).toBe('conflict');
    expect(mergeFleetSyncDetail('vehicle',base,{...base,notes:'other'},{status:{present:true,value:'Ready'},assignedTo:{present:false}})).toMatchObject({kind:'merged',record:{status:'Ready',notes:'other'}});
  });
  it('appends issue updates onto current entries without conflicts or duplicates',()=>{
    const base={id:'i',updates:[note('a')]};const current={id:'i',updates:[note('b'),note('a')]};
    expect(mergeFleetSyncDetail('issue',base,current,{updates:{present:true,value:[note('c'),note('a')]}})).toMatchObject({kind:'merged',record:{updates:[note('c'),note('b'),note('a')]}});
    expect(mergeFleetSyncDetail('issue',base,{...current,updates:[note('c'),note('b'),note('a')]},{updates:{present:true,value:[note('c'),note('a')]}})).toMatchObject({record:{updates:[note('c'),note('b'),note('a')]}});
    expect(()=>addedIssueUpdates([note('a')],[note('a','edited')])).toThrow();expect(()=>addedIssueUpdates([note('a')],[])).toThrow();
    expect(()=>mergeFleetSyncDetail('issue',base,current,{updates:{present:true,value:[note('c'),note('a')]},title:{present:true,value:'x'}})).toThrow(/separately/);
  });
  it('resolves/reopens with exactly one note, keeping an existing resolution instead of conflicting',()=>{
    const base={id:'i',status:'Open',updates:[note('a')]};const resolve={status:{present:true,value:'Resolved'},resolvedAt:{present:true,value:'T2'},updates:{present:true,value:[note('c'),note('a')]}} as const;
    expect(mergeFleetSyncDetail('issue',base,{...base,updates:[note('b'),note('a')]},resolve)).toMatchObject({kind:'merged',record:{status:'Resolved',resolvedAt:'T2',updates:[note('c'),note('b'),note('a')]},changedFields:['resolvedAt','status','updates']});
    expect(mergeFleetSyncDetail('issue',base,{...base,status:'Resolved',resolvedAt:'T1'},resolve)).toMatchObject({kind:'merged',record:{status:'Resolved',resolvedAt:'T1',updates:[note('c'),note('a')]},changedFields:['updates']});
    expect(()=>mergeFleetSyncDetail('issue',base,base,{...resolve,updates:{present:true,value:[note('d'),note('c'),note('a')]}})).toThrow(/exactly one/);
    expect(()=>mergeFleetSyncDetail('issue',base,base,{...resolve,title:{present:true,value:'x'}})).toThrow(/only carry a note/);
  });
  it('appends exactly one inspection onto the current list',()=>{
    const base={id:'v',inspections:[note('a')]};const current={id:'v',inspections:[note('b'),note('a')]};
    expect(mergeFleetSyncDetail('vehicle',base,current,{inspections:{present:true,value:[note('c'),note('a')]}})).toMatchObject({kind:'merged',record:{inspections:[note('c'),note('b'),note('a')]}});
    expect(()=>mergeFleetSyncDetail('vehicle',base,current,{inspections:{present:true,value:[note('c'),note('d'),note('a')]}})).toThrow();
    expect(()=>mergeFleetSyncDetail('vehicle',base,current,{inspections:{present:true,value:[note('c'),note('a')]},notes:{present:true,value:'x'}})).toThrow(/separately/);
  });
  it('enforces assignment and resolution invariants when those fields change',()=>{
    expect(fleetSyncRecordProblem('vehicle',null,{status:'Assigned'})).toMatch(/inconsistent/);
    expect(fleetSyncRecordProblem('vehicle',null,{status:'Ready',assignedFire:{id:'f'}})).toMatch(/inconsistent/);
    expect(fleetSyncRecordProblem('vehicle',null,{status:'Assigned',assignedTo:'u',assignedFire:{id:'f'}})).toBeNull();
    expect(fleetSyncRecordProblem('vehicle',{status:'Assigned',notes:'x'},{status:'Assigned',notes:'y'})).toBeNull();
    expect(fleetSyncRecordProblem('issue',null,{status:'Resolved'})).toMatch(/inconsistent/);expect(fleetSyncRecordProblem('issue',null,{status:'Resolved',resolvedAt:'t'})).toBeNull();
  });
});
