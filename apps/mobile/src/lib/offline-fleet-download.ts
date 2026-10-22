import {createSyncPatch,type SyncRecord} from '@fireops/domain';
import {decodeCanonicalSyncRecord,type CanonicalSyncRecord} from './offline-sync-protocol';
export type FleetDownloadCursor={entityType:'vehicle'|'issue';entityId:string};
export type FleetDownloadProgress={generationId:string;snapshotToken:string|null;cursor:FleetDownloadCursor|null;complete:boolean;received:number;total:number;vehicles:number;issues:number;lastCompletedAt:string|null;serverRequestAt:string|null};
/** `vehicles`: crew inventories cover vehicles only; their issues are verified per record. */
export type FleetDownloadPage={companyId:string;snapshotToken:string;records:(FleetDownloadCursor&CanonicalSyncRecord)[];nextCursor:FleetDownloadCursor|null;total:number;vehicles:number;issues:number;serverRequestAt:string;scope:'all'|'vehicles'};
export const initialFleetDownload=(generationId:string):FleetDownloadProgress=>({generationId,snapshotToken:null,cursor:null,complete:false,received:0,total:0,vehicles:0,issues:0,lastCompletedAt:null,serverRequestAt:null});
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid fleet download');return value as Record<string,unknown>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const fleetDownloadKey=(value:FleetDownloadCursor)=>`${value.entityType}:${value.entityId}`;
function cursor(value:unknown):FleetDownloadCursor{const item=object(value);if(!['vehicle','issue'].includes(String(item.entityType))||typeof item.entityId!=='string'||!uuid.test(item.entityId))throw new Error('Invalid fleet download cursor');return {entityType:item.entityType as FleetDownloadCursor['entityType'],entityId:item.entityId}}
export function decodeFleetDownloadProgress(value:unknown):FleetDownloadProgress{
  const data=object(value);createSyncPatch({},data as SyncRecord);
  if(typeof data.generationId!=='string'||!data.generationId.trim()||typeof data.complete!=='boolean')throw new Error('Invalid saved download state');
  for(const key of ['received','total','vehicles','issues'])if(typeof data[key]!=='number'||!Number.isSafeInteger(data[key])||(data[key] as number)<0)throw new Error('Invalid saved download counts');
  if((data.received as number)>(data.total as number)||(data.vehicles as number)+(data.issues as number)>(data.total as number))throw new Error('Invalid saved download counts');
  for(const key of ['serverRequestAt','lastCompletedAt'])if(data[key]!==null&&(typeof data[key]!=='string'||!Number.isFinite(Date.parse(data[key] as string))))throw new Error('Invalid saved download time');
  if(data.snapshotToken===null){if(data.complete||data.cursor!==null||data.received!==0||data.total!==0||data.vehicles!==0||data.issues!==0||data.serverRequestAt!==null)throw new Error('Invalid initial download state')}
  else{
    if(typeof data.snapshotToken!=='string'||!/^[0-9a-f]{64}$/.test(data.snapshotToken)||data.serverRequestAt===null)throw new Error('Invalid saved inventory fingerprint');
    if(data.complete){if(data.cursor!==null||data.received!==data.total||data.lastCompletedAt!==data.serverRequestAt)throw new Error('Invalid completed inventory')}
    else{cursor(data.cursor);if(data.received===0||data.received===data.total)throw new Error('Invalid partial inventory')}
  }
  return JSON.parse(JSON.stringify(data)) as FleetDownloadProgress;
}
export function decodeFleetDownloadPage(value:unknown,companyId:string,expected:Pick<FleetDownloadProgress,'snapshotToken'|'cursor'>):FleetDownloadPage{
  createSyncPatch({},value as SyncRecord);const data=object(value);
  if(data.companyId!==companyId||typeof data.snapshotToken!=='string'||!/^[0-9a-f]{64}$/.test(data.snapshotToken)||(expected.snapshotToken!==null&&expected.snapshotToken!==data.snapshotToken))throw new Error('Fleet download scope or snapshot changed');
  for(const key of ['total','vehicles','issues'])if(typeof data[key]!=='number'||!Number.isSafeInteger(data[key])||(data[key] as number)<0)throw new Error('Invalid fleet inventory counts');
  if((data.vehicles as number)+(data.issues as number)>(data.total as number)||typeof data.serverRequestAt!=='string'||!Number.isFinite(Date.parse(data.serverRequestAt))||!Array.isArray(data.records)||data.records.length>25)throw new Error('Invalid fleet inventory page');
  // Older servers omit scope and always return everything.
  const scope=data.scope===undefined?'all':data.scope;if(scope!=='all'&&scope!=='vehicles')throw new Error('Invalid fleet inventory scope');
  if(scope==='vehicles'&&data.issues!==0)throw new Error('Vehicle-only inventory reported issues');
  let previous=expected.cursor?fleetDownloadKey(expected.cursor):'';
  const records=data.records.map(raw=>{const target=cursor(raw);if(scope==='vehicles'&&target.entityType!=='vehicle')throw new Error('Vehicle-only inventory returned an issue');const key=fleetDownloadKey(target);if(key<=previous)throw new Error('Fleet inventory page repeated or reordered');previous=key;return {...target,...decodeCanonicalSyncRecord(target,raw,'1')}});
  const nextCursor=data.nextCursor===null?null:cursor(data.nextCursor);
  if(nextCursor&&(records.length!==25||fleetDownloadKey(nextCursor)!==previous))throw new Error('Invalid next fleet cursor');
  return {companyId,snapshotToken:data.snapshotToken,records,nextCursor,total:data.total as number,vehicles:data.vehicles as number,issues:data.issues as number,serverRequestAt:data.serverRequestAt,scope};
}
