import { describe, expect, it } from 'vitest';

import { telemetryAge, telemetryFreshness } from './telemetry-freshness';

const now = Date.parse('2026-10-30T21:00:00Z');

describe('telemetryFreshness', () => {
  it('classifies by age', () => {
    expect(telemetryFreshness('2026-10-30T20:50:00Z', now)).toBe('live');
    expect(telemetryFreshness('2026-10-30T10:00:00Z', now)).toBe('recent');
    expect(telemetryFreshness('2026-10-29T20:59:00Z', now)).toBe('stale');
    expect(telemetryFreshness('2026-08-16T20:05:54Z', now)).toBe('stale');
  });

  it('reports unknown for missing or invalid values', () => {
    expect(telemetryFreshness(undefined, now)).toBe('unknown');
    expect(telemetryFreshness('not a date', now)).toBe('unknown');
  });
});

describe('telemetryAge', () => {
  it('describes age in the largest sensible unit', () => {
    expect(telemetryAge('2026-10-30T20:59:00Z', now)).toBe('1 minute');
    expect(telemetryAge('2026-10-29T15:00:00Z', now)).toBe('30 hours');
    expect(telemetryAge('2026-10-26T18:06:35Z', now)).toBe('4 days');
    expect(telemetryAge('2026-08-16T20:05:54Z', now)).toBe('2 months');
    expect(telemetryAge(null, now)).toBeNull();
  });
});
