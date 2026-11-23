import { describe, expect, it } from 'vitest';
import { commandAlerts, commandCenter, type CommandVehicle } from './command-center';
import { needsAttentionRows, resourceAttentionRows, withNeedsAttentionCard } from './command-attention';
import type { CrewMember, FleetIssue, InventoryItem } from './models';

const now = new Date('2026-11-06T12:00:00');

const vehicle = (overrides: Partial<CommandVehicle> = {}): CommandVehicle => ({
  id: 'v1', unit: 'Engine 701', status: 'Ready', nextOilChange: '40,000 mi', nextOilChangeDue: '2026-11-01', ...overrides,
});

const member = (overrides: Partial<CrewMember> = {}): CrewMember => ({
  id: 'crew-1', name: 'Alex Crew', email: 'alex@example.com', phone: '', role: 'fire_fighter', status: 'Active', ...overrides,
});

const lapsedRt130 = { rt130CompletionDate: '2025-07-15', rt130CurrencyDate: '2026-07-15', wctCompletionDate: '', wctCurrencyDate: '' };

describe('needsAttentionRows', () => {
  it('includes oil changes that are due by date', () => {
    expect(needsAttentionRows([vehicle(), vehicle({ id: 'v2', unit: 'Engine 702', nextOilChangeDue: '2026-12-01' })], [], now)).toEqual([
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
    })], now);
    expect(rows.map((row) => [row.title, row.badge, row.urgent])).toEqual([
      ['Alex Crew — RT-130 expired', 'Expired', true],
      ['Alex Crew — Red Card expires soon', 'Due soon', false],
      ['Alex Crew — CPR expired', 'Expired', true],
    ]);
    expect(rows.every((row) => row.target?.type === 'crew' && row.target.id === 'crew-1')).toBe(true);
  });

  it('drops logged oil changes and renewed qualifications', () => {
    const open = needsAttentionRows([vehicle()], [member({ annualRecord: lapsedRt130 })], now);
    expect(open.map((row) => row.id)).toEqual(['attention-oil-v1', 'attention-annual-crew-1-rt130CompletionDate']);
    const resolved = needsAttentionRows(
      [vehicle({ nextOilChangeDue: '2027-05-01' })],
      [member({ annualRecord: { ...lapsedRt130, rt130CompletionDate: '2026-10-01', rt130CurrencyDate: '2027-10-01' } })],
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
    const rows = needsAttentionRows([vehicle()], [], now);
    const cards = withNeedsAttentionCard(base, rows);
    expect(cards.find((card) => card.id === 'attention')).toMatchObject({
      title: 'Needs Attention',
      description: 'Oil changes due and expiring qualifications',
      summary: '1 urgent item',
      rows,
    });
    expect(cards.filter((card) => card.id !== 'attention')).toEqual(base.filter((card) => card.id !== 'attention'));
  });

  it('summarizes non-urgent and empty lists', () => {
    const base = commandCenter([], [], []);
    const dueSoon = needsAttentionRows([], [member({ credentials: [{ id: 'r', name: 'Red Card', expirationDate: '2026-11-20', file: { name: 'r.pdf', type: 'application/pdf', dataUrl: '' } }] })], now);
    expect(withNeedsAttentionCard(base, dueSoon).find((card) => card.id === 'attention')?.summary).toBe('1 item to review');
    expect(withNeedsAttentionCard(base, []).find((card) => card.id === 'attention')?.summary).toBe('Nothing needs attention');
  });
});

describe('resourceAttentionRows', () => {
  const issue = (overrides: Partial<FleetIssue> = {}): FleetIssue => ({
    id: 'i1', vehicleId: 'v1', title: 'Pump leak', description: 'Drips at idle', priority: 'Critical', status: 'Open',
    updates: [], createdBy: 'Crew', createdById: 'u1', createdAt: '2026-11-05T10:00:00Z', ...overrides,
  });
  const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
    id: 'g1', name: 'Radios', quantity: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', checkouts: [], ...overrides,
  });

  it('lists open critical/high fleet issues first, then overdue gear, then empty stock', () => {
    const rows = resourceAttentionRows(
      [issue({ id: 'low', priority: 'Low' }), issue({ id: 'high', priority: 'High' }), issue(), issue({ id: 'done', status: 'Resolved' })],
      [vehicle()],
      [
        item({ id: 'empty', name: 'Shelters', quantity: 0, checkouts: [{ userId: 'u2', userName: 'Maya', quantity: 2, checkedOutAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }] }),
        item({ checkouts: [
          { userId: 'u3', userName: 'Cole', quantity: 1, checkedOutAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
          { userId: 'u4', userName: 'Jo', quantity: 1, checkedOutAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
        ] }),
      ],
      now,
    );
    expect(rows.map(row => row.id)).toEqual(['attention-issue-i1', 'attention-issue-high', 'attention-gear-g1-u3', 'attention-stock-empty']);
    expect(rows[0]).toMatchObject({ detail: 'Engine 701 · Critical priority fleet issue', badge: 'Critical', urgent: true, target: { type: 'issue', id: 'i1' } });
    expect(rows[2]).toMatchObject({ title: 'Radios — Cole', badge: 'Overdue', target: { type: 'inventory', id: 'g1' } });
    expect(rows[3]).toMatchObject({ title: 'Shelters — out of stock', detail: 'None on hand · 2 checked out', urgent: false });
  });

  it('is empty when nothing needs attention', () => {
    expect(resourceAttentionRows([issue({ priority: 'Medium' })], [vehicle()], [item()], now)).toEqual([]);
  });
});
