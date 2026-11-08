import { describe, expect, it } from 'vitest';
import {
  fleetRepairFromRow, formatRepairReading, normalizeRepairTypeName, sortFleetRepairsByReading, suggestRepairTypes,
  validateFleetRepairDraft, type FleetRepair, type RepairType,
} from './fleet-repairs';
import { repairHistoryEntries, repairHistoryHtml } from './shop-repair-history';
import type { ShopJob } from './shop';

const type = (id: string, name: string, useCount: number, lastUsedAt?: string): RepairType => ({
  id, companyId: 'c1', name, nameNormalized: normalizeRepairTypeName(name), isCustom: false, useCount, lastUsedAt,
});

describe('fleet repairs helpers', () => {
  it('ranks typeahead prefix matches before contains, then by use_count', () => {
    const suggestions = suggestRepairTypes([type('1', 'Oil change', 2), type('2', 'Coolant flush', 9), type('3', 'Boil over repair', 1), type('4', 'Oil filter', 5)], 'oil');
    expect(suggestions.map((item) => item.id)).toEqual(['4', '1', '3']);
  });

  it('sorts history by reading descending', () => {
    const repairs = sortFleetRepairsByReading([
      { id: 'a', readingValue: 100, createdAt: '2026-01-02T00:00:00Z' },
      { id: 'b', readingValue: 500, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c', readingValue: 500, createdAt: '2026-01-03T00:00:00Z' },
    ] as FleetRepair[]);
    expect(repairs.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('formats readings and validates drafts', () => {
    expect(formatRepairReading(48210, 'miles')).toBe('48,210 mi');
    expect(formatRepairReading(12.5, 'hrs')).toBe('12.5 hrs');
    expect(validateFleetRepairDraft({ repairTypeText: '', hasMotiveReading: true })).toMatch(/repair type/i);
    expect(validateFleetRepairDraft({ repairTypeText: 'Brakes', hasMotiveReading: true })).toBeNull();
    expect(validateFleetRepairDraft({ repairTypeText: 'Brakes', hasMotiveReading: false, manualReadingValue: '1200' })).toMatch(/reason/i);
    expect(validateFleetRepairDraft({ repairTypeText: 'Brakes', hasMotiveReading: false, manualReadingValue: '', manualReason: 'No telematics' })).toMatch(/reading/i);
    expect(validateFleetRepairDraft({ repairTypeText: 'Brakes', hasMotiveReading: false, manualReadingValue: '1200', manualReason: 'No telematics' })).toBeNull();
    expect(validateFleetRepairDraft({ repairTypeText: 'Brakes', hasMotiveReading: true, laborHours: '-1' })).toMatch(/labor/i);
  });

  it('maps numeric columns from strings', () => {
    const repair = fleetRepairFromRow({
      id: 'r1', company_id: 'c1', fleet_vehicle_id: 'v1', repair_type_id: null, repair_type_text: 'Brakes', reading_value: '48210.50',
      reading_unit: 'miles', reading_source: 'motive', manual_reason: null, motive_located_at: null, tech_id: 'u1', tech_name: 'Tech',
      labor_hours: '1.50', notes: null, shop_job_id: null, repaired_on: '2026-01-01', created_at: '2026-01-01T00:00:00Z',
    });
    expect(repair).toMatchObject({ readingValue: 48210.5, laborHours: 1.5, notes: '', repairTypeId: undefined });
  });
});

describe('repair history', () => {
  const closed: ShopJob = {
    id: 'j1', companyId: 'c1', jobNumber: 'SJ-0001', title: 'Pump <seal>', description: '', priority: 'high', status: 'done', kind: 'fleet',
    fleetVehicleId: 'v1', assignedTechName: 'Riley', openedByName: 'Tech', openedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
  };
  const repair = { id: 'r1', companyId: 'c1', fleetVehicleId: 'v1', repairTypeText: 'Brakes', readingValue: 48210, readingUnit: 'miles', readingSource: 'manual',
    manualReason: 'Motive offline', techName: 'Tech', notes: 'Pads + rotors', repairedOn: '2026-01-02', createdAt: '2026-01-02T00:00:00Z' } as FleetRepair;

  it('merges closed jobs and filed repairs, newest first, with job notes', () => {
    const entries = repairHistoryEntries([closed, { ...closed, id: 'j2', status: 'progress' }], [repair], [
      { id: 'n1', companyId: 'c1', jobId: 'j1', body: 'Replaced seal', kind: 'note', authorName: 'Riley', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'n2', companyId: 'c1', jobId: 'j1', body: 'Status changed', kind: 'system', authorName: 'System', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['job:j1', 'repair:r1']);
    expect(entries[0]).toMatchObject({ notes: 'Replaced seal', meta: 'SJ-0001 · High · Riley' });
    expect(entries[1]?.meta).toBe('48,210 mi (manual: Motive offline) · Tech');
  });

  it('escapes printable HTML', () => {
    const html = repairHistoryHtml({ title: 'Engine 701', subtitle: 'Completed repairs' }, repairHistoryEntries([closed], [], []));
    expect(html).toContain('Pump &lt;seal&gt;');
    expect(html).toContain('1 record');
  });
});
