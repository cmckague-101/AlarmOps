import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSyncPatch, mergeSyncUpdate, type SyncPatch, type SyncRecord } from './offline-sync';

const serverParityCases = JSON.parse(readFileSync(new URL('../test-fixtures/offline-sync-merge.json', import.meta.url), 'utf8')) as {
  name: string; base: SyncRecord; current: SyncRecord | null; patch: SyncPatch; groups?: string[][]; expected: unknown;
}[];

describe('shared PostgreSQL/client merge fixtures', () => {
  it.each(serverParityCases)('$name', ({ base, current, patch, groups, expected }) => {
    expect(mergeSyncUpdate(base, current, patch, { fieldGroups: groups })).toEqual(expected);
  });
});

const present = (value: string | number | null) => ({ present: true as const, value });
const absent = { present: false as const };

function merge(base: SyncRecord, current: SyncRecord | null, proposed: SyncRecord) {
  return mergeSyncUpdate(base, current, createSyncPatch(base, proposed));
}

describe('offline three-way field merge', () => {
  it('combines independent edits without reverting current server fields', () => {
    expect(merge(
      { phone: 'old', notes: 'old', status: 'ready' },
      { phone: 'new', notes: 'old', status: 'assigned' },
      { phone: 'old', notes: 'field report', status: 'ready' },
    )).toEqual({
      kind: 'merged', record: { phone: 'new', notes: 'field report', status: 'assigned' }, changedFields: ['notes'],
    });
  });

  it('keeps base/current/proposed context for incompatible overlapping values', () => {
    expect(merge({ status: 'ready' }, { status: 'assigned' }, { status: 'out of service' })).toEqual({
      kind: 'conflict', reason: 'fields', fields: [{
        field: 'status', reason: 'overlap', base: present('ready'), current: present('assigned'),
        proposed: present('out of service'), relatedFields: [],
      }],
    });
  });

  it('does not return an applicable partial result when some fields conflict', () => {
    const result = merge({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 2 });
    expect(result.kind).toBe('conflict');
    expect(result).not.toHaveProperty('record');
    expect(result).not.toHaveProperty('changedFields');
  });

  it('treats identical outcomes as acknowledged no-ops', () => {
    expect(merge({ value: 1 }, { value: 2 }, { value: 2 })).toEqual({
      kind: 'merged', record: { value: 2 }, changedFields: [],
    });
  });

  it('does not interpret redundant unchanged values as a request to revert shared data', () => {
    expect(mergeSyncUpdate({ value: 1 }, { value: 2 }, { value: present(1) })).toEqual({
      kind: 'merged', record: { value: 2 }, changedFields: [],
    });
  });

  it('handles absent, null, false, zero and empty string distinctly', () => {
    const base = { remove: 'old', nullable: 'old', flag: true, count: 1, text: 'old' };
    const proposed = { nullable: null, flag: false, count: 0, text: '' };
    expect(createSyncPatch(base, proposed)).toEqual({
      remove: absent, nullable: present(null), flag: { present: true, value: false }, count: present(0), text: present(''),
    });
    expect(merge(base, base, proposed)).toEqual({
      kind: 'merged', record: proposed, changedFields: ['count', 'flag', 'nullable', 'remove', 'text'],
    });
    expect(merge({ value: null }, {}, { value: 'new' }).kind).toBe('conflict');
    expect(merge({}, { value: null }, { value: 'new' }).kind).toBe('conflict');
  });

  it('accepts concurrent identical additions and removals', () => {
    expect(merge({}, { value: null }, { value: null })).toEqual({
      kind: 'merged', record: { value: null }, changedFields: [],
    });
    expect(merge({ value: 1 }, {}, {})).toEqual({ kind: 'merged', record: {}, changedFields: [] });
  });

  it('flags incompatible additions and field edit-versus-removal', () => {
    expect(merge({}, { value: 1 }, { value: 2 }).kind).toBe('conflict');
    expect(merge({ value: 1 }, { value: 2 }, {}).kind).toBe('conflict');
    expect(merge({ value: 1 }, {}, { value: 2 }).kind).toBe('conflict');
  });

  it('does not resurrect authoritatively deleted records', () => {
    expect(merge({ value: 1 }, null, { value: 2 })).toEqual({ kind: 'conflict', reason: 'deleted' });
    expect(merge({ value: 1 }, null, { value: 1 })).toEqual({ kind: 'conflict', reason: 'deleted' });
  });

  it('compares nested JSON without depending on object key order', () => {
    const base = { details: { a: 1, b: [2, { c: null }] } };
    const reordered = { details: { b: [2, { c: null }], a: 1 } };
    expect(createSyncPatch(base, reordered)).toEqual({});
    expect(merge({ details: {} }, base, reordered)).toEqual({ kind: 'merged', record: base, changedFields: [] });
  });

  it('treats nested objects and ordered arrays as indivisible fields', () => {
    expect(merge({ details: { a: 1, b: 1 } }, { details: { a: 2, b: 1 } }, { details: { a: 1, b: 2 } }).kind).toBe('conflict');
    expect(merge({ rows: [1, 2] }, { rows: [2, 1] }, { rows: [1, 2, 3] }).kind).toBe('conflict');
  });

  it('returns independent value copies and never mutates input records or patches', () => {
    const base = { details: { value: 1 }, server: { value: 1 } };
    const current = { details: { value: 1 }, server: { value: 2 } };
    const proposed = { details: { value: 2 }, server: { value: 1 } };
    const patch = createSyncPatch(base, proposed);
    proposed.details.value = 3;
    const result = mergeSyncUpdate(base, current, patch);
    expect(result).toEqual({ kind: 'merged', record: { details: { value: 2 }, server: { value: 2 } }, changedFields: ['details'] });
    current.server.value = 4;
    expect(result.kind === 'merged' && result.record.server).toEqual({ value: 2 });
    expect(base.details.value).toBe(1);
  });

  it('preserves every overlapping field in deterministic order', () => {
    const result = merge({ z: 0, a: 0 }, { z: 1, a: 1 }, { z: 2, a: 2 });
    expect(result.kind === 'conflict' && result.reason === 'fields' && result.fields.map((item) => item.field)).toEqual(['a', 'z']);
  });

  it('leaves sequential competing proposals unresolved against the same shared record', () => {
    const base = { status: 'ready' };
    const current = { status: 'assigned' };
    for (const status of ['out of service', 'maintenance']) {
      const result = merge(base, current, { status });
      expect(result.kind === 'conflict' && result.reason === 'fields' && result.fields[0].proposed).toEqual(present(status));
    }
    expect(current).toEqual({ status: 'assigned' });
  });

  it('treats reserved-looking names as literal JSON keys, not prototype setters', () => {
    const base = JSON.parse('{"__proto__":"old","constructor":"old"}') as SyncRecord;
    const proposed = JSON.parse('{"__proto__":{"polluted":true},"constructor":"new"}') as SyncRecord;
    const result = merge(base, base, proposed);
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') throw new Error('Expected merged record');
    expect(Object.getPrototypeOf(result.record)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result.record, '__proto__')).toBe(true);
    expect(result.record.__proto__).toEqual({ polluted: true });
    expect(result.record.constructor).toBe('new');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(mergeSyncUpdate({}, {}, { toString: present('literal') })).toEqual({
      kind: 'merged', record: { toString: 'literal' }, changedFields: ['toString'],
    });
  });
});

