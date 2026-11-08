export type RepairReadingUnit = 'miles' | 'hrs';
export type RepairReadingSource = 'motive' | 'manual';

export type RepairType = {
  id: string;
  companyId: string;
  name: string;
  nameNormalized: string;
  isCustom: boolean;
  useCount: number;
  lastUsedAt?: string;
};

export type FleetRepair = {
  id: string;
  companyId: string;
  fleetVehicleId: string;
  repairTypeId?: string;
  repairTypeText: string;
  readingValue: number;
  readingUnit: RepairReadingUnit;
  readingSource: RepairReadingSource;
  manualReason?: string;
  motiveLocatedAt?: string;
  techId?: string;
  techName: string;
  laborHours?: number;
  notes: string;
  shopJobId?: string;
  repairedOn: string;
  createdAt: string;
};

export type RepairTypeRow = {
  id: string; company_id: string; name: string; name_normalized: string; is_custom: boolean; use_count: number; last_used_at: string | null;
};

export type FleetRepairRow = {
  id: string; company_id: string; fleet_vehicle_id: string; repair_type_id: string | null; repair_type_text: string;
  reading_value: number | string; reading_unit: RepairReadingUnit; reading_source: RepairReadingSource; manual_reason: string | null;
  motive_located_at: string | null; tech_id: string | null; tech_name: string; labor_hours: number | string | null; notes: string | null;
  shop_job_id: string | null; repaired_on: string; created_at: string;
};

export const REPAIR_TYPE_COLUMNS = 'id,company_id,name,name_normalized,is_custom,use_count,last_used_at';
export const FLEET_REPAIR_COLUMNS = 'id,company_id,fleet_vehicle_id,repair_type_id,repair_type_text,reading_value,reading_unit,reading_source,manual_reason,motive_located_at,tech_id,tech_name,labor_hours,notes,shop_job_id,repaired_on,created_at';

export function repairTypeFromRow(row: RepairTypeRow): RepairType {
  return {
    id: row.id, companyId: row.company_id, name: row.name, nameNormalized: row.name_normalized,
    isCustom: row.is_custom, useCount: row.use_count, lastUsedAt: row.last_used_at ?? undefined,
  };
}

/** numeric columns arrive as strings from PostgREST. */
export function fleetRepairFromRow(row: FleetRepairRow): FleetRepair {
  return {
    id: row.id, companyId: row.company_id, fleetVehicleId: row.fleet_vehicle_id, repairTypeId: row.repair_type_id ?? undefined,
    repairTypeText: row.repair_type_text, readingValue: Number(row.reading_value), readingUnit: row.reading_unit,
    readingSource: row.reading_source, manualReason: row.manual_reason ?? undefined, motiveLocatedAt: row.motive_located_at ?? undefined,
    techId: row.tech_id ?? undefined, techName: row.tech_name,
    laborHours: row.labor_hours === null || row.labor_hours === undefined ? undefined : Number(row.labor_hours),
    notes: row.notes ?? '', shopJobId: row.shop_job_id ?? undefined, repairedOn: row.repaired_on, createdAt: row.created_at,
  };
}

export const defaultRepairTypeNames = [
  'Oil change', 'Filters', 'Brakes', 'Tires', 'Battery', 'Belts', 'Coolant flush',
  'Hydraulic hose', 'DOT inspection prep', 'Electrical', 'Lights', 'Wipers', 'Pump service', 'Undercarriage',
] as const;

export function normalizeRepairTypeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const lastUsed = (type: RepairType) => (type.lastUsedAt ? Date.parse(type.lastUsedAt) : 0) || 0;

export function suggestRepairTypes(types: readonly RepairType[], query: string, limit = 8): RepairType[] {
  const needle = normalizeRepairTypeName(query);
  if (!needle) {
    return [...types]
      .sort((a, b) => (b.useCount - a.useCount) || (lastUsed(b) - lastUsed(a)) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
  const prefix = types.filter((type) => type.nameNormalized.startsWith(needle));
  const contains = types.filter((type) => !type.nameNormalized.startsWith(needle) && type.nameNormalized.includes(needle));
  const rank = (list: RepairType[]) => [...list].sort((a, b) => (b.useCount - a.useCount) || a.name.localeCompare(b.name));
  return [...rank(prefix), ...rank(contains)].slice(0, limit);
}

export function recentRepairTypes(types: readonly RepairType[], limit = 6): RepairType[] {
  return types.filter((type) => type.lastUsedAt).sort((a, b) => lastUsed(b) - lastUsed(a)).slice(0, limit);
}

export function sortFleetRepairsByReading(repairs: readonly FleetRepair[]): FleetRepair[] {
  return [...repairs].sort((a, b) => b.readingValue - a.readingValue || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function formatRepairReading(value: number, unit: RepairReadingUnit): string {
  const rounded = Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return unit === 'hrs' ? `${rounded} hrs` : `${rounded} mi`;
}

/** Client-side check before filing; the server decides whether a Motive reading exists. */
export function validateFleetRepairDraft(input: {
  repairTypeText: string;
  hasMotiveReading: boolean;
  manualReadingValue?: string;
  manualReason?: string;
  laborHours?: string;
}): string | null {
  if (!input.repairTypeText.trim()) return 'Enter a repair type.';
  if (input.repairTypeText.trim().length > 120) return 'Keep the repair type under 120 characters.';
  if (input.laborHours?.trim()) {
    const hours = Number(input.laborHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 999) return 'Labor hours must be between 0 and 999.';
  }
  if (input.hasMotiveReading) return null;
  const reading = Number(input.manualReadingValue);
  if (!input.manualReadingValue?.trim() || !Number.isFinite(reading) || reading < 0) return 'Enter the odometer or engine-hour reading.';
  if (!input.manualReason?.trim()) return 'Enter a reason for the manual reading.';
  return null;
}

export type FleetRepairFileRequest = {
  companyId: string;
  vehicleId: string;
  repairTypeText: string;
  laborHours?: number;
  notes?: string;
  openJob?: boolean;
  manualReadingValue?: number;
  manualReadingUnit?: RepairReadingUnit;
  manualReason?: string;
};
