const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIVE_TELEMETRY_MS = 15 * MINUTE;
export const STALE_TELEMETRY_MS = DAY;

export type TelemetryFreshness = 'live' | 'recent' | 'stale' | 'unknown';

export function telemetryFreshness(value: string | null | undefined, now = Date.now()): TelemetryFreshness {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return 'unknown';
  const age = now - timestamp;
  if (age < LIVE_TELEMETRY_MS) return 'live';
  if (age < STALE_TELEMETRY_MS) return 'recent';
  return 'stale';
}

export function telemetryAge(value: string | null | undefined, now = Date.now()) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  const age = Math.max(0, now - timestamp);
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
  if (age < HOUR) return plural(Math.floor(age / MINUTE), 'minute');
  if (age < 2 * DAY) return plural(Math.floor(age / HOUR), 'hour');
  if (age < 60 * DAY) return plural(Math.floor(age / DAY), 'day');
  return plural(Math.floor(age / (30 * DAY)), 'month');
}
