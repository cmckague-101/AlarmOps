import { describe, expect, it } from 'vitest';
import {
  canAssignShopJobs, canWorkShop, filterShopJobs, groupShopJobsByVehicle, rankShopJobs, shopBoardStatus, shopJobFromRow, shopPriorityLabel,
  sortShopJobs, validateShopJobBlocker, type ShopJob, type ShopJobRow,
} from './shop';

const job = (id: string, priority: 'critical' | 'high' | 'medium' | 'low', status: 'parts' | 'queued' | 'progress', openedAt: string) => ({ id, priority, status, openedAt });

const full = (overrides: Partial<ShopJob> = {}): ShopJob => ({
  id: 'j1', companyId: 'c1', jobNumber: 'SJ-0001', title: 'Replace hose', description: '', priority: 'medium', status: 'queued',
  kind: 'fleet', fleetVehicleId: 'v1', openedByName: 'Tech', openedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', ...overrides,
});

describe('shop board ranking', () => {
  it('sorts critical > high > normal > low, blockers first, then oldest', () => {
    const ranked = rankShopJobs([
      job('d', 'low', 'queued', '2026-01-04T00:00:00Z'),
      job('c', 'medium', 'parts', '2026-01-03T00:00:00Z'),
      job('b', 'high', 'queued', '2026-01-02T00:00:00Z'),
      job('a', 'critical', 'progress', '2026-01-05T00:00:00Z'),
      job('e', 'medium', 'queued', '2026-01-01T00:00:00Z'),
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b', 'c', 'e', 'd']);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('labels medium as Normal and keeps sort stable by id', () => {
    expect(shopPriorityLabel('medium')).toBe('Normal');
    expect(sortShopJobs([job('b', 'high', 'queued', '2026-01-01T00:00:00Z'), job('a', 'high', 'queued', '2026-01-01T00:00:00Z')]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('requires blocker reasons', () => {
    expect(validateShopJobBlocker('parts')).toMatch(/cannot be worked/i);
    expect(validateShopJobBlocker('parts', 'Waiting on hose')).toBeNull();
    expect(validateShopJobBlocker('queued')).toBeNull();
  });
});

describe('shop board views', () => {
  it('lets owners, admins and shop techs work the board', () => {
    expect(['owner', 'admin', 'resource_boss', 'shop_tech', 'fire_fighter', 'accounting'].map(canWorkShop)).toEqual([true, true, true, true, false, false]);
    expect(['owner', 'admin', 'resource_boss', 'shop_tech', 'fire_fighter', 'accounting'].map(canAssignShopJobs)).toEqual([true, true, true, false, false, false]);
  });

  it('filters open jobs by status and searches title, number, unit and assignee', () => {
    const jobs = [full(), full({ id: 'j2', jobNumber: 'SJ-0002', title: 'Sharpen chain', kind: 'general', fleetVehicleId: undefined, shopArea: 'Saw shop', status: 'progress', assignedTechName: 'Riley' }), full({ id: 'j3', status: 'done' })];
    const unit = (item: ShopJob) => (item.fleetVehicleId === 'v1' ? 'Engine 701' : undefined);
    expect(filterShopJobs(jobs, 'open', '', unit).map((item) => item.id)).toEqual(['j1', 'j2']);
    expect(filterShopJobs(jobs, 'progress', '', unit).map((item) => item.id)).toEqual(['j2']);
    expect(filterShopJobs(jobs, 'open', 'engine', unit).map((item) => item.id)).toEqual(['j1']);
    expect(filterShopJobs(jobs, 'open', 'riley', unit).map((item) => item.id)).toEqual(['j2']);
    expect(filterShopJobs(jobs, 'open', 'sj-0001', unit).map((item) => item.id)).toEqual(['j1']);
  });

  it('groups units with open work, busiest first', () => {
    const vehicles = [{ id: 'v1', unit: 'Engine 701' }, { id: 'v2', unit: 'Dozer 4' }, { id: 'v3', unit: 'Tender 12' }];
    const jobs = [full(), full({ id: 'j2', fleetVehicleId: 'v2' }), full({ id: 'j3', fleetVehicleId: 'v2' }), full({ id: 'j4', fleetVehicleId: 'v3', status: 'done' })];
    const groups = groupShopJobsByVehicle(vehicles, jobs, jobs);
    expect(groups.map((group) => [group.vehicle.unit, group.openCount])).toEqual([['Dozer 4', 2], ['Engine 701', 1]]);
  });

  it('maps rows and shows off-board statuses as Not started', () => {
    const row: ShopJobRow = {
      id: 'j1', company_id: 'c1', job_number: 'SJ-0001', title: 'Hose', description: null, priority: 'high', status: 'approval',
      blocker_reason: 'Owner sign-off', kind: 'fleet', shop_area: null, fleet_vehicle_id: 'v1', source_fleet_issue_id: 'i1',
      assigned_tech_id: null, assigned_tech_name: null, assigned_at: null, location: null, opened_by: 'u1', opened_by_name: 'Tech',
      opened_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const mapped = shopJobFromRow(row);
    expect(mapped).toMatchObject({ description: '', sourceFleetIssueId: 'i1', blockerReason: 'Owner sign-off', shopArea: undefined, assignedTechId: undefined });
    expect(shopBoardStatus(mapped.status)).toBe('queued');
    expect(shopBoardStatus('done')).toBe('done');
  });
});
