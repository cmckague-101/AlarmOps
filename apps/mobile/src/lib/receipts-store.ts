import { File } from 'expo-file-system';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

import type { LocalFleetFile } from '@/lib/fleet-files';
import { createFleetId } from '@/lib/fleet-store';
import { supabase } from '@/lib/supabase';

const bucket = 'receipt-files';
const maxFileSize = 10 * 1024 * 1024;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export type CompanyReceipt = {
  id: string;
  name: string;
  amountCents: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
};

type ReceiptRow = {
  id: string;
  name: string;
  amount_cents: number;
  original_file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
};

type Snapshot = { receipts: CompanyReceipt[]; loading: boolean; refreshing: boolean; error: string | null };

let snapshot: Snapshot = { receipts: [], loading: true, refreshing: false, error: null };
let activeCompanyId: string | null | undefined;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function fromRow(row: ReceiptRow): CompanyReceipt {
  return {
    id: row.id,
    name: row.name,
    amountCents: Number(row.amount_cents),
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'receipt';
}

export function effectiveMimeType(file: LocalFleetFile) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.hei[cf]$/i.test(file.name)) return 'image/heic';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  return 'image/jpeg';
}

export function refreshReceipts() {
  if (request) return request;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  emit({ ...snapshot, loading: snapshot.receipts.length === 0, refreshing: snapshot.receipts.length > 0, error: null });
  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Receipts could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId) {
      if (version === selectionVersion) emit({ receipts: [], loading: false, refreshing: false, error: null });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('company_receipts')
        .select('id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (version !== selectionVersion) return;
      if (error) emit({ ...snapshot, loading: false, refreshing: false, error: `Receipts could not load. ${error.message}` });
      else emit({ receipts: ((data ?? []) as ReceiptRow[]).map(fromRow), loading: false, refreshing: false, error: null });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      emit({ ...snapshot, loading: false, refreshing: false, error: `Receipts could not load. ${loadError instanceof Error ? loadError.message : 'Network request failed.'}` });
    }
  })().finally(() => { request = null; });
  return request;
}

export async function createReceipt(companyId: string, userId: string, userName: string, name: string, amountCents: number, picked: LocalFleetFile) {
  if (!supabase || activeCompanyId !== companyId) throw new Error('Company receipts are unavailable.');
  const localFile = new File(picked.uri);
  if (!localFile.exists) throw new Error('Selected file is no longer available.');
  if (localFile.size <= 0 || localFile.size > maxFileSize) throw new Error('Receipt must be 10 MB or smaller.');
  const mimeType = effectiveMimeType(picked);
  if (!acceptedTypes.includes(mimeType)) throw new Error('Choose a JPG, PNG, WebP, HEIC, or PDF receipt.');

  const path = `${companyId}/${userId}/${createFleetId()}-${safeFileName(picked.name)}`;
  const body = await localFile.arrayBuffer();
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, body, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.from('company_receipts').insert({
    company_id: companyId,
    name: name.trim(),
    amount_cents: amountCents,
    original_file_name: picked.name,
    mime_type: mimeType,
    byte_size: localFile.size,
    storage_path: path,
    uploaded_by: userId,
    uploaded_by_name: userName,
  }).select('id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at').single<ReceiptRow>();

  if (error) {
    await supabase.storage.from(bucket).remove([path]);
    throw new Error(error.message);
  }
  const receipt = fromRow(data);
  emit({ ...snapshot, receipts: [receipt, ...snapshot.receipts.filter((item) => item.id !== receipt.id)] });
  return receipt;
}

export async function updateReceipt(companyId: string, receiptId: string, name: string, amountCents: number) {
  if (!supabase || activeCompanyId !== companyId) throw new Error('Company receipts are unavailable.');
  const { data, error } = await supabase.from('company_receipts')
    .update({ name: name.trim(), amount_cents: amountCents })
    .eq('company_id', companyId)
    .eq('id', receiptId)
    .select('id,name,amount_cents,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at')
    .single<ReceiptRow>();
  if (error) throw new Error(error.message);
  const receipt = fromRow(data);
  emit({ ...snapshot, receipts: snapshot.receipts.map((item) => item.id === receipt.id ? receipt : item) });
  return receipt;
}

export async function deleteReceipt(companyId: string, receipt: CompanyReceipt) {
  if (!supabase || activeCompanyId !== companyId) throw new Error('Company receipts are unavailable.');
  const { error } = await supabase.from('company_receipts').delete().eq('company_id', companyId).eq('id', receipt.id);
  if (error) throw new Error(error.message);
  emit({ ...snapshot, receipts: snapshot.receipts.filter((item) => item.id !== receipt.id) });
  const { error: storageError } = await supabase.storage.from(bucket).remove([receipt.storagePath]);
  if (storageError) throw new Error(`Receipt was deleted, but its file could not be removed. ${storageError.message}`);
}

export async function openReceipt(receipt: CompanyReceipt) {
  if (!supabase) throw new Error('Receipt storage is unavailable.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(receipt.storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  selectionVersion += 1;
  request = null;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ receipts: [], loading: Boolean(companyId), refreshing: false, error: null });
  if (!companyId || !supabase) return;
  channel = supabase.channel(`mobile-receipts:${companyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'company_receipts', filter: `company_id=eq.${companyId}` }, () => void refreshReceipts())
    .subscribe();
  void refreshReceipts();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReceipts(companyId: string | null) {
  useEffect(() => selectCompany(companyId), [companyId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
