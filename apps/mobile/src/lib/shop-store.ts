import {
  FLEET_REPAIR_COLUMNS, REPAIR_TYPE_COLUMNS, SHOP_JOB_COLUMNS, SHOP_JOB_NOTE_COLUMNS,
  fleetRepairFromRow, repairTypeFromRow, shopJobFromRow, shopJobNoteFromRow,
  type FleetRepair, type FleetRepairFileRequest, type FleetRepairRow, type RepairType, type RepairTypeRow,
  type ShopJob, type ShopJobNote, type ShopJobNoteRow, type ShopJobPriority, type ShopJobRow, type ShopJobStatus,
} from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import { onAppResume, refreshOnRejoin } from './app-resume';

export type ShopSnapshot = {
  jobs: ShopJob[];
  notes: ShopJobNote[];
  repairTypes: RepairType[];
  repairs: FleetRepair[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

export type ShopJobDraft = {
  title: string; description: string; priority: ShopJobPriority; status: ShopJobStatus; blockerReason?: string;
  kind: 'general' | 'fleet'; shopArea?: string; fleetVehicleId?: string; assignToMe: boolean;
};

const emptySnapshot: ShopSnapshot = { jobs: [], notes: [], repairTypes: [], repairs: [], loading: false, refreshing: false, error: null };
let snapshot: ShopSnapshot = emptySnapshot;
let activeCompanyId: string | null = null;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let refreshQueued = false;
let channel: RealtimeChannel | null = null;
let realtimeTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(next: ShopSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function refreshShop(): Promise<void> {
  if (request) {
    refreshQueued = true;
    return request;
  }
  const version = selectionVersion;
  const companyId = activeCompanyId;
  const hasData = snapshot.jobs.length > 0;
  emit({ ...snapshot, loading: !hasData, refreshing: hasData, error: null });
  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Shop jobs could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId) {
      emit(emptySnapshot);
      return;
    }
    try {
      const [jobs, notes, types, repairs] = await Promise.all([
        supabase.from('shop_jobs').select(SHOP_JOB_COLUMNS).eq('company_id', companyId).order('opened_at'),
        supabase.from('shop_job_notes').select(SHOP_JOB_NOTE_COLUMNS).eq('company_id', companyId).order('created_at', { ascending: false }).limit(2000),
        supabase.from('repair_types').select(REPAIR_TYPE_COLUMNS).eq('company_id', companyId).order('name'),
        supabase.from('fleet_repairs').select(FLEET_REPAIR_COLUMNS).eq('company_id', companyId).order('created_at', { ascending: false }).limit(2000),
      ]);
      if (version !== selectionVersion) return;
      const failure = jobs.error ?? notes.error ?? types.error ?? repairs.error;
      if (failure) {
        emit({ ...snapshot, loading: false, refreshing: false, error: `Shop jobs could not load. ${failure.message}` });
        return;
      }
      emit({
        jobs: ((jobs.data ?? []) as ShopJobRow[]).map(shopJobFromRow),
        notes: ((notes.data ?? []) as ShopJobNoteRow[]).map(shopJobNoteFromRow),
        repairTypes: ((types.data ?? []) as RepairTypeRow[]).map(repairTypeFromRow),
        repairs: ((repairs.data ?? []) as FleetRepairRow[]).map(fleetRepairFromRow),
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      emit({ ...snapshot, loading: false, refreshing: false, error: `Shop jobs could not load. ${loadError instanceof Error ? loadError.message : 'Network request failed.'}` });
    }
  })().finally(() => {
    request = null;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshShop();
    }
  });
  return request;
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase || !activeCompanyId) throw new Error('Shop jobs are unavailable.');
  const { data, error } = await supabase.functions.invoke<T>(name, { body: { companyId: activeCompanyId, ...body } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const response = context instanceof Response ? await context.clone().json().catch(() => null) as { error?: string } | null : null;
    throw new Error(response?.error ?? 'The shop request failed. Check your connection and try again.');
  }
  return data as T;
}

export async function createShopJob(draft: ShopJobDraft) {
  const { job } = await invoke<{ job: ShopJobRow }>('shop-job-create', draft);
  await refreshShop();
  return shopJobFromRow(job);
}

export async function assignShopJobToMe(jobId: string) {
  await invoke('shop-job-assign', { jobId });
  await refreshShop();
}

/** Owners, admins and resource bosses assign a job to any shop worker. */
export async function assignShopJobTo(jobId: string, techId: string) {
  await invoke('shop-job-assign', { jobId, techId });
  await refreshShop();
}

export async function addShopJobNote(jobId: string, body: string) {
  await invoke('shop-job-note', { jobId, body });
  await refreshShop();
}

export async function updateShopJob(jobId: string, patch: { priority?: ShopJobPriority; status?: ShopJobStatus; blockerReason?: string | null }) {
  if (!supabase || !activeCompanyId) throw new Error('Shop jobs are unavailable.');
  const values: Record<string, unknown> = {};
  if (patch.priority) values.priority = patch.priority;
  if (patch.status) values.status = patch.status;
  if (patch.blockerReason !== undefined) values.blocker_reason = patch.blockerReason;
  const { error } = await supabase.from('shop_jobs').update(values).eq('company_id', activeCompanyId).eq('id', jobId).select('id').single();
  if (error) throw new Error('The shop job could not be updated.');
  await refreshShop();
}

export async function deleteShopJob(jobId: string) {
  if (!supabase || !activeCompanyId) throw new Error('Shop jobs are unavailable.');
  const { error } = await supabase.from('shop_jobs').delete().eq('company_id', activeCompanyId).eq('id', jobId).select('id').single();
  if (error) throw new Error('The shop job could not be deleted.');
  await refreshShop();
}

export async function fileFleetRepair(input: Omit<FleetRepairFileRequest, 'companyId'>) {
  const result = await invoke<{ shopJobId?: string | null }>('fleet-repair-file', input);
  await refreshShop();
  return result;
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  selectionVersion += 1;
  refreshQueued = false;
  clearTimeout(realtimeTimer);
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ ...emptySnapshot, loading: Boolean(companyId) });
  if (!companyId || !supabase) return;
  const changed = () => { clearTimeout(realtimeTimer); realtimeTimer = setTimeout(() => void refreshShop(), 250); };
  channel = supabase.channel(`mobile-shop:${companyId}`);
  for (const table of ['shop_jobs', 'shop_job_notes', 'fleet_repairs']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` }, changed);
  }
  channel.subscribe(refreshOnRejoin(refreshShop));
  void refreshShop();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShop(companyId: string | null) {
  useEffect(() => selectCompany(companyId), [companyId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

onAppResume(() => { if (activeCompanyId) void refreshShop(); });
