import { useEffect, useSyncExternalStore } from "react";
import type {
  Activity,
  CrewMember,
  FireOpsUser,
  FleetIssue,
  MotiveVehicleSnapshot,
  NifcIncident,
  VehicleStatus,
} from "@fireops/domain";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type FleetVehicleFile = {
  name: string;
  type: string | null;
  path: string | null;
};

export type FleetVehicleDocument = {
  id: string;
  name: string;
  file: FleetVehicleFile;
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
  assignedFire?: Pick<NifcIncident, "id" | "name" | "state">;
  motive?: MotiveVehicleSnapshot;
  notes: string | null;
  photo: FleetVehicleFile | null;
  documents: FleetVehicleDocument[];
  files: { label: string; file: FleetVehicleFile }[];
  updatedAt: string | null;
  source: Record<string, unknown>;
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

type FleetCollection = "vehicles" | "issues" | "crew" | "activities";
type VehicleRow = Record<string, unknown>;
type FleetRecordRow = {
  record_id: string;
  data: unknown;
  version: number;
  updated_at: string;
};

const tables: Record<FleetCollection, string> = {
  vehicles: "fleet_vehicles",
  issues: "fleet_issues",
  crew: "fleet_crew",
  activities: "fleet_activities",
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
let refreshQueued = false;
const listeners = new Set<() => void>();

function text(row: VehicleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function vehicleFile(value: unknown): FleetVehicleFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as VehicleRow;
  const name = text(row, "name");
  if (!name) return null;
  return { name, type: text(row, "type"), path: text(row, "path") };
}

function normalizeVehicle(row: VehicleRow): FleetVehicle {
  const payload =
    row.data && typeof row.data === "object"
      ? { ...row, ...(row.data as VehicleRow) }
      : row;
  const makeModel = [
    text(payload, "year"),
    text(payload, "make"),
    text(payload, "model"),
  ]
    .filter(Boolean)
    .join(" ");
  const name =
    text(payload, "unit", "name", "label", "vehicle_name", "call_sign") ??
    "Unnamed vehicle";
  const assignedTo = text(payload, "assignedTo", "assigned_to");
  const files = [
    ["VIPR checklist", vehicleFile(payload.viprChecklist)],
    ["DOT inspection", vehicleFile(payload.dotInspection)],
    ["Registration", vehicleFile(payload.registration)],
    ["Insurance", vehicleFile(payload.insurance)],
    ["Contract", vehicleFile(payload.contract)],
  ].flatMap(([label, file]) =>
    file ? [{ label: label as string, file: file as FleetVehicleFile }] : [],
  );
  const photo = vehicleFile(payload.photo);
  const documents = Array.isArray(payload.documents)
    ? payload.documents.flatMap((document) => {
        if (!document || typeof document !== "object") return [];
        const value = document as VehicleRow;
        const file = vehicleFile(value.file);
        return file
          ? [
              {
                id: text(value, "id") ?? createFleetId(),
                name: text(value, "name") ?? "Document",
                file,
              },
            ]
          : [];
      })
    : [];

  return {
    id: text(payload, "id", "record_id") ?? `${name}-${makeModel}`,
    name,
    type: text(payload, "type", "vehicle_type", "category") ?? "Vehicle",
    status: text(payload, "status", "readiness") ?? "Unknown",
    location: text(payload, "location", "current_location", "station_name"),
    detail: makeModel || text(payload, "description"),
    year: text(payload, "year"),
    make: text(payload, "make"),
    model: text(payload, "model"),
    vin: text(payload, "vin"),
    plate: text(payload, "plate"),
    assignedTo,
    assignedFire:
      payload.assignedFire && typeof payload.assignedFire === "object"
        ? (payload.assignedFire as Pick<NifcIncident, "id" | "name" | "state">)
        : undefined,
    motive:
      payload.motive && typeof payload.motive === "object"
        ? (payload.motive as MotiveVehicleSnapshot)
        : undefined,
    notes: text(payload, "notes"),
    photo,
    documents,
    files: [
      ...files,
      ...documents.map((document) => ({
        label: document.name,
        file: document.file,
      })),
    ],
    updatedAt: text(
      payload,
      "updatedAt",
      "updated_at",
      "createdAt",
      "created_at",
    ),
    source:
      row.data && typeof row.data === "object"
        ? (row.data as VehicleRow)
        : payload,
  };
}

function records<T>(rows: FleetRecordRow[]): T[] {
  return rows.flatMap((row) =>
    row.data && typeof row.data === "object" ? [row.data as T] : [],
  );
}

function emit(next: SharedFleetSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function createFleetId() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function saveFleetRecords(
  records: { collection: FleetCollection; record: { id: string } }[],
) {
  if (!supabase || !activeCompanyId)
    throw new Error("Company fleet is unavailable.");
  const changes = records.map(({ collection, record }) => {
    const expectedVersion = versions[collection].get(record.id);
    return {
      collection,
      event: expectedVersion === undefined ? "insert" : "update",
      recordId: record.id,
      data: record,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    };
  });
  const { error } = await supabase.rpc("apply_fleet_changes", {
    target_company_id: activeCompanyId,
    changes,
  });
  if (error) {
    if (error.code === "40001")
      throw new Error("Record changed elsewhere. Refresh and try again.");
    throw new Error(error.message);
  }
  await refreshFleet();
}

export async function saveFleetRecord<T extends { id: string }>(
  collection: FleetCollection,
  record: T,
) {
  await saveFleetRecords([{ collection, record }]);
}

export async function inviteCrewMember(
  companyId: string,
  details: { email: string; name: string; phone: string },
) {
  if (!supabase) throw new Error("Invitation service is unavailable.");
  const { data, error } = await supabase.functions.invoke("invite-company-member", {
    body: { companyId, ...details },
  });
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  await refreshFleet();
}

export async function saveCrewMember(
  member: CrewMember,
  user: FireOpsUser,
  detail: string,
) {
  const activity: Activity = {
    id: createFleetId(),
    action: `Credentials updated for ${member.name}`,
    detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "crew",
    targetId: member.id,
    tone: "complete",
  };
  await saveFleetRecords([
    { collection: "crew", record: member },
    { collection: "activities", record: activity },
  ]);
}

export async function removeCrewMember(companyId: string, userId: string) {
  if (!supabase) throw new Error("Crew removal service is unavailable.");
  const { data, error } = await supabase.functions.invoke("remove-company-member", {
    body: { companyId, userId },
  });
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  await refreshFleet();
  return data as { accountDeleted?: boolean; accountCleanupFailed?: boolean };
}

export async function loadCrewSeatsUsed(companyId: string) {
  if (!supabase) throw new Error("Crew usage is unavailable.");
  const { data, error } = await supabase.rpc("company_crew_seats_used", {
    target_company_id: companyId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function deleteFleetVehicle(
  vehicle: FleetVehicle,
  linkedIssues: FleetIssue[],
  user: FireOpsUser,
) {
  if (!supabase || !activeCompanyId)
    throw new Error("Company fleet is unavailable.");
  const vehicleVersion = versions.vehicles.get(vehicle.id);
  if (vehicleVersion === undefined)
    throw new Error("Vehicle changed elsewhere. Refresh and try again.");

  const issueChanges = linkedIssues.map((issue) => {
    const expectedVersion = versions.issues.get(issue.id);
    if (expectedVersion === undefined)
      throw new Error("Linked issues changed elsewhere. Refresh and try again.");
    return {
      collection: "issues",
      event: "delete",
      recordId: issue.id,
      expectedVersion,
    };
  });
  const activityRecord: Activity = {
    id: createFleetId(),
    action: `${vehicle.name} deleted from fleet`,
    detail: linkedIssues.length
      ? `${linkedIssues.length} linked ${linkedIssues.length === 1 ? "issue" : "issues"} also deleted`
      : "Vehicle record deleted",
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    tone: "urgent",
  };
  const changes = [
    ...issueChanges,
    {
      collection: "vehicles",
      event: "delete",
      recordId: vehicle.id,
      expectedVersion: vehicleVersion,
    },
    {
      collection: "activities",
      event: "insert",
      recordId: activityRecord.id,
      data: activityRecord,
    },
  ];
  const { error } = await supabase.rpc("apply_fleet_changes", {
    target_company_id: activeCompanyId,
    changes,
  });
  if (error) {
    if (error.code === "40001")
      throw new Error("Fleet changed elsewhere. Refresh and try again.");
    throw new Error(error.message);
  }
  await refreshFleet();
}

export async function saveFleetVehicleRecord(
  record: { id: string; unit: string; [key: string]: unknown },
  user: FireOpsUser,
  editing: boolean,
) {
  const activityRecord: Activity = {
    id: createFleetId(),
    action: editing
      ? `${record.unit} details updated`
      : `${record.unit} added to fleet`,
    detail: editing ? "Vehicle record changed" : "Vehicle record created",
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: record.id,
    tone: "complete",
  };
  const records = [
    { collection: "vehicles" as const, record },
    { collection: "activities" as const, record: activityRecord },
  ];
  try {
    await saveFleetRecords(records);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      /fetch failed|network connection|network request failed/i.test(message);
    const isDuplicate = /duplicate key|23505/i.test(message);
    if ((!isNetworkError && !isDuplicate) || !supabase || !activeCompanyId)
      throw error;

    // iOS can lose the RPC response after Supabase committed it. Confirm before
    // reporting failure so retrying cannot create a second vehicle or activity.
    const { data, error: verificationError } = await supabase
      .from("fleet_vehicles")
      .select("record_id")
      .eq("company_id", activeCompanyId)
      .eq("record_id", record.id)
      .maybeSingle();
    if (!verificationError && data) {
      await refreshFleet();
      return;
    }
    if (isNetworkError)
      throw new Error(
        "Network connection was lost before the vehicle could be confirmed. Check your connection and try again.",
      );
    throw error;
  }
}

export async function updateFleetVehicle(
  vehicle: FleetVehicle,
  patch: {
    status?: VehicleStatus;
    assignedTo?: string;
    clearAssignment?: boolean;
    assignedFire?: Pick<NifcIncident, "id" | "name" | "state">;
    clearFireAssignment?: boolean;
  },
  user: FireOpsUser,
  activity: { action: string; detail: string; tone?: Activity["tone"] },
) {
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    unit: vehicle.name,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.clearAssignment
      ? { assignedTo: undefined, assignedFire: undefined }
      : {}),
    ...(patch.assignedTo ? { assignedTo: patch.assignedTo } : {}),
    ...(patch.clearFireAssignment
      ? { assignedFire: undefined }
      : patch.assignedFire
        ? { assignedFire: patch.assignedFire }
        : {}),
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: activity.action,
    detail: activity.detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: activity.tone,
  };
  await saveFleetRecords([
    { collection: "vehicles", record },
    { collection: "activities", record: activityRecord },
  ]);
}

export async function updateFleetVehicleFiles(
  vehicle: FleetVehicle,
  patch: {
    photo?: FleetVehicleFile | null;
    documents?: FleetVehicleDocument[];
  },
  user: FireOpsUser,
  activity: { action: string; detail: string },
) {
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    unit: vehicle.name,
    ...(patch.photo !== undefined ? { photo: patch.photo ?? undefined } : {}),
    ...(patch.documents !== undefined ? { documents: patch.documents } : {}),
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: activity.action,
    detail: activity.detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: "complete",
  };
  await saveFleetRecords([
    { collection: "vehicles", record },
    { collection: "activities", record: activityRecord },
  ]);
}

export function refreshFleet() {
  if (request && requestVersion === companyVersion) {
    refreshQueued = true;
    return request;
  }
  refreshQueued = false;
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
      emit({
        ...snapshot,
        loading: false,
        refreshing: false,
        error:
          "Fleet could not load. Supabase is not configured for this build.",
      });
      return;
    }
    if (!companyId) {
      if (version === companyVersion)
        emit({ ...snapshot, loading: false, refreshing: false, error: null });
      return;
    }

    const client = supabase;
    const collections = Object.entries(tables) as [FleetCollection, string][];
    let results;
    try {
      results = await Promise.all(
        collections.map(([, table]) =>
          client
            .from(table)
            .select("record_id, data, version, updated_at")
            .eq("company_id", companyId)
            .order("updated_at", { ascending: false }),
        ),
      );
    } catch (loadError) {
      if (version === companyVersion) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Network request failed.";
        emit({
          ...snapshot,
          loading: false,
          refreshing: false,
          error: `Fleet could not load. ${message}`,
        });
      }
      return;
    }
    if (version !== companyVersion) return;

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      emit({
        ...snapshot,
        loading: false,
        refreshing: false,
        error: `Fleet could not load. ${failed.error.message}`,
      });
      return;
    }

    const loaded = Object.fromEntries(
      collections.map(([collection], index) => {
        const rows = (results[index].data ?? []) as FleetRecordRow[];
        versions[collection] = new Map(
          rows.map((row) => [row.record_id, row.version]),
        );
        return [collection, records(rows)];
      }),
    ) as Record<FleetCollection, unknown[]>;

    const vehicles = (results[0].data ?? [])
      .map((row) => normalizeVehicle(row as VehicleRow))
      .sort((a, b) => a.name.localeCompare(b.name));
    const issues = (loaded.issues as FleetIssue[])
      .map((issue) => ({
        ...issue,
        status: issue.status ?? "Open",
        updates: issue.updates ?? [],
      }))
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
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === companyVersion) {
      refreshQueued = false;
      void refreshFleet();
    }
  });
  requestVersion = version;
  return request;
}

function selectCompany(companyId: string | null) {
  if (companyId === activeCompanyId) return;
  activeCompanyId = companyId;
  companyVersion += 1;
  refreshQueued = false;

  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({
    vehicles: [],
    issues: [],
    crew: [],
    activities: [],
    loading: Boolean(companyId),
    refreshing: false,
    error: null,
  });
  if (!companyId || !supabase) return;

  channel = supabase.channel(`mobile-fleet:${companyId}`);
  Object.values(tables).forEach((table) => {
    channel =
      channel?.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `company_id=eq.${companyId}`,
        },
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
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
