import {userRoleLabel, type UserRole} from '@fireops/domain';
import {Camera} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {FileInput} from './demo-uploads';
import './MyProfilePanel.css';
import {supabase} from './supabase';

const bucket = 'profile-photos';
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

async function loadProfilePhotoPath(userId:string){if(!supabase)throw new Error('Profile photo is unavailable.');const {data,error}=await supabase.from('profiles').select('avatar_path').eq('user_id',userId).maybeSingle<{avatar_path:string|null}>();if(error)throw new Error(error.message);return data?.avatar_path??null}
async function profilePhotoUrl(path:string){if(!supabase)throw new Error('Profile photo is unavailable.');const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,60*60);if(error||!data?.signedUrl)throw new Error(error?.message??'Profile photo is unavailable.');return data.signedUrl}

/** Uploads the new photo, points the profile at it, then removes the previous photo. */
async function saveProfilePhoto(userId:string,file:File|null,previousPath:string|null){
  if(!supabase)throw new Error('Profile photo is unavailable.');
  let path:string|null=null;
  if(file){
    if(!allowedTypes.includes(file.type))throw new Error('Choose a JPEG, PNG, WebP or HEIC photo.');
    if(file.size>5*1024*1024)throw new Error('Photo must be 5 MB or smaller.');
    path=`${userId}/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg','jpg')}`;
    const {error}=await supabase.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});if(error)throw new Error(error.message);
  }
  const {error}=await supabase.from('profiles').update({avatar_path:path}).eq('user_id',userId);
  if(error){if(path)await supabase.storage.from(bucket).remove([path]).catch(()=>undefined);throw new Error(error.message)}
  if(previousPath&&previousPath!==path)await supabase.storage.from(bucket).remove([previousPath]).catch(()=>undefined);
  return path;
}

export default function MyProfilePanel({userId,name,role,demoMode}:{userId:string;name:string;role:UserRole;demoMode:boolean}){
  const [path,setPath]=useState<string|null>(null);
  const [url,setUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(demoMode)return;let active=true;void loadProfilePhotoPath(userId).then(async saved=>{if(!active)return;setPath(saved);setUrl(saved?await profilePhotoUrl(saved):'')}).catch(loadError=>{if(active)setError(loadError instanceof Error?loadError.message:'Profile photo could not be loaded.')});return()=>{active=false}},[demoMode,userId]);
  const save=async(file:File|null)=>{if(busy)return;setBusy(true);setError('');try{const next=await saveProfilePhoto(userId,file,path);setPath(next);setUrl(next?await profilePhotoUrl(next):'')}catch(saveError){setError(saveError instanceof Error?saveError.message:'Profile photo could not be saved.')}finally{setBusy(false);if(input.current)input.current.value=''}};
  const initials=name.split(' ').map(part=>part[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
  return <section className="my-profile-panel" aria-labelledby="my-profile-heading">
    <div className="my-profile-avatar">{url?<img src={url} alt="Your profile photo"/>:initials}</div>
    <div className="my-profile-copy"><h2 id="my-profile-heading">{name}</h2><p>{userRoleLabel(role)}</p>{error&&<div className="integration-error" role="alert">{error}</div>}</div>
    <div className="my-profile-actions">
      <label className={`my-profile-upload ${busy||demoMode?'disabled':''}`}><Camera aria-hidden="true"/>{busy?'Saving...':url?'Change photo':'Upload photo'}<FileInput ref={input} type="file" accept={allowedTypes.join(',')} disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void save(file)}}/></label>
      {url&&<button type="button" className="my-profile-remove" disabled={busy} onClick={()=>{if(window.confirm('Remove your profile photo?'))void save(null)}}>Remove</button>}
    </div>
  </section>;
}
