import { describe, expect, it } from 'vitest';
import { commandAlerts, commandCenter, type CommandVehicle } from './command-center';
import { needsAttentionRows, withNeedsAttentionCard } from './command-attention';
import type { CrewMember } from './models';
import type { ShopJob } from './shop';

const now = new Date('2026-11-06T12:00:00');

const vehicle = (overrides: Partial<CommandVehicle> = {}): CommandVehicle => ({
  id: 'v1', unit: 'Engine 701', status: 'Ready', nextOilChange: '40,000 mi', nextOilChangeDue: '2026-11-01', ...overrides,
});

const job = (overrides: Partial<ShopJob> = {}): ShopJob => ({
  id: 'job-1', companyId: 'c1', jobNumber: 'SJ-0001', title: 'Replace hose', description: 'Leak at coupler',
  priority: 'critical', status: 'queued', kind: 'fleet', fleetVehicleId: 'v1', openedByName: 'Tech',
  openedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const member = (overrides: Partial<CrewMember> = {}): CrewMember => ({
  id: 'crew-1', name: 'Alex Crew', email: 'alex@example.com', phone: '', role: 'fire_fighter', status: 'Active', ...overrides,
});

const lapsedRt130 = { rt130CompletionDate: '2025-07-15', rt130CurrencyDate: '2026-07-15', wctCompletionDate: '', wctCurrencyDate: '' };

describe('needsAttentionRows', () => {
  it('includes open critical and high shop repairs, critical first, and links to the shop job', () => {
    const rows = needsAttentionRows([vehicle({ nextOilChangeDue: '2027-01-01' })], [], [
      job({ id: 'high', title: 'Tighten bolts', priority: 'high' }),
      job(),
      job({ id: 'normal', title: 'Wipe mirrors', priority: 'medium' }),
      job({ id: 'done', title: 'Closed critical', status: 'done' }),
      job({ id: 'general', title: 'Fix bay door', priority: 'high', kind: 'general', fleetVehicleId: undefined, shopArea: 'Bay 2', status: 'parts' }),
    ], now);
    expect(rows.map((row) => row.title)).toEqual(['Replace hose', 'Tighten bolts', 'Fix bay door']);
    expect(rows[0]).toMatchObject({
      id: 'attention-shop-job-1', badge: 'Critical', urgent: true, lines: ['Leak at coupler'],
      detail: 'Engine 701 · Critical shop repair · Not started', target: { type: 'shop', id: 'job-1' },
    });
    expect(rows[2]?.detail).toBe('Bay 2 · High shop repair · Waiting on parts');
  });

  it('includes oil changes that are due by date', () => {
    expect(needsAttentionRows([vehicle(), vehicle({ id: 'v2', unit: 'Engine 702', nextOilChangeDue: '2026-12-01' })], [], [], now)).toEqual([
      expect.objectContaining({
        id: 'attention-oil-v1', title: 'Engine 701 — oil change due', detail: '40,000 mi · Due 2026-11-01',
        badge: 'Oil due', urgent: true, target: { type: 'vehicle', id: 'v1' },
      }),
    ]);
  });

  it('includes lapsing annual qualifications and expiring credentials', () => {
    const rows = needsAttentionRows([], [member({
      annualRecord: lapsedRt130,
      credentials: [
        { id: 'red-card', name: 'Red Card', expirationDate: '2026-11-20', file: { name: 'red.pdf', type: 'application/pdf', dataUrl: '' } },
        { id: 'cpr', name: 'CPR', expirationDate: '2026-11-01', file: { name: 'cpr.pdf', type: 'application/pdf', dataUrl: '' } },
        { id: 'far', name: 'EMT', expirationDate: '2027-06-01', file: { name: 'emt.pdf', type: 'application/pdf', dataUrl: '' } },
      ],
    })], [], now);
    expect(rows.map((row) => [row.title, row.badge, row.urgent])).toEqual([
      ['Alex Crew — RT-130 expired', 'Expired', true],
      ['Alex Crew — Red Card expires soon', 'Due soon', false],
      ['Alex Crew — CPR expired', 'Expired', true],
    ]);
    expect(rows.every((row) => row.target?.type === 'crew' && row.target.id === 'crew-1')).toBe(true);
  });

  it('drops resolved repairs, logged oil changes and renewed qualifications', () => {
    const open = needsAttentionRows([vehicle()], [member({ annualRecord: lapsedRt130 })], [job()], now);
    expect(open.map((row) => row.id)).toEqual(['attention-shop-job-1', 'attention-oil-v1', 'attention-annual-crew-1-rt130CompletionDate']);
    const resolved = needsAttentionRows(
      [vehicle({ nextOilChangeDue: '2027-05-01' })],
      [member({ annualRecord: { ...lapsedRt130, rt130CompletionDate: '2026-10-01', rt130CurrencyDate: '2027-10-01' } })],
      [job({ status: 'done' })],
      now,
    );
    expect(resolved).toEqual([]);
  });

  it('shares the annual qualification rule with Command Center alerts', () => {
    const crew = [member({ annualRecord: lapsedRt130 })];
    expect(commandAlerts([], [], [], now, crew).map((alert) => [alert.id, alert.kind])).toEqual([['annual-crew-1-rt130CompletionDate', 'crew']]);
  });
});

describe('withNeedsAttentionCard', () => {
  it('replaces only the Needs Attention card', () => {
    const base = commandCenter([vehicle({ assignedTo: 'crew-1' })], [member()], []);
    const rows = needsAttentionRows([vehicle()], [], [job()], now);
    const cards = withNeedsAttentionCard(base, rows);
    expect(cards.find((card) => card.id === 'attention')).toMatchObject({
      title: 'Needs Attention',
      description: 'Critical and high shop repairs, oil changes due, and expiring qualifications',
      summary: '2 urgent items',
      rows,
    });
    expect(cards.filter((card) => card.id !== 'attention')).toEqual(base.filter((card) => card.id !== 'attention'));
  });

  it('summarizes non-urgent and empty lists', () => {
    const base = commandCenter([], [], []);
    const dueSoon = needsAttentionRows([], [member({ credentials: [{ id: 'r', name: 'Red Card', expirationDate: '2026-11-20', file: { name: 'r.pdf', type: 'application/pdf', dataUrl: '' } }] })], [], now);
    expect(withNeedsAttentionCard(base, dueSoon).find((card) => card.id === 'attention')?.summary).toBe('1 item to review');
    expect(withNeedsAttentionCard(base, []).find((card) => card.id === 'attention')?.summary).toBe('Nothing needs attention');
  });
});
