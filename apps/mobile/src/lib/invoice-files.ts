import { File } from 'expo-file-system';
import type { InvoiceAttachment } from '@fireops/domain';
import { createFleetId } from '@/lib/fleet-store';
import type { LocalFleetFile } from '@/lib/fleet-files';
import { supabase } from '@/lib/supabase';

const accepted=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
function safeName(name:string){return name.trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'attachment'}
function mime(file:LocalFleetFile){return file.type||(/\.pdf$/i.test(file.name)?'application/pdf':/\.hei[cf]$/i.test(file.name)?'image/heic':'')}
export async function uploadInvoiceFile(companyId:string,userId:string,formId:string,picked:LocalFleetFile):Promise<InvoiceAttachment>{if(!supabase)throw new Error('Invoice attachment storage is unavailable.');const file=new File(picked.uri);if(!file.exists)throw new Error('Selected file is no longer available.');if(file.size<=0||file.size>10*1024*1024)throw new Error('Attachment must be 10 MB or smaller.');const mimeType=mime(picked);if(!accepted.includes(mimeType))throw new Error('Choose a JPG, PNG, WebP, HEIC, or PDF attachment.');const storagePath=`${companyId}/${userId}/forms/${formId}/${createFleetId()}-${safeName(picked.name)}`;const {error}=await supabase.storage.from('invoice-files').upload(storagePath,await file.arrayBuffer(),{contentType:mimeType});if(error)throw error;return{name:picked.name,mimeType,byteSize:file.size,storagePath}}
export async function openInvoiceFile(file:InvoiceAttachment){if(!supabase)throw new Error('Invoice attachment storage is unavailable.');const {data,error}=await supabase.storage.from('invoice-files').createSignedUrl(file.storagePath,3600);if(error)throw error;return data.signedUrl}
export async function removeInvoiceFile(file:InvoiceAttachment){if(!supabase)throw new Error('Invoice attachment storage is unavailable.');const {error}=await supabase.storage.from('invoice-files').remove([file.storagePath]);if(error)throw error}
