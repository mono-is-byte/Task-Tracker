/**
 * Tiny fixed-window, in-process rate limiter for unauthenticated auth routes.
 *
 * The app is designed to run as a single Node process (same assumption as the
 * in-process event bus in `src/lib/events.ts`), so a Map is enough. On a
 * serverless host the limit applies per instance — still enough to blunt
 * scripted abuse. No schema change, so SQLite and Turso stay compatible.
 *
 * Keys are caller-defined (e.g. `forgot:id:<identifier>`). Expired buckets are
 * swept when a new key arrives; the map is capped so rotating identifiers
 * cannot grow memory without bound.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 10_000;
const buckets = new Map<string, Bucket>();

function makeRoom(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full: drop the oldest keys (Map preserves insertion order).
  while (buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** How long until the caller may retry, in milliseconds (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Count one attempt against `key`. Allows `limit` attempts per `windowMs`;
 * the next attempt inside the same window is rejected.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (limit <= 0) return { ok: false, retryAfterMs: windowMs };
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    makeRoom(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
  }
  existing.count += 1;
  return { ok: true, retryAfterMs: 0 };
}
