import type {QualificationCardRequest,SavedSignature} from '@fireops/domain';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
type Row={id:string;company_id:string;crew_user_id:string;crew_name:string;card_data:{companyPhone?:string;homeBase?:string;primaryQualificationId:string;cardPosition?:string};photo_path:string;owner_signature:SavedSignature|null;owner_name:string|null;status:QualificationCardRequest['status'];submitted_at:string;approved_at:string|null};
const columns='id,company_id,crew_user_id,crew_name,card_data,photo_path,owner_signature,owner_name,status,submitted_at,approved_at';
const fromRow=(row:Row):QualificationCardRequest=>({id:row.id,companyId:row.company_id,crewUserId:row.crew_user_id,crewName:row.crew_name,status:row.status,companyPhone:row.card_data.companyPhone??'',homeBase:row.card_data.homeBase??'',primaryQualificationId:row.card_data.primaryQualificationId,...(row.card_data.cardPosition?{cardPosition:row.card_data.cardPosition}:{}),photoPath:row.photo_path,...(row.owner_signature?{ownerSignature:row.owner_signature}:{}),...(row.owner_name?{ownerName:row.owner_name}:{}),submittedAt:row.submitted_at,...(row.approved_at?{approvedAt:row.approved_at}:{})});
export function usePendingQualificationCardCount(companyId:string|null){
  const [count,setCount]=useState(0);
  useEffect(()=>{
    let active=true;
    if(!companyId||!supabase){
      void Promise.resolve().then(()=>{if(active)setCount(0)});
      return()=>{active=false};
    }
    const client=supabase;
    const load=async()=>{const {count:pending,error}=await client.from('qualification_card_requests').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('status','pending');if(active&&!error)setCount(pending??0)};
    void load();
    const channel=client.channel(`mobile-pending-qualification-cards:${companyId}:${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table:'qualification_card_requests',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();
    return()=>{active=false;void client.removeChannel(channel)};
  },[companyId]);
  return count;
}
export async function loadCompanyCardRequests(companyId:string){if(!supabase)throw new Error('Qualification card approvals are unavailable.');const {data,error}=await supabase.from('qualification_card_requests').select(columns).eq('company_id',companyId).order('submitted_at',{ascending:false});if(error)throw new Error(error.message);return ((data??[]) as unknown as Row[]).map(fromRow)}
export async function loadCardApprovals(companyId:string,userId:string,isOwner:boolean){if(!supabase)throw new Error('Qualification card approvals are unavailable.');const [profile,requests]=await Promise.all([supabase.from('profiles').select('signature_data').eq('user_id',userId).maybeSingle<{signature_data:SavedSignature|null}>(),(isOwner?supabase.from('qualification_card_requests').select(columns).eq('company_id',companyId):supabase.from('qualification_card_requests').select(columns).eq('company_id',companyId).eq('crew_user_id',userId)).order('submitted_at',{ascending:false})]);if(profile.error)throw new Error(profile.error.message);if(requests.error)throw new Error(requests.error.message);return {signature:profile.data?.signature_data??undefined,requests:((requests.data??[]) as unknown as Row[]).map(fromRow)}}
export async function submitCardApproval(companyId:string,primaryQualificationId:string,photoPath:string){if(!supabase)throw new Error('Qualification card approvals are unavailable.');const {data:row,error}=await supabase.rpc('submit_qualification_card_request',{target_company_id:companyId,primary_qualification_id:primaryQualificationId,photo_path:photoPath});if(error)throw new Error(error.message);return fromRow(row as unknown as Row)}
export async function approveCardRequest(id:string,signature:SavedSignature,cardPosition:string){if(!supabase)throw new Error('Qualification card approvals are unavailable.');const {data:row,error}=await supabase.rpc('approve_qualification_card_request',{request_id:id,certifying_signature:signature,qualified_position:cardPosition});if(error)throw new Error(error.message);return fromRow(row as unknown as Row)}
export async function cardPhotoUrl(path:string){if(!supabase)throw new Error('Qualification card photo is unavailable.');const {data,error}=await supabase.storage.from('fleet-files').createSignedUrl(path,3600);if(error)throw new Error(error.message);return data.signedUrl}
