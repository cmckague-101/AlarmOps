import {describe, expect, it} from 'vitest';
import {
  createSyncPatch, suggestSyncReviewChoices, type FleetSyncReview, type FleetSyncReviewCandidate,
  type SyncFieldValue, type SyncRecord,
} from './offline-sync';

const base: SyncRecord = {id:'record-1',unit:'Base',notes:'Base',vin:'VIN-1'};
function candidate(id: string, proposedRecord: SyncRecord, reason: FleetSyncReviewCandidate['reason'] = 'fields'): FleetSyncReviewCandidate {
  return {
    id, operationId:`op-${id}`, baseRevision:'1', currentRevision:'2', baseRecord:base, currentRecord:base, proposedRecord, reason,
    fieldConflicts:[], provenance:{userId:'user-1',actorName:'User',deviceId:'device-1',savedAt:'2026-01-01T12:00:00Z',connectivity:'offline'},
    receivedAt:'2026-01-02T12:00:00Z',
  };
}
const slot = (record: SyncRecord | null, key: string): SyncFieldValue => record && Object.prototype.hasOwnProperty.call(record,key)
  ? {present:true,value:record[key]} : {present:false};
function review(currentRecord: SyncRecord | null, candidates: FleetSyncReviewCandidate[]): FleetSyncReview {
  const keys = [...new Set(candidates.flatMap((item)=>Object.keys(createSyncPatch(item.baseRecord,item.proposedRecord))))];
  return {
    companyId:'company-1',entityType:'vehicle',entityId:'record-1',currentRevision:'2',currentRecord,candidates,reviewToken:'token',currentProvenance:{},
    fields:Object.fromEntries(keys.map((key)=>[key,{
      current:slot(currentRecord,key),options:candidates.filter((item)=>Object.prototype.hasOwnProperty.call(createSyncPatch(item.baseRecord,item.proposedRecord),key))
        .map((item)=>({source:item.id,value:slot(item.proposedRecord,key),provenance:item.provenance})),
    }])),
  };
}

describe('shared conflict review defaults',()=>{
  it('prefills independent fields but leaves overlapping edits for explicit selection',()=>{
    const snapshot=review({...base,unit:'Online'},[candidate('one',{...base,unit:'Offline',notes:'Independent note'})]);
    expect(suggestSyncReviewChoices(snapshot)).toEqual({notes:'one'});
  });

  it('leaves competing proposed values unselected even when neither overlaps the current server field',()=>{
    const snapshot=review(base,[candidate('one',{...base,notes:'First'}),candidate('two',{...base,notes:'Second'})]);
    expect(suggestSyncReviewChoices(snapshot)).toEqual({});
  });

  it('can select matching independent proposals and identical current outcomes',()=>{
    expect(suggestSyncReviewChoices(review(base,[candidate('one',{...base,notes:'Same'}),candidate('two',{...base,notes:'Same'})]))).toEqual({notes:'one'});
    expect(suggestSyncReviewChoices(review({...base,notes:'Same'},[candidate('one',{...base,notes:'Same'})]))).toEqual({notes:'current'});
  });

  it('preserves the difference between an absent field and null',()=>{
    const {vin:_,...withoutVin}=base;
    expect(suggestSyncReviewChoices(review(base,[candidate('one',withoutVin)]))).toEqual({vin:'one'});
    expect(suggestSyncReviewChoices(review({...base,vin:null},[candidate('one',withoutVin)]))).toEqual({});
  });

  it('does not preselect deleted/recreated lifecycle decisions',()=>{
    expect(suggestSyncReviewChoices(review(null,[candidate('one',{...base,notes:'New'},'deleted')]))).toEqual({});
    expect(suggestSyncReviewChoices(review(base,[candidate('one',{...base,notes:'New'},'recreated')]))).toEqual({});
    expect(suggestSyncReviewChoices(review(base,[{...candidate('one',{...base,notes:'New'}),lifecycleChanged:true}]))).toEqual({});
  });

  it('rejects inconsistent current values or candidate sources instead of guessing',()=>{
    const snapshot=review(base,[candidate('one',{...base,notes:'New'})]);
    expect(()=>suggestSyncReviewChoices({...snapshot,currentRecord:{...base,notes:'Changed'}})).toThrow(/current data/);
    expect(()=>suggestSyncReviewChoices({...snapshot,candidates:[]})).toThrow(/Unknown review candidate/);
    expect(()=>suggestSyncReviewChoices({...snapshot,candidates:[snapshot.candidates[0],snapshot.candidates[0]]})).toThrow(/Duplicate/);
    expect(()=>suggestSyncReviewChoices({...snapshot,candidates:[candidate('one',{...base,notes:'Different'})]})).toThrow(/candidate change/);
  });

  it('does not mutate the review snapshots',()=>{
    const snapshot=review(base,[candidate('one',{...base,notes:'New'})]);
    const original=JSON.stringify(snapshot);
    expect(suggestSyncReviewChoices(snapshot)).toEqual({notes:'one'});
    expect(JSON.stringify(snapshot)).toBe(original);
  });
});
