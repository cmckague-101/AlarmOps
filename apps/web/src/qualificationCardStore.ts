import type {QualificationCardRequest,SavedSignature} from '@fireops/domain';
import {supabase} from './supabase';

type RequestRow={id:string;company_id:string;crew_user_id:string;crew_name:string;card_data:{companyPhone:string;homeBase:string;primaryQualificationId:string};photo_path:string;employee_signature:SavedSignature;owner_signature:SavedSignature|null;owner_name:string|null;status:QualificationCardRequest['status'];submitted_at:string;approved_at:string|null};
const columns='id,company_id,crew_user_id,crew_name,card_data,photo_path,employee_signature,owner_signature,owner_name,status,submitted_at,approved_at';
function fromRow(row:RequestRow):QualificationCardRequest{return {id:row.id,companyId:row.company_id,crewUserId:row.crew_user_id,crewName:row.crew_name,status:row.status,companyPhone:row.card_data.companyPhone,homeBase:row.card_data.homeBase,primaryQualificationId:row.card_data.primaryQualificationId,photoPath:row.photo_path,employeeSignature:row.employee_signature,...(row.owner_signature?{ownerSignature:row.owner_signature}:{}),...(row.owner_name?{ownerName:row.owner_name}:{}),submittedAt:row.submitted_at,...(row.approved_at?{approvedAt:row.approved_at}:{})}}
export async function loadQualificationCardData(companyId:string,userId:string,isOwner:boolean){
  if(!supabase)throw new Error('Qualification card approvals require company connection.');
  const [profileResult,requestResult]=await Promise.all([
    supabase.from('profiles').select('signature_data').eq('user_id',userId).maybeSingle<{signature_data:SavedSignature|null}>(),
    (isOwner?supabase.from('qualification_card_requests').select(columns).eq('company_id',companyId):supabase.from('qualification_card_requests').select(columns).eq('company_id',companyId).eq('crew_user_id',userId)).order('submitted_at',{ascending:false}),
  ]);
  if(profileResult.error)throw new Error(profileResult.error.message);if(requestResult.error)throw new Error(requestResult.error.message);
  return {signature:profileResult.data?.signature_data??undefined,requests:((requestResult.data??[]) as unknown as RequestRow[]).map(fromRow)};
}
export async function submitQualificationCard(companyId:string,data:{companyPhone:string;homeBase:string;primaryQualificationId:string},signature:SavedSignature,photoPath:string){if(!supabase)throw new Error('Qualification card approvals require company connection.');const {data:row,error}=await supabase.rpc('submit_qualification_card_request',{target_company_id:companyId,card_data:data,employee_signature:signature,photo_path:photoPath});if(error)throw new Error(error.message);return fromRow(row as unknown as RequestRow)}
export async function approveQualificationCard(requestId:string,signature:SavedSignature){if(!supabase)throw new Error('Qualification card approvals require company connection.');const {data:row,error}=await supabase.rpc('approve_qualification_card_request',{request_id:requestId,certifying_signature:signature});if(error)throw new Error(error.message);return fromRow(row as unknown as RequestRow)}
export async function qualificationCardPhotoUrl(path:string){if(!supabase)throw new Error('Qualification card photo is unavailable.');const {data,error}=await supabase.storage.from('fleet-files').createSignedUrl(path,3600);if(error)throw new Error(error.message);return data.signedUrl}
