import { useEffect, useSyncExternalStore } from 'react';
import type { CompanyDocument } from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';

import type { FleetVehicleFile } from '@/lib/fleet-store';
import { supabase } from '@/lib/supabase';
import { onAppResume, refreshOnRejoin } from './app-resume';

type CompanyDocumentRow = {
  id: string;
  name: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
};

type CompanyDocumentReadRow = { document_id: string; viewed_at: string };

type DocumentsSnapshot = {
  documents: CompanyDocument[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

let snapshot: DocumentsSnapshot = { documents: [], loading: true, refreshing: false, error: null };
let activeCompanyId: string | null | undefined;
let activeUserId: string | null | undefined;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let requestVersion = -1;
let refreshQueued = false;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: DocumentsSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function fromRow(row: CompanyDocumentRow, viewedAt?: string): CompanyDocument {
  return {
    id: row.id,
    name: row.name,
    file: { name: row.file_name, type: row.mime_type, dataUrl: '', path: row.storage_path },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    viewedAt,
  };
}

function orderDocuments(documents: CompanyDocument[]) {
  return [...documents].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function refreshDocuments() {
  if (request && requestVersion === selectionVersion) {
    refreshQueued = true;
    return request;
  }
  refreshQueued = false;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  const userId = activeUserId;
  emit({ ...snapshot, loading: snapshot.documents.length === 0, refreshing: snapshot.documents.length > 0, error: null });

  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Documents could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId || !userId) {
      if (version === selectionVersion) emit({ documents: [], loading: false, refreshing: false, error: null });
      return;
    }
    try {
      const [documentResult, readResult] = await Promise.all([
        supabase
          .from('company_documents')
          .select('id,name,file_name,mime_type,storage_path,created_at,updated_at')
          .eq('company_id', companyId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('company_document_reads')
          .select('document_id,viewed_at')
          .eq('company_id', companyId)
          .eq('user_id', userId),
      ]);
      if (version !== selectionVersion) return;
      const failed = documentResult.error ?? readResult.error;
      if (failed) {
        emit({ ...snapshot, loading: false, refreshing: false, error: `Documents could not load. ${failed.message}` });
        return;
      }
      const reads = new Map(((readResult.data ?? []) as CompanyDocumentReadRow[]).map((read) => [read.document_id, read.viewed_at]));
      const documents = ((documentResult.data ?? []) as CompanyDocumentRow[]).map((row) => fromRow(row, reads.get(row.id)));
      emit({ documents: orderDocuments(documents), loading: false, refreshing: false, error: null });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      const detail = loadError instanceof Error ? loadError.message : 'Network request failed.';
      emit({ ...snapshot, loading: false, refreshing: false, error: `Documents could not load. ${detail}` });
    }
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === selectionVersion) {
      refreshQueued = false;
      void refreshDocuments();
    }
  });
  requestVersion = version;
  return request;
}

export async function createCompanyDocument(name: string, file: FleetVehicleFile) {
  if (!supabase || !activeCompanyId || !file.path) throw new Error('Company documents are unavailable.');
  const { data, error } = await supabase
    .from('company_documents')
    .insert({
      company_id: activeCompanyId,
      name,
      file_name: file.name,
      mime_type: file.type ?? 'application/octet-stream',
      storage_path: file.path,
    })
    .select('id,name,file_name,mime_type,storage_path,created_at,updated_at')
    .single<CompanyDocumentRow>();
  if (error) throw new Error(error.message);
  const document = fromRow(data);
  emit({ ...snapshot, documents: orderDocuments([document, ...snapshot.documents.filter((item) => item.id !== document.id)]) });
  return document;
}

export async function updateCompanyDocument(document: CompanyDocument, name: string, file?: FleetVehicleFile) {
  if (!supabase || !activeCompanyId) throw new Error('Company documents are unavailable.');
  const values = file?.path
    ? { name, file_name: file.name, mime_type: file.type ?? 'application/octet-stream', storage_path: file.path }
    : { name };
  const { data, error } = await supabase
    .from('company_documents')
    .update(values)
    .eq('company_id', activeCompanyId)
    .eq('id', document.id)
    .select('id,name,file_name,mime_type,storage_path,created_at,updated_at')
    .single<CompanyDocumentRow>();
  if (error) throw new Error(error.message);
  const next = fromRow(data, document.viewedAt);
  emit({ ...snapshot, documents: orderDocuments([next, ...snapshot.documents.filter((item) => item.id !== next.id)]) });
  return next;
}

export async function deleteCompanyDocument(document: CompanyDocument) {
  if (!supabase || !activeCompanyId) throw new Error('Company documents are unavailable.');
  const companyId = activeCompanyId;
  const { error } = await supabase.from('company_documents').delete().eq('company_id', companyId).eq('id', document.id);
  if (error) throw new Error(error.message);
  emit({ ...snapshot, documents: snapshot.documents.filter((item) => item.id !== document.id) });
  if (!document.file.path) return false;
  try {
    await removeCompanyDocumentFiles(companyId, [document.file.path]);
    return false;
  } catch {
    return true;
  }
}

export async function removeCompanyDocumentFiles(companyId: string, paths: string[]) {
  if (!supabase || paths.length === 0) return;
  const { error } = await supabase.functions.invoke('delete-fleet-files', { body: { companyId, paths } });
  if (error) throw new Error(error.message);
}

export async function markCompanyDocumentViewed(documentId: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Company documents are unavailable.');
  const viewedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('company_document_reads')
    .upsert(
      { company_id: activeCompanyId, document_id: documentId, user_id: activeUserId, viewed_at: viewedAt },
      { onConflict: 'company_id,document_id,user_id' },
    )
    .select('viewed_at')
    .single<{ viewed_at: string }>();
  if (error) throw new Error(error.message);
  emit({
    ...snapshot,
    documents: snapshot.documents.map((document) => document.id === documentId ? { ...document, viewedAt: data.viewed_at } : document),
  });
  return data.viewed_at;
}

function selectAccount(companyId: string | null, userId: string | null) {
  if (companyId === activeCompanyId && userId === activeUserId) return;
  activeCompanyId = companyId;
  activeUserId = userId;
  selectionVersion += 1;
  refreshQueued = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ documents: [], loading: Boolean(companyId && userId), refreshing: false, error: null });
  if (!companyId || !userId || !supabase) return;

  channel = supabase.channel(`mobile-documents:${companyId}:${userId}`);
  ['company_documents', 'company_document_reads'].forEach((table) => {
    channel = channel?.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
      () => void refreshDocuments(),
    ) ?? null;
  });
  channel?.subscribe(refreshOnRejoin(refreshDocuments));
  void refreshDocuments();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCompanyDocuments(companyId: string | null, userId: string | null) {
  useEffect(() => selectAccount(companyId, userId), [companyId, userId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

onAppResume(() => { if (activeCompanyId && activeUserId) void refreshDocuments(); });
