import { describe, expect, it } from "vitest";
import {
  capacityReport,
  computeCapacity,
  estDays,
  isFibonacci,
  matchesSearch,
  normalizeSearch,
  workingDaysBetween,
} from "../src/lib/domain";

describe("estDays (always calculated, never typed)", () => {
  it("divides hours by hours-per-day", () => {
    expect(estDays(8, 8)).toBe(1);
    expect(estDays(3.5, 8)).toBe(0.44);
    expect(estDays(4.5, 8)).toBe(0.56);
  });
  it("respects project/user hours-per-day setting", () => {
    expect(estDays(8, 4)).toBe(2);
    expect(estDays(7, 7)).toBe(1);
  });
  it("returns null when hours missing or rate invalid", () => {
    expect(estDays(null, 8)).toBeNull();
    expect(estDays(undefined, 8)).toBeNull();
    expect(estDays(5, 0)).toBeNull();
  });
});

describe("story points scale", () => {
  it("accepts Fibonacci only", () => {
    for (const n of [1, 2, 3, 5, 8, 13, 21]) expect(isFibonacci(n)).toBe(true);
    for (const n of [0, 4, 6, 7, 10, 20]) expect(isFibonacci(n)).toBe(false);
  });
});

describe("Bangla search", () => {
  it("normalizes unicode (NFC) before matching", () => {
    expect(normalizeSearch("ম্যাপে")).toBe("ম্যাপে".normalize("NFC").toLowerCase());
  });
  it("matches Bangla substrings and ANDs tokens", () => {
    expect(matchesSearch("ম্যাপে বিভাগগুলো প্রদর্শন", "বিভাগ")).toBe(true);
    expect(matchesSearch("ম্যাপে বিভাগগুলো প্রদর্শন", "ম্যাপে প্রদর্শন")).toBe(true);
    expect(matchesSearch("ম্যাপে বিভাগগুলো প্রদর্শন", "চিঠি")).toBe(false);
    expect(
      matchesSearch("চিঠি ইস্যু হওয়ার সাথে সাথে প্রাপককে জানাতে SMS", "ইস্যু SMS"),
    ).toBe(true);
  });
  it("is case-insensitive for latin text", () => {
    expect(matchesSearch("Cumilla EPZ Map", "cumilla epz")).toBe(true);
  });
});

describe("capacity", () => {
  it("counts working days excluding weekends and holidays", () => {
    // Mon 2026-10-05 .. Sun 2026-10-11, workingDays Mon-Fri
    expect(workingDaysBetween(new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5])).toBe(5);
    expect(
      workingDaysBetween(new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5], ["2026-10-06"]),
    ).toBe(4);
    expect(workingDaysBetween(new Date("2026-10-11"), new Date("2026-10-05"), [1, 2, 3, 4, 5])).toBe(0);
  });

  it("working-day exceptions count as working days, even on weekends and holidays", () => {
    // Fri 2026-10-09 + Sat 2026-10-10 are outside the Mon-Fri working set…
    expect(workingDaysBetween(new Date("2026-10-09"), new Date("2026-10-10"), [0, 1, 2, 3, 4])).toBe(0);
    // …until an explicit exception opens the office on the Friday.
    expect(
      workingDaysBetween(new Date("2026-10-09"), new Date("2026-10-10"), [0, 1, 2, 3, 4], [], ["2026-10-09"]),
    ).toBe(1);
    // An exception also wins over a configured holiday on a normal working day.
    expect(
      workingDaysBetween(new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5], ["2026-10-06"], ["2026-10-06"]),
    ).toBe(5);
  });

  it("computes team capacity from per-member rates", () => {
    // 2 members x 8h x 5 days
    expect(computeCapacity([8, 8], new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5])).toBe(80);
    // mixed rates (per-user override) with a holiday
    expect(computeCapacity([8, 6], new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5], ["2026-10-06"])).toBe(56);
    // the same holiday is worked (office open) → full capacity again
    expect(
      computeCapacity([8, 6], new Date("2026-10-05"), new Date("2026-10-11"), [1, 2, 3, 4, 5], ["2026-10-06"], ["2026-10-06"]),
    ).toBe(70);
  });
  it("warns when planned exceeds capacity", () => {
    const r = capacityReport([{ estHours: 50, storyPoints: 8 }, { estHours: 40 }], 80);
    expect(r.plannedHours).toBe(90);
    expect(r.plannedPoints).toBe(8);
    expect(r.over).toBe(true);
    expect(r.overflow).toBe(10);
    expect(capacityReport([{ estHours: 10 }], 80).over).toBe(false);
  });
});
