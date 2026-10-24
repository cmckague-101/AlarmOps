import {useCallback,useEffect,useState} from 'react';
import {DEFAULT_VEHICLE_INSPECTION_ITEMS,type VehicleInspectionTemplateItem} from '@fireops/domain';
import {supabase} from './supabase';
import { createId } from './create-id';

const defaults:VehicleInspectionTemplateItem[]=DEFAULT_VEHICLE_INSPECTION_ITEMS.map((item,position)=>({id:`default-${position}`,...item,position}));

export function useInspectionTemplate(companyId:string,localOnly=false){
  const [items,setItems]=useState<VehicleInspectionTemplateItem[]>(defaults);
  const [loading,setLoading]=useState(Boolean(supabase)&&!localOnly);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    if(!supabase||localOnly){setItems(defaults);setLoading(false);return}
    const {data,error:loadError}=await supabase.from('company_vehicle_inspection_items').select('id,label,position,kind').eq('company_id',companyId).order('position');
    if(loadError){setError(`Inspection Template could not load. ${loadError.message}`)}else{setItems((data??[]) as VehicleInspectionTemplateItem[]);setError('')}
    setLoading(false);
  },[companyId,localOnly]);
  useEffect(()=>{setLoading(Boolean(supabase)&&!localOnly);void load();if(!supabase||localOnly)return;const channel=supabase.channel(`web-inspection-template:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'company_vehicle_inspection_items',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();return()=>{void supabase?.removeChannel(channel)}},[companyId,load,localOnly]);
  const add=useCallback(async(label:string)=>{if(!supabase||localOnly){setItems(current=>[...current,{id:createId(),label:label.trim(),position:current.length,kind:'pass_fail'}]);return}const position=items.length?Math.max(...items.map(item=>item.position))+1:0;const {error:addError}=await supabase.from('company_vehicle_inspection_items').insert({company_id:companyId,label:label.trim(),position,kind:'pass_fail'});if(addError)throw new Error(addError.message);await load()},[companyId,items,load,localOnly]);
  const update=useCallback(async(item:VehicleInspectionTemplateItem,label:string)=>{if(!supabase||localOnly){setItems(current=>current.map(entry=>entry.id===item.id?{...entry,label:label.trim()}:entry));return}const {error:updateError}=await supabase.from('company_vehicle_inspection_items').update({label:label.trim()}).eq('company_id',companyId).eq('id',item.id);if(updateError)throw new Error(updateError.message);await load()},[companyId,load,localOnly]);
  const remove=useCallback(async(item:VehicleInspectionTemplateItem)=>{if(!supabase||localOnly){setItems(current=>current.filter(entry=>entry.id!==item.id));return}const {error:deleteError}=await supabase.from('company_vehicle_inspection_items').delete().eq('company_id',companyId).eq('id',item.id);if(deleteError)throw new Error(deleteError.message);await load()},[companyId,load,localOnly]);
  return {items,loading,error,add,update,remove};
}
