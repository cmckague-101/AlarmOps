import {describe,expect,it} from 'vitest';
import {detailRecordHref,offlineDetailFields,offlineDetailFormChanges,offlineDetailFormValues,savedDetailHref} from './offline-detail-form';
import type {OfflineDetailDraft} from './offline-detail-editor';

function draft():OfflineDetailDraft{return {entityType:'vehicle',entityId:'vehicle',revision:'1',verifiedAt:'2026-01-01',record:{id:'vehicle',unit:' E1 ',type:'Engine',year:'2024',make:'Ford',model:'F',vin:'ABC',plate:'XYZ',notes:null,status:'Ready',documents:[{id:'file',name:'Document'}]}}}

describe('mobile saved-detail form adapter',()=>{
  it('keeps raw base values intact and submits only explicitly changed fields',()=>{
    const base=draft();const original=structuredClone(base);const form=offlineDetailFormValues(base);form.unit=' E2 ';
    expect(offlineDetailFormChanges(base,form)).toEqual({unit:'E2'});expect(base).toEqual(original);
    expect(form.year).toBe('2024');expect(offlineDetailFormChanges(base,form)).not.toHaveProperty('year');expect(offlineDetailFormChanges(base,form)).not.toHaveProperty('notes');
  });
  it('does not convert missing/null fields or numeric-looking strings unless changed',()=>{
    const base=draft();delete (base.record as Record<string,unknown>).vin;const form=offlineDetailFormValues(base);form.model='New model';
    expect(offlineDetailFormChanges(base,form)).toEqual({model:'New model'});
  });
  it('preserves note whitespace while normalizing explicitly changed identifiers',()=>{
    const base=draft();const form=offlineDetailFormValues(base);form.notes='  New note\nKeep spacing  ';form.vin=' xyz ';form.plate=' ab12 ';
    expect(offlineDetailFormChanges(base,form)).toEqual({notes:'  New note\nKeep spacing  ',vin:'XYZ',plate:'AB12'});
  });
  it('rejects no-op trimming before the UI freezes a retry payload',()=>{
    const base=draft();(base.record as Record<string,unknown>).unit='E1';const form=offlineDetailFormValues(base);
    expect(()=>offlineDetailFormChanges(base,form)).toThrow('No detail changes');form.unit=' E1 ';
    expect(()=>offlineDetailFormChanges(base,form)).toThrow('No detail changes');
  });
  it('clears optional text explicitly without pretending it was absent or null',()=>{
    const base=draft();const form=offlineDetailFormValues(base);form.vin='';expect(offlineDetailFormChanges(base,form)).toEqual({vin:''});
  });
  it.each(['2e03','0000','999','20250','abcd'])('rejects invalid changed year %s without creating an intent',year=>{
    const base=draft();const form=offlineDetailFormValues(base);form.year=year;expect(()=>offlineDetailFormChanges(base,form)).toThrow('four digits');
  });
  it('validates issue fields and never includes status, updates or vehicle linkage',()=>{
    const base:OfflineDetailDraft={...draft(),entityType:'issue',entityId:'issue',record:{id:'issue',title:'Leak',description:'Inspect pump',priority:'Low',status:'Open',vehicleId:'vehicle',updates:[]}};
    const form=offlineDetailFormValues(base);form.priority='Critical';form.description='Confirmed leak';
    expect(offlineDetailFormChanges(base,form)).toEqual({description:'Confirmed leak',priority:'Critical'});
    form.priority='Urgent';expect(()=>offlineDetailFormChanges(base,form)).toThrow('priority');
  });
  it('fails closed on unsupported fields, incomplete forms and invalid changed values',()=>{
    const base=draft();const form=offlineDetailFormValues(base);expect(()=>offlineDetailFormChanges(base,{...form,status:'Assigned'})).toThrow('online editor');
    delete form.make;expect(()=>offlineDetailFormChanges(base,form)).toThrow('incomplete');
    const invalid=offlineDetailFormValues(base);invalid.model=' ';expect(()=>offlineDetailFormChanges(base,invalid)).toThrow('blank');
  });
  it('keeps changed year/description validation consistent with existing online forms',()=>{
    const base=draft();const form=offlineDetailFormValues(base);form.year='9999';expect(()=>offlineDetailFormChanges(base,form)).toThrow('1950');
    const issue:OfflineDetailDraft={...base,entityType:'issue',record:{id:base.entityId,title:'Leak',description:'Inspect',priority:'Low'}};
    const details=offlineDetailFormValues(issue);details.description=' ';expect(()=>offlineDetailFormChanges(issue,details)).toThrow('Description is required');
  });
  it('uses fixed route names and an exact scalar-only field inventory',()=>{
    expect(savedDetailHref({entityType:'issue',entityId:'id?not-a-route'})).toEqual({pathname:'/saved-details',params:{entityType:'issue',entityId:'id?not-a-route'}});
    expect(detailRecordHref({entityType:'vehicle',entityId:'vehicle'})).toEqual({pathname:'/vehicle/[id]',params:{id:'vehicle'}});
    expect(detailRecordHref({entityType:'issue',entityId:'issue'})).toEqual({pathname:'/issue/[id]',params:{id:'issue'}});
    expect(offlineDetailFields.vehicle.map(([field])=>field)).toEqual(['unit','type','year','make','model','vin','plate','notes']);
    expect(offlineDetailFields.issue.map(([field])=>field)).toEqual(['title','description','priority']);
  });
});
