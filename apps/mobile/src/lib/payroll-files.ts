import { File } from 'expo-file-system';
import type { PayrollAttachment } from '@fireops/domain';

import { createFleetId } from '@/lib/fleet-store';
import type { LocalFleetFile } from '@/lib/fleet-files';
import { supabase } from '@/lib/supabase';

const bucket = 'payroll-files';
const maxFileSize = 10 * 1024 * 1024;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

function effectiveMimeType(file: LocalFleetFile) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.hei[cf]$/i.test(file.name)) return 'image/heic';
  return '';
}

export async function uploadPayrollFile(companyId: string, userId: string, formId: string, picked: LocalFleetFile): Promise<PayrollAttachment> {
  if (!supabase) throw new Error('Payroll attachment storage is unavailable.');
  const file = new File(picked.uri);
  if (!file.exists) throw new Error('Selected file is no longer available.');
  if (file.size <= 0 || file.size > maxFileSize) throw new Error('Attachment must be 10 MB or smaller.');
  const mimeType = effectiveMimeType(picked);
  if (!acceptedTypes.includes(mimeType)) throw new Error('Choose a JPG, PNG, WebP, HEIC, or PDF attachment.');
  const storagePath = `${companyId}/${userId}/forms/${formId}/${createFleetId()}-${safeFileName(picked.name)}`;
  const body = await file.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(storagePath, body, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return { name: picked.name, mimeType, byteSize: file.size, storagePath };
}

export async function openPayrollFile(attachment: PayrollAttachment) {
  if (!supabase) throw new Error('Payroll attachment storage is unavailable.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(attachment.storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function removePayrollFile(attachment: PayrollAttachment) {
  if (!supabase) throw new Error('Payroll attachment storage is unavailable.');
  const { error } = await supabase.storage.from(bucket).remove([attachment.storagePath]);
  if (error) throw error;
}
