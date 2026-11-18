// Pure request checks shared by Edge Functions (no Deno APIs, so unit tests run in Node).

/** Compares two secrets without exiting early on the first differing character. */
export function timingSafeEqual(given: string | null | undefined, expected: string | null | undefined) {
  if (!given || !expected) return false;
  const length = Math.max(given.length, expected.length);
  let diff = given.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (given.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return diff === 0;
}

/**
 * Whether `target` falls under one of the configured return URLs. Entries match by
 * exact origin, then by whole path segments, so `https://app.example.com` never
 * matches `https://app.example.com.evil.net` and `/app` never matches `/application`.
 */
export function matchesAllowedReturnUrl(target: URL, allowed: readonly string[]) {
  return allowed.some((entry) => {
    let base: URL;
    try { base = new URL(entry); } catch { return false; }
    if (base.protocol !== target.protocol || base.host !== target.host) return false;
    // Custom schemes (fireops://settings) carry no origin; protocol + host is the whole match.
    const basePath = base.pathname.replace(/\/+$/, '');
    if (!basePath) return true;
    return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  });
}

/** Parses a comma-separated allowlist secret. */
export function allowedReturnUrls(value: string | undefined) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}
