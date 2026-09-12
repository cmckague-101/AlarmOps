import { File } from 'expo-file-system';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

import type { LocalFleetFile } from '@/lib/fleet-files';
import { createFleetId } from '@/lib/fleet-store';
import { supabase } from '@/lib/supabase';


const maxFileSize = 10 * 1024 * 1024;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export type CompanyStoredDocument = {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
};

type StoredDocumentRow = {
  id: string;
  name: string;
  original_file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
};

type Snapshot = { documents: CompanyStoredDocument[]; loading: boolean; refreshing: boolean; error: string | null };

function createDocumentStore(kind: 'invoices' | 'payroll') {
  const bucket = `${kind}-files`;
  let snapshot: Snapshot = { documents: [], loading: true, refreshing: false, error: null };
  let activeCompanyId: string | null | undefined;
  let activeUserId: string | null = null;
  let selectionVersion = 0;
  let request: Promise<void> | null = null;
  let channel: RealtimeChannel | null = null;
  const listeners = new Set<() => void>();

  function emit(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function fromRow(row: StoredDocumentRow): CompanyStoredDocument {
    return {
      id: row.id,
      name: row.name,
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
    return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  }

  function effectiveMimeType(file: LocalFleetFile) {
    if (file.type) return file.type;
    if (/\.pdf$/i.test(file.name)) return 'application/pdf';
    if (/\.hei[cf]$/i.test(file.name)) return 'image/heic';
    if (/\.png$/i.test(file.name)) return 'image/png';
    if (/\.webp$/i.test(file.name)) return 'image/webp';
    return 'image/jpeg';
  }

  function refreshStoredDocuments() {
    if (request) return request;
    const version = selectionVersion;
    const companyId = activeCompanyId;
    emit({ ...snapshot, loading: snapshot.documents.length === 0, refreshing: snapshot.documents.length > 0, error: null });
    request = (async () => {
      if (!supabase) {
        emit({ ...snapshot, loading: false, refreshing: false, error: 'Documents could not load. Supabase is not configured for this build.' });
        return;
      }
      if (!companyId) {
        if (version === selectionVersion) emit({ documents: [], loading: false, refreshing: false, error: null });
        return;
      }
      try {
        const { data, error } = await supabase
          .from(`company_${kind}`)
          .select('id,name,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false });
        if (version !== selectionVersion) return;
        if (error) emit({ ...snapshot, loading: false, refreshing: false, error: `Documents could not load. ${error.message}` });
        else emit({ documents: ((data ?? []) as StoredDocumentRow[]).map(fromRow), loading: false, refreshing: false, error: null });
      } catch (loadError) {
        if (version !== selectionVersion) return;
        emit({ ...snapshot, loading: false, refreshing: false, error: `Documents could not load. ${loadError instanceof Error ? loadError.message : 'Network request failed.'}` });
      }
    })().finally(() => { if (version === selectionVersion) request = null; });
    return request;
  }

  async function createStoredDocument(companyId: string, userId: string, userName: string, name: string, picked: LocalFleetFile) {
    if (!supabase || activeCompanyId !== companyId) throw new Error('Company documents are unavailable.');
    const version = selectionVersion;
    const localFile = new File(picked.uri);
    if (!localFile.exists) throw new Error('Selected file is no longer available.');
    if (localFile.size <= 0 || localFile.size > maxFileSize) throw new Error('Document must be 10 MB or smaller.');
    const mimeType = effectiveMimeType(picked);
    if (!acceptedTypes.includes(mimeType)) throw new Error('Choose a JPG, PNG, WebP, HEIC, or PDF document.');

    const path = `${companyId}/${userId}/${createFleetId()}-${safeFileName(picked.name)}`;
    const body = await localFile.arrayBuffer();
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, body, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase.from(`company_${kind}`).insert({
      company_id: companyId,
      name: name.trim(),
      original_file_name: picked.name,
      mime_type: mimeType,
      byte_size: localFile.size,
      storage_path: path,
      uploaded_by: userId,
      uploaded_by_name: userName,
    }).select('id,name,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at').single<StoredDocumentRow>();

    if (error) {
      await supabase.storage.from(bucket).remove([path]);
      throw new Error(error.message);
    }
    const document = fromRow(data);
    if (version === selectionVersion) emit({ ...snapshot, documents: [document, ...snapshot.documents.filter((item) => item.id !== document.id)] });
    return document;
  }

  async function updateStoredDocument(companyId: string, documentId: string, name: string) {
    if (!supabase || activeCompanyId !== companyId) throw new Error('Company documents are unavailable.');
    const version = selectionVersion;
    const { data, error } = await supabase.from(`company_${kind}`)
      .update({ name: name.trim() })
      .eq('company_id', companyId)
      .eq('id', documentId)
      .select('id,name,original_file_name,mime_type,byte_size,storage_path,uploaded_by,uploaded_by_name,created_at')
      .single<StoredDocumentRow>();
    if (error) throw new Error(error.message);
    const document = fromRow(data);
    if (version === selectionVersion) emit({ ...snapshot, documents: snapshot.documents.map((item) => item.id === document.id ? document : item) });
    return document;
  }

  async function deleteStoredDocument(companyId: string, document: CompanyStoredDocument) {
    if (!supabase || activeCompanyId !== companyId) throw new Error('Company documents are unavailable.');
    const version = selectionVersion;
    const { error } = await supabase.from(`company_${kind}`).delete().eq('company_id', companyId).eq('id', document.id);
    if (error) throw new Error(error.message);
    if (version === selectionVersion) emit({ ...snapshot, documents: snapshot.documents.filter((item) => item.id !== document.id) });
    const { error: storageError } = await supabase.storage.from(bucket).remove([document.storagePath]);
    if (storageError) throw new Error(`Document was deleted, but its file could not be removed. ${storageError.message}`);
  }

  async function openStoredDocument(document: CompanyStoredDocument) {
    if (!supabase) throw new Error('Document storage is unavailable.');
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(document.storagePath, 60 * 60);
    if (error) throw error;
    return data.signedUrl;
  }

  function selectCompany(companyId: string | null, userId: string | null) {
    if (companyId === activeCompanyId && userId === activeUserId) return;
    activeUserId = userId;
    activeCompanyId = companyId;
    selectionVersion += 1;
    request = null;
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
    emit({ documents: [], loading: Boolean(companyId), refreshing: false, error: null });
    if (!companyId || !supabase) return;
    channel = supabase.channel(`mobile-${kind}:${companyId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: `company_${kind}`, filter: `company_id=eq.${companyId}` }, () => void refreshStoredDocuments())
      .subscribe();
    void refreshStoredDocuments();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function useStoredDocuments(companyId: string | null, userId: string | null) {
    useEffect(() => selectCompany(companyId, userId), [companyId, userId]);
    const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
    return companyId === activeCompanyId && userId === activeUserId ? state : {documents: [], loading: Boolean(companyId), refreshing: false, error: null};
  }

  return { useStoredDocuments, refreshStoredDocuments, createStoredDocument, updateStoredDocument, deleteStoredDocument, openStoredDocument };
}
export const documentStores = { invoices: createDocumentStore("invoices"), payroll: createDocumentStore("payroll") };
