import type {FleetSyncReview,FleetSyncReviewDecision} from '../src/offline-sync';
export const reviewCompany='10000000-0000-4000-8000-000000000001';
export const reviewUser='20000000-0000-4000-8000-000000000001';
export const reviewEntity='30000000-0000-4000-8000-000000000001';
export const reviewCandidate='40000000-0000-4000-8000-000000000001';
export const reviewOperation='50000000-0000-4000-8000-000000000001';
export function reviewFixture():FleetSyncReview{
  const base={id:reviewEntity,unit:'Engine 1',notes:'Original notes'};
  const current={...base,notes:'Online notes'};
  const proposed={...base,notes:'Offline notes'};
  const provenance={userId:reviewUser,actorName:'Alex',deviceId:'device-a',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline' as const};
  return {
    companyId:reviewCompany,entityType:'vehicle',entityId:reviewEntity,currentRevision:'2',currentRecord:current,reviewToken:'review-token',
    currentProvenance:{notes:{userId:'20000000-0000-4000-8000-000000000002',actorName:'Morgan',connectivity:'unknown',savedAt:null,serverRecordedAt:'2026-01-02T12:00:00.000Z'}},
    candidates:[{id:reviewCandidate,operationId:reviewOperation,baseRevision:'1',currentRevision:'2',baseRecord:base,currentRecord:current,proposedRecord:proposed,reason:'fields',fieldConflicts:[],provenance,receivedAt:'2026-01-03T12:00:00.000Z'}],
    fields:{notes:{current:{present:true,value:'Online notes'},options:[{source:reviewCandidate,value:{present:true,value:'Offline notes'},provenance:{...provenance,serverRecordedAt:'2026-01-03T12:00:00.000Z',origin:'reviewed_submission'}}]}},
  };
}
export function decisionFixture():FleetSyncReviewDecision{
  return {kind:'resolved',decisionId:'60000000-0000-4000-8000-000000000001',decidedAt:'2026-01-04T12:00:00.000Z',revision:'3',record:reviewFixture().candidates[0].proposedRecord,
    outcomes:[{conflictId:reviewCandidate,operationId:reviewOperation,userId:reviewUser,outcome:'kept',keptFields:['notes'],discardedFields:[]}]};
}
