import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type VehicleType = {
  id: string;
  name: string;
};

type VehicleTypeSnapshot = {
  types: VehicleType[];
  loading: boolean;
  error: string | null;
};

let snapshot: VehicleTypeSnapshot = { types: [], loading: true, error: null };
let activeCompanyId: string | null | undefined;
let companyVersion = 0;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: VehicleTypeSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

async function loadVehicleTypes(companyId: string, version: number) {
  if (!supabase) {
    if (version === companyVersion)
      emit({ types: [], loading: false, error: "Vehicle types are unavailable in this build." });
    return;
  }
  const { data, error } = await supabase
    .from("company_vehicle_types")
    .select("id,name")
    .eq("company_id", companyId)
    .order("name");
  if (version !== companyVersion || companyId !== activeCompanyId) return;
  if (error) {
    emit({ ...snapshot, loading: false, error: `Vehicle types could not load. ${error.message}` });
    return;
  }
  emit({ types: (data ?? []) as VehicleType[], loading: false, error: null });
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  const version = ++companyVersion;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ types: [], loading: Boolean(companyId), error: null });
  if (!companyId || !supabase) return;

  channel = supabase
    .channel(`mobile-vehicle-types:${companyId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "company_vehicle_types",
        filter: `company_id=eq.${companyId}`,
      },
      () => void loadVehicleTypes(companyId, version),
    );
  channel.subscribe();
  void loadVehicleTypes(companyId, version);
}

function requireClient(companyId: string) {
  if (!supabase || !companyId) throw new Error("Vehicle types are unavailable.");
  return supabase;
}

export async function addVehicleType(companyId: string, name: string) {
  const client = requireClient(companyId);
  const { error } = await client.from("company_vehicle_types").insert({
    company_id: companyId,
    name: name.trim(),
  });
  if (error) {
    if (error.code === "23505") throw new Error("Vehicle type already exists.");
    throw new Error(error.message);
  }
  if (companyId === activeCompanyId) await loadVehicleTypes(companyId, companyVersion);
}

export async function removeVehicleType(companyId: string, type: VehicleType) {
  const client = requireClient(companyId);
  const { error } = await client
    .from("company_vehicle_types")
    .delete()
    .eq("company_id", companyId)
    .eq("id", type.id);
  if (error) {
    if (error.code === "23503") throw new Error("Vehicle type is used by an existing vehicle.");
    throw new Error(error.message);
  }
  if (companyId === activeCompanyId) await loadVehicleTypes(companyId, companyVersion);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVehicleTypes(companyId: string | null) {
  useEffect(() => selectCompany(companyId), [companyId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
