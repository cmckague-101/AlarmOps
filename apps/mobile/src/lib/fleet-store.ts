import { useEffect, useSyncExternalStore } from 'react';
import type { Activity, CrewMember, FleetIssue } from '@fireops/domain';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type FleetVehicleFile = {
  name: string;
  type: string | null;
};

export type FleetVehicle = {
  id: string;
  name: string;
  type: string;
  status: string;
  location: string | null;
  detail: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  assignedTo: string | null;
  notes: string | null;
  files: { label: string; file: FleetVehicleFile }[];
  updatedAt: string | null;
};

export type SharedFleetSnapshot = {
  vehicles: FleetVehicle[];
  issues: FleetIssue[];
  crew: CrewMember[];
  activities: Activity[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

type FleetCollection = 'vehicles' | 'issues' | 'crew' | 'activities';
type VehicleRow = Record<string, unknown>;
type FleetRecordRow = { record_id: string; data: unknown; version: number; updated_at: string };

const tables: Record<FleetCollection, string> = {
  vehicles: 'fleet_vehicles',
  issues: 'fleet_issues',
  crew: 'fleet_crew',
  activities: 'fleet_activities',
};
const versions: Record<FleetCollection, Map<string, number>> = {
  vehicles: new Map(),
  issues: new Map(),
  crew: new Map(),
  activities: new Map(),
};

let snapshot: SharedFleetSnapshot = {
  vehicles: [],
  issues: [],
  crew: [],
  activities: [],
  loading: true,
  refreshing: false,
  error: null,
};
let activeCompanyId: string | null | undefined;
let companyVersion = 0;
let channel: RealtimeChannel | null = null;
let request: Promise<void> | null = null;
let requestVersion = -1;
const listeners = new Set<() => void>();

function text(row: VehicleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function vehicleFile(value: unknown): FleetVehicleFile | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as VehicleRow;
  const name = text(row, 'name');
  if (!name) return null;
  return { name, type: text(row, 'type') };
}

function normalizeVehicle(row: VehicleRow): FleetVehicle {
  const payload = row.data && typeof row.data === 'object'
    ? { ...row, ...(row.data as VehicleRow) }
    : row;
  const makeModel = [text(payload, 'year'), text(payload, 'make'), text(payload, 'model')]
    .filter(Boolean)
    .join(' ');
  const name = text(payload, 'unit', 'name', 'label', 'vehicle_name', 'call_sign') ?? 'Unnamed vehicle';
  const assignedTo = text(payload, 'assignedTo', 'assigned_to');
  const files = [
    ['VIPR checklist', vehicleFile(payload.viprChecklist)],
    ['DOT inspection', vehicleFile(payload.dotInspection)],
    ['Registration', vehicleFile(payload.registration)],
    ['Insurance', vehicleFile(payload.insurance)],
    ['Contract', vehicleFile(payload.contract)],
  ].flatMap(([label, file]) => file ? [{ label: label as string, file: file as FleetVehicleFile }] : []);
  const documents = Array.isArray(payload.documents)
    ? payload.documents.flatMap((document) => {
        if (!document || typeof document !== 'object') return [];
        const value = document as VehicleRow;
        const file = vehicleFile(value.file);
        return file ? [{ label: text(value, 'name') ?? 'Document', file }] : [];
      })
    : [];

  return {
    id: text(payload, 'id', 'record_id') ?? `${name}-${makeModel}`,
    name,
    type: text(payload, 'type', 'vehicle_type', 'category') ?? 'Vehicle',
    status: text(payload, 'status', 'readiness') ?? 'Unknown',
    location: text(payload, 'location', 'current_location', 'station_name'),
    detail: makeModel || text(payload, 'description'),
    year: text(payload, 'year'),
    make: text(payload, 'make'),
    model: text(payload, 'model'),
    vin: text(payload, 'vin'),
    plate: text(payload, 'plate'),
    assignedTo,
    notes: text(payload, 'notes'),
    files: [...files, ...documents],
    updatedAt: text(payload, 'updatedAt', 'updated_at', 'createdAt', 'created_at'),
  };
}

function records<T>(rows: FleetRecordRow[]): T[] {
  return rows.flatMap((row) => row.data && typeof row.data === 'object' ? [row.data as T] : []);
}

function emit(next: SharedFleetSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function createFleetId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function saveFleetRecord<T extends { id: string }>(collection: FleetCollection, record: T) {
  if (!supabase || !activeCompanyId) throw new Error('Company fleet is unavailable.');
  const expectedVersion = versions[collection].get(record.id);
  const change = {
    collection,
    event: expectedVersion === undefined ? 'insert' : 'update',
    recordId: record.id,
    data: record,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
  const { error } = await supabase.rpc('apply_fleet_changes', {
    target_company_id: activeCompanyId,
    changes: [change],
  });
  if (error) {
    if (error.code === '40001') throw new Error('Record changed elsewhere. Refresh and try again.');
    throw new Error(error.message);
  }
  await refreshFleet();
}

export function refreshFleet() {
  if (request && requestVersion === companyVersion) return request;
  const version = companyVersion;
  const companyId = activeCompanyId;

  emit({
    ...snapshot,
    loading: snapshot.vehicles.length === 0 && snapshot.issues.length === 0,
    refreshing: snapshot.vehicles.length > 0 || snapshot.issues.length > 0,
    error: null,
  });

  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Fleet could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId) {
      if (version === companyVersion) emit({ ...snapshot, loading: false, refreshing: false, error: null });
      return;
    }

    const client = supabase;
    const collections = Object.entries(tables) as [FleetCollection, string][];
    const results = await Promise.all(
      collections.map(([, table]) => client
        .from(table)
        .select('record_id, data, version, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })),
    );
    if (version !== companyVersion) return;

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      emit({ ...snapshot, loading: false, refreshing: false, error: `Fleet could not load. ${failed.error.message}` });
      return;
    }

    const loaded = Object.fromEntries(collections.map(([collection], index) => {
      const rows = (results[index].data ?? []) as FleetRecordRow[];
      versions[collection] = new Map(rows.map((row) => [row.record_id, row.version]));
      return [collection, records(rows)];
    })) as Record<FleetCollection, unknown[]>;

    const vehicles = (results[0].data ?? [])
      .map((row) => normalizeVehicle(row as VehicleRow))
      .sort((a, b) => a.name.localeCompare(b.name));
    const issues = (loaded.issues as FleetIssue[])
      .map((issue) => ({ ...issue, status: issue.status ?? 'Open', updates: issue.updates ?? [] }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    emit({
      vehicles,
      issues,
      crew: loaded.crew as CrewMember[],
      activities: loaded.activities as Activity[],
      loading: false,
      refreshing: false,
      error: null,
    });
  })().finally(() => {
    if (requestVersion === version) request = null;
  });
  requestVersion = version;
  return request;
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  companyVersion += 1;

  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ vehicles: [], issues: [], crew: [], activities: [], loading: Boolean(companyId), refreshing: false, error: null });
  if (!companyId || !supabase) return;

  channel = supabase.channel(`mobile-fleet:${companyId}`);
  Object.values(tables).forEach((table) => {
    channel = channel?.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
      () => void refreshFleet(),
    ) ?? null;
  });
  channel?.subscribe();
  void refreshFleet();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFleetVehicles(companyId: string | null) {
  useEffect(() => selectCompany(companyId), [companyId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
