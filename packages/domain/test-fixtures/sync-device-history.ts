import type {DeviceHistoryReport,DeviceHistorySummary} from '../src/sync-device-history';
import type {SyncOperation} from '../src/offline-sync';
import {reviewCompany,reviewEntity,reviewOperation,reviewUser} from './sync-review';
export const historyTarget={entityType:'vehicle' as const,entityId:reviewEntity};
export function historySummary():DeviceHistorySummary{return {...historyTarget,companyId:reviewCompany,actorUserId:reviewUser,operationId:reviewOperation,actorName:'Alex',receivedAt:'2026-01-03T12:00:00.000Z'}}
export function historyReport():DeviceHistoryReport{
  const before:SyncOperation={schemaVersion:1,operationId:reviewOperation,companyId:reviewCompany,...historyTarget,provenance:{userId:reviewUser,deviceId:'phone-a',savedAt:'2026-01-01T12:00:00.000Z',connectivity:'offline'},dependsOn:['60000000-0000-4000-8000-000000000001'],mutation:{kind:'update',baseRevision:'1',base:{id:reviewEntity,notes:'Local parent view'},patch:{notes:{present:true,value:'Discarded saved value'}}}};
  const after:SyncOperation={...before,dependsOn:[],mutation:{kind:'update',baseRevision:'3',base:{id:reviewEntity,notes:'Downloaded value'},patch:{}}};
  return {...historySummary(),deviceHistory:[{before,after,reason:'explicit:{"notes":"current"}',createdAt:'2026-01-02T12:00:00.000Z'}]};
}
