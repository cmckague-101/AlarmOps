import type {Href} from 'expo-router';
import type {SyncFieldValue} from '@fireops/domain';
import type {ContinuationReview} from './offline-outbox';
export const continuationReviewHref=(operationId:string):Href=>({pathname:'/rebase-details',params:{operationId}} as unknown as Href);
export function rebaseFieldText(value:SyncFieldValue):string{return !value.present?'Not present':value.value===null?'Null':value.value===''?'Empty text':JSON.stringify(value.value)}
export function rebaseChoicesComplete(review:ContinuationReview,choices:Readonly<Record<string,'current'|'saved'>>){
  const fields=Object.keys(review.fields);return Object.keys(choices).length===fields.length&&fields.every(field=>choices[field]==='current'||choices[field]==='saved');
}
