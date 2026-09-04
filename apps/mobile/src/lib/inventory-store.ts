import type { InventoryItem } from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

type InventoryRow = { id: string; name: string; quantity: number; created_at: string; updated_at: string };
type InventorySnapshot = { items: InventoryItem[]; loading: boolean; refreshing: boolean; error: string | null };

let snapshot: InventorySnapshot = { items: [], loading: true, refreshing: false, error: null };
let activeCompanyId: string | null | undefined;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let requestVersion = -1;
let refreshQueued = false;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: InventorySnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function fromRow(row: InventoryRow): InventoryItem {
  return { id: row.id, name: row.name, quantity: row.quantity, createdAt: row.created_at, updatedAt: row.updated_at };
}

function orderItems(items: InventoryItem[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function mutationError(error: { code?: string; message: string }, fallback: string) {
  if (error.code === '23505') return new Error('Item name already exists in inventory.');
  return new Error(error.message || fallback);
}

export function refreshInventory() {
  if (request && requestVersion === selectionVersion) {
    refreshQueued = true;
    return request;
  }
  refreshQueued = false;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  emit({ ...snapshot, loading: snapshot.items.length === 0, refreshing: snapshot.items.length > 0, error: null });
  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Inventory could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId) {
      if (version === selectionVersion) emit({ items: [], loading: false, refreshing: false, error: null });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('company_inventory_items')
        .select('id,name,quantity,created_at,updated_at')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (version !== selectionVersion) return;
      if (error) {
        emit({ ...snapshot, loading: false, refreshing: false, error: `Inventory could not load. ${error.message}` });
        return;
      }
      emit({ items: orderItems(((data ?? []) as InventoryRow[]).map(fromRow)), loading: false, refreshing: false, error: null });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      const detail = loadError instanceof Error ? loadError.message : 'Network request failed.';
      emit({ ...snapshot, loading: false, refreshing: false, error: `Inventory could not load. ${detail}` });
    }
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === selectionVersion) {
      refreshQueued = false;
      void refreshInventory();
    }
  });
  requestVersion = version;
  return request;
}

export async function createInventoryItem(name: string, quantity: number) {
  if (!supabase || !activeCompanyId) throw new Error('Company inventory is unavailable.');
  const { data, error } = await supabase
    .from('company_inventory_items')
    .insert({ company_id: activeCompanyId, name, quantity })
    .select('id,name,quantity,created_at,updated_at')
    .single<InventoryRow>();
  if (error) throw mutationError(error, 'Item could not be added.');
  const item = fromRow(data);
  emit({ ...snapshot, items: orderItems([item, ...snapshot.items.filter((entry) => entry.id !== item.id)]) });
  return item;
}

export async function updateInventoryItem(item: InventoryItem, values: { name?: string; quantity?: number }) {
  if (!supabase || !activeCompanyId) throw new Error('Company inventory is unavailable.');
  const { data, error } = await supabase
    .from('company_inventory_items')
    .update(values)
    .eq('company_id', activeCompanyId)
    .eq('id', item.id)
    .select('id,name,quantity,created_at,updated_at')
    .single<InventoryRow>();
  if (error) throw mutationError(error, 'Item could not be updated.');
  const updated = fromRow(data);
  emit({ ...snapshot, items: orderItems(snapshot.items.map((entry) => entry.id === updated.id ? updated : entry)) });
  return updated;
}

export async function deleteInventoryItem(item: InventoryItem) {
  if (!supabase || !activeCompanyId) throw new Error('Company inventory is unavailable.');
  const { error } = await supabase.from('company_inventory_items').delete().eq('company_id', activeCompanyId).eq('id', item.id);
  if (error) throw new Error(error.message);
  emit({ ...snapshot, items: snapshot.items.filter((entry) => entry.id !== item.id) });
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  selectionVersion += 1;
  refreshQueued = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ items: [], loading: Boolean(companyId), refreshing: false, error: null });
  if (!companyId || !supabase) return;
  channel = supabase
    .channel(`mobile-inventory:${companyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'company_inventory_items', filter: `company_id=eq.${companyId}` }, () => void refreshInventory());
  channel.subscribe();
  void refreshInventory();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInventory(companyId: string | null) {
  useEffect(() => selectCompany(companyId), [companyId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