describe('business invariant field groups', () => {
  const base = { status: 'ready', incidentId: null, notes: '' };
  const current = { status: 'ready', incidentId: 'fire-1', notes: '' };
  const policy = { fieldGroups: [['status', 'incidentId']] };

  it('requires review for related field changes instead of producing an invalid merged assignment', () => {
    const result = mergeSyncUpdate(base, current, { status: present('out of service') }, policy);
    expect(result).toEqual({
      kind: 'conflict', reason: 'fields', fields: [{
        field: 'status', reason: 'related_fields', base: present('ready'), current: present('ready'),
        proposed: present('out of service'), relatedFields: ['incidentId'],
      }],
    });
  });

  it('still permits independent fields and identical outcomes in a group', () => {
    expect(mergeSyncUpdate(base, current, { notes: present('checked') }, policy).kind).toBe('merged');
    expect(mergeSyncUpdate(base, current, { incidentId: present('fire-1') }, policy)).toEqual({
      kind: 'merged', record: current, changedFields: [],
    });
  });

  it('collects related context from overlapping groups without duplicate fields', () => {
    const result = mergeSyncUpdate(base, { ...current, notes: 'server' }, { status: present('maintenance') }, {
      fieldGroups: [['status', 'incidentId'], ['status', 'notes', 'incidentId']],
    });
    expect(result.kind === 'conflict' && result.reason === 'fields' && result.fields[0].relatedFields).toEqual(['incidentId', 'notes']);
  });
});

describe('persisted sync data validation', () => {
  it.each([undefined, NaN, Infinity, -Infinity, () => 1, new Date(), new Map(), new Set(), [1, , 3]])(
    'rejects non-JSON field values (%s) instead of corrupting the saved proposal', (value) => {
      expect(() => createSyncPatch({}, { value } as SyncRecord)).toThrow();
    },
  );

  it('rejects invalid current snapshots as well as invalid proposals', () => {
    expect(() => mergeSyncUpdate({}, { value: NaN }, {})).toThrow();
    expect(() => mergeSyncUpdate([] as unknown as SyncRecord, {}, {})).toThrow();
    expect(() => mergeSyncUpdate({}, [] as unknown as SyncRecord, {})).toThrow();
  });

  it('rejects cycles but accepts repeated references to valid JSON values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createSyncPatch({}, cyclic as SyncRecord)).toThrow(/cycles/);
    const shared = { valid: true };
    expect(mergeSyncUpdate({}, {}, createSyncPatch({}, { a: shared, b: shared })).kind).toBe('merged');
  });

  it.each([
    { field: null }, { field: true }, { field: {} }, { field: { present: 'true', value: 1 } },
    { field: { present: true } }, { field: { present: false, value: null } },
    { field: { present: true, value: 1, extra: true } }, { field: { present: true, value: undefined } },
  ])('rejects malformed presence markers (%j)', (patch) => {
    expect(() => mergeSyncUpdate({}, {}, patch as unknown as SyncPatch)).toThrow();
  });
});
