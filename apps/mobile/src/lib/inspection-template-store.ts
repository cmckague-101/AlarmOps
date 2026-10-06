import {useEffect,useSyncExternalStore} from 'react';
import type {RealtimeChannel} from '@supabase/supabase-js';
import {DEFAULT_VEHICLE_INSPECTION_ITEMS,type VehicleInspectionTemplateItem} from '@fireops/domain';
import {supabase} from '@/lib/supabase';

type Snapshot={items:VehicleInspectionTemplateItem[];loading:boolean;error:string|null};
const defaults=DEFAULT_VEHICLE_INSPECTION_ITEMS.map((item,position)=>({id:`default-${position}`,...item,position}));
const pendingSnapshot:Snapshot={items:[],loading:true,error:null};
let snapshot:Snapshot={items:defaults,loading:true,error:null};let activeCompanyId:string|null|undefined;let version=0;let channel:RealtimeChannel|null=null;const listeners=new Set<()=>void>();
function emit(next:Snapshot){snapshot=next;listeners.forEach(listener=>listener())}
async function load(companyId:string,currentVersion:number){if(!supabase){if(currentVersion===version)emit({items:defaults,loading:false,error:null});return}const {data,error}=await supabase.from('company_vehicle_inspection_items').select('id,label,position,kind').eq('company_id',companyId).order('position');if(currentVersion!==version||companyId!==activeCompanyId)return;if(error)emit({...snapshot,loading:false,error:`Inspection Template could not load. ${error.message}`});else emit({items:(data??[]) as VehicleInspectionTemplateItem[],loading:false,error:null})}
function selectCompany(companyId:string|null){if(companyId===activeCompanyId)return;activeCompanyId=companyId;const currentVersion=++version;if(channel&&supabase)void supabase.removeChannel(channel);channel=null;emit({items:[],loading:Boolean(companyId),error:null});if(!companyId||!supabase)return;channel=supabase.channel(`mobile-inspection-template:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'company_vehicle_inspection_items',filter:`company_id=eq.${companyId}`},()=>void load(companyId,currentVersion));channel.subscribe();void load(companyId,currentVersion)}
function requireClient(companyId:string){if(!supabase||!companyId)throw new Error('Inspection Template is unavailable.');return supabase}
export async function addInspectionTemplateItem(companyId:string,label:string,items:VehicleInspectionTemplateItem[]){const client=requireClient(companyId);const position=items.length?Math.max(...items.map(item=>item.position))+1:0;const {error}=await client.from('company_vehicle_inspection_items').insert({company_id:companyId,label:label.trim(),position,kind:'pass_fail'});if(error)throw new Error(error.message);await load(companyId,version)}
export async function updateInspectionTemplateItem(companyId:string,item:VehicleInspectionTemplateItem,label:string){const client=requireClient(companyId);const {error}=await client.from('company_vehicle_inspection_items').update({label:label.trim()}).eq('company_id',companyId).eq('id',item.id);if(error)throw new Error(error.message);await load(companyId,version)}
export async function removeInspectionTemplateItem(companyId:string,item:VehicleInspectionTemplateItem){const client=requireClient(companyId);const {error}=await client.from('company_vehicle_inspection_items').delete().eq('company_id',companyId).eq('id',item.id);if(error)throw new Error(error.message);await load(companyId,version)}
function subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)}
export function useInspectionTemplate(companyId:string|null){useEffect(()=>selectCompany(companyId),[companyId]);const current=useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot);return activeCompanyId===companyId?current:pendingSnapshot}
