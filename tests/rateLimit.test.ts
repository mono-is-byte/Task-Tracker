import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "../src/lib/rateLimit";

/** Unique key per test so the module-level bucket map never leaks between tests. */
const key = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`;

describe("rateLimit — fixed-window abuse guard", () => {
  afterEach(() => vi.useRealTimers());

  it("allows attempts up to the limit, then blocks with a retry hint", () => {
    const k = key("forgot");
    expect(rateLimit(k, 2, 60_000).ok).toBe(true);
    expect(rateLimit(k, 2, 60_000).ok).toBe(true);
    const blocked = rateLimit(k, 2, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const k = key("window");
    expect(rateLimit(k, 1, 1_000).ok).toBe(true);
    expect(rateLimit(k, 1, 1_000).ok).toBe(false);
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(rateLimit(k, 1, 1_000).ok).toBe(true);
  });

  it("counts each key independently", () => {
    const a = key("a");
    const b = key("b");
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });

  it("rejects everything when the limit is zero", () => {
    expect(rateLimit(key("zero"), 0, 60_000).ok).toBe(false);
  });
});
