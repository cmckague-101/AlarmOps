// Unit tests for the Edge Functions' shared request checks (no Deno needed).
import { describe, expect, it } from 'vitest';
import { allowedReturnUrls, matchesAllowedReturnUrl, timingSafeEqual } from '../../../supabase/functions/_shared/request-security';

describe('timingSafeEqual', () => {
  it('accepts only an exact, non-empty match', () => {
    expect(timingSafeEqual('cron-secret', 'cron-secret')).toBe(true);
    expect(timingSafeEqual('cron-secreT', 'cron-secret')).toBe(false);
    expect(timingSafeEqual('cron-secret-extra', 'cron-secret')).toBe(false);
    expect(timingSafeEqual('cron', 'cron-secret')).toBe(false);
    expect(timingSafeEqual(null, 'cron-secret')).toBe(false);
    expect(timingSafeEqual('cron-secret', undefined)).toBe(false);
    expect(timingSafeEqual('', '')).toBe(false);
  });
});

describe('matchesAllowedReturnUrl', () => {
  const allowed = allowedReturnUrls(' https://app.example.com/ , https://ops.example.com/fleet ,fireops://settings,not a url');
  const matches = (value: string) => matchesAllowedReturnUrl(new URL(value), allowed);

  it('allows configured origins and paths under them', () => {
    expect(matches('https://app.example.com/')).toBe(true);
    expect(matches('https://app.example.com/settings?tab=billing')).toBe(true);
    expect(matches('https://ops.example.com/fleet')).toBe(true);
    expect(matches('https://ops.example.com/fleet/settings')).toBe(true);
    expect(matches('fireops://settings')).toBe(true);
  });

  it('rejects look-alike hosts, sibling paths, other schemes and ports', () => {
    expect(matches('https://app.example.com.evil.net/')).toBe(false);
    expect(matches('https://app.example.com@evil.net/')).toBe(false);
    expect(matches('https://ops.example.com/fleetwide')).toBe(false);
    expect(matches('https://ops.example.com/')).toBe(false);
    expect(matches('http://app.example.com/')).toBe(false);
    expect(matches('https://app.example.com:8443/')).toBe(false);
    expect(matches('fireops://evil')).toBe(false);
  });

  it('allows nothing when no return URLs are configured', () => {
    expect(matchesAllowedReturnUrl(new URL('https://app.example.com/'), allowedReturnUrls(undefined))).toBe(false);
  });
});
