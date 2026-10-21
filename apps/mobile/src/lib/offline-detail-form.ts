import type {Href} from 'expo-router';
import {createSyncPatch,type SyncRecord} from '@fireops/domain';
import {validateOfflineDetailValues,type DetailTarget,type OfflineDetailDraft} from './offline-detail-editor';

// Generated Expo route declarations can lag newly added screens until the next native bundle.
export const savedDetailHref=(target:DetailTarget):Href=>({pathname:'/saved-details',params:{entityType:target.entityType,entityId:target.entityId}} as unknown as Href);

export const detailRecordHref=(target:DetailTarget):Href=>target.entityType==='vehicle'?{pathname:'/vehicle/[id]',params:{id:target.entityId}}:{pathname:'/issue/[id]',params:{id:target.entityId}};

export const offlineDetailFields={
  vehicle:[['unit','Unit'],['type','Type'],['year','Year'],['make','Make'],['model','Model'],['vin','VIN'],['plate','Plate'],['notes','Notes']],
  issue:[['title','Title'],['description','Description'],['priority','Priority']],
} as const;
export function offlineDetailFormValues(draft:OfflineDetailDraft):Record<string,string>{
  return Object.fromEntries(offlineDetailFields[draft.entityType].map(([field])=>{const value=draft.record[field];return [field,typeof value==='string'||typeof value==='number'?String(value):'']}));
}
/** Only explicit UI changes; never normalize or default untouched raw base fields. */
export function offlineDetailFormChanges(draft:OfflineDetailDraft,form:Readonly<Record<string,string>>):SyncRecord{
  const initial=offlineDetailFormValues(draft);const values:Record<string,string|number>={};
  if(Object.keys(form).some(field=>!offlineDetailFields[draft.entityType].some(([allowed])=>allowed===field)))throw new Error('This field requires an online editor.');
  for(const [field] of offlineDetailFields[draft.entityType]){
    const text=form[field];if(typeof text!=='string')throw new Error('Detail form is incomplete.');
    if(text===initial[field])continue;
    if(field==='year'){
      if(!/^[0-9]{4}$/.test(text))throw new Error('Vehicle year must contain four digits.');
      values[field]=Number(text);
    }else values[field]=['notes','description'].includes(field)?text:field==='vin'||field==='plate'?text.trim().toUpperCase():text.trim();
  }
  validateOfflineDetailValues(draft.entityType,values);
  const currentYear=new Date().getFullYear();
  if(typeof values.year==='number'&&(values.year<1950||values.year>currentYear+1))throw new Error(`Enter a year from 1950 to ${currentYear+1}.`);
  if(typeof values.description==='string'&&!values.description.trim())throw new Error('Description is required.');
  if(!Object.keys(createSyncPatch(draft.record,{...draft.record,...values})).length)throw new Error('No detail changes to save.');
  return values;
}
