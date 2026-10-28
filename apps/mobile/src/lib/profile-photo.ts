import {File} from 'expo-file-system';
import {createFleetId} from '@/lib/fleet-store';
import {supabase} from '@/lib/supabase';
import type {LocalFleetFile} from '@/lib/fleet-files';

const bucket='profile-photos';

export async function loadProfilePhotoPath(userId:string){if(!supabase)throw new Error('Profile photo is unavailable.');const {data,error}=await supabase.from('profiles').select('avatar_path').eq('user_id',userId).maybeSingle<{avatar_path:string|null}>();if(error)throw new Error(error.message);return data?.avatar_path??null}
export async function profilePhotoUrl(path:string){if(!supabase)throw new Error('Profile photo is unavailable.');const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,60*60);if(error||!data?.signedUrl)throw new Error(error?.message??'Profile photo is unavailable.');return data.signedUrl}

/** Uploads the new photo, points the profile at it, then removes the previous photo. */
export async function saveProfilePhoto(userId:string,file:LocalFleetFile|null,previousPath:string|null){
  if(!supabase)throw new Error('Profile photo is unavailable.');
  let path:string|null=null;
  if(file){
    const localFile=new File(file.uri);if(!localFile.exists)throw new Error('Selected photo is no longer available.');if(localFile.size>5*1024*1024)throw new Error('Photo must be 5 MB or smaller.');
    const type=file.type??'image/jpeg';path=`${userId}/${createFleetId()}.${type.split('/')[1]?.replace('jpeg','jpg')||'jpg'}`;
    const {error}=await supabase.storage.from(bucket).upload(path,await localFile.arrayBuffer(),{contentType:type,upsert:false});if(error)throw new Error(error.message);
  }
  const {error}=await supabase.from('profiles').update({avatar_path:path}).eq('user_id',userId);
  if(error){if(path)await supabase.storage.from(bucket).remove([path]).catch(()=>undefined);throw new Error(error.message)}
  if(previousPath&&previousPath!==path)await supabase.storage.from(bucket).remove([previousPath]).catch(()=>undefined);
  return path;
}
