import { describe, expect, it } from "vitest";
import {
  addDays,
  axisTicks,
  barRect,
  configuredRange,
  keyToMs,
  msToKey,
  padRange,
  projectRange,
  scaleFor,
  scheduleWidth,
  spanDays,
  taskRange,
  tickEvery,
  unionRange,
  type DayRange,
} from "../src/lib/timeline";

const R = (start: string, end: string): DayRange => ({ start, end });

describe("day-key maths", () => {
  it("round-trips day keys through UTC midnights", () => {
    expect(msToKey(keyToMs("2026-10-20"))).toBe("2026-10-20");
    expect(msToKey(keyToMs("2026-01-01"))).toBe("2026-01-01");
  });

  it("counts inclusive spans", () => {
    expect(spanDays(R("2026-10-20", "2026-10-20"))).toBe(1);
    expect(spanDays(R("2026-10-20", "2026-10-22"))).toBe(3);
    expect(spanDays(R("2026-10-31", "2026-11-02"))).toBe(3);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(padRange(R("2026-10-20", "2026-10-22"), 2, 7)).toEqual(R("2026-10-18", "2026-10-29"));
  });

  it("unions ranges null-safely", () => {
    expect(unionRange(null, null)).toBeNull();
    expect(unionRange(R("2026-10-20", "2026-10-22"), null)).toEqual(R("2026-10-20", "2026-10-22"));
    expect(unionRange(R("2026-10-20", "2026-10-22"), R("2026-10-01", "2026-11-05"))).toEqual(R("2026-10-01", "2026-11-05"));
  });
});

describe("overall project range", () => {
  it("derives from the earliest task start and the latest task end when no project dates exist", () => {
    const r = projectRange(null, [R("2026-10-20", "2026-10-22"), R("2026-11-02", "2026-11-10")]);
    expect(r.project).toEqual(R("2026-10-20", "2026-11-10"));
    expect(r.visible).toEqual(R("2026-10-20", "2026-11-10"));
    expect(r.outside).toBe(false);
  });

  it("prefers configured project dates but still covers tasks outside them", () => {
    const r = projectRange({ startDate: "2026-10-01", endDate: "2026-10-31" }, [R("2026-09-25", "2026-09-26"), R("2026-11-04", "2026-11-06")]);
    expect(r.project).toEqual(R("2026-10-01", "2026-10-31"));
    expect(r.visible).toEqual(R("2026-09-25", "2026-11-06"));
    expect(r.outside).toBe(true);
  });

  it("returns nulls when neither project dates nor task dates exist", () => {
    const r = projectRange(null, []);
    expect(r.project).toBeNull();
    expect(r.visible).toBeNull();
    expect(r.derived).toBeNull();
  });

  it("ignores malformed or inverted configured dates", () => {
    expect(configuredRange({ startDate: "nope", endDate: "2026-10-31" })).toBeNull();
    expect(configuredRange({ startDate: "2026-11-01", endDate: "2026-10-31" })).toBeNull();
    expect(configuredRange(null)).toBeNull();
    expect(configuredRange({ startDate: "2026-11-01", endDate: "2026-11-30" })).toEqual(R("2026-11-01", "2026-11-30"));
  });

  it("collects a task range from many tasks", () => {
    expect(taskRange([R("2026-10-20", "2026-10-22"), R("2026-10-01", "2026-10-02")])).toEqual(R("2026-10-01", "2026-10-22"));
    expect(taskRange([])).toBeNull();
  });
});

describe("zoom scale", () => {
  it("uses fixed pixels-per-day for day > week > month", () => {
    expect(scaleFor("day", 90, 0)).toBeGreaterThan(scaleFor("week", 90, 0));
    expect(scaleFor("week", 90, 0)).toBeGreaterThan(scaleFor("month", 90, 0));
  });

  it("makes fit squeeze the whole range into the available width", () => {
    const range = R("2026-10-01", "2026-11-09"); // 40 days
    const px = scaleFor("fit", spanDays(range), 800);
    expect(px).toBeCloseTo(20, 5);
    expect(scheduleWidth(range, px)).toBe(800);
  });

  it("clamps the fit scale so a single day and very long projects still render", () => {
    expect(scaleFor("fit", 1, 10000)).toBeLessThanOrEqual(26);
    expect(scaleFor("fit", 5000, 10)).toBeGreaterThanOrEqual(0.4);
    expect(scheduleWidth(R("2026-10-01", "2026-10-01"), 1)).toBe(160);
  });

  it("picks label density from the scale", () => {
    expect(tickEvery(26)).toBe(1);
    expect(tickEvery(9)).toBe(7);
    expect(tickEvery(3)).toBe(14);
    expect(tickEvery(1)).toBe(30);
  });
});

describe("axis ticks", () => {
  it("labels every day on the day zoom, with the month on the 1st", () => {
    const ticks = axisTicks(R("2026-10-01", "2026-10-05"), scaleFor("day", 5, 0));
    expect(ticks.map((t) => t.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(ticks[0].label).toBe("1 Oct");
    expect(ticks[1].label).toBe("2");
  });

  it("labels weeks with day + month", () => {
    const ticks = axisTicks(R("2026-10-20", "2026-11-20"), scaleFor("week", 32, 0));
    expect(ticks[0]).toEqual({ key: "2026-10-20", label: "20 Oct" });
    expect(ticks[1]).toEqual({ key: "2026-10-27", label: "27 Oct" });
  });

  it("labels one tick per month for long ranges — always inside the range", () => {
    const range = R("2026-01-15", "2026-04-10");
    const ticks = axisTicks(range, 1);
    expect(ticks.map((t) => t.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"]);
    expect(ticks[0].key).toBe("2026-01-15");
    expect(ticks.at(-1)?.key).toBe("2026-04-01");
    expect(ticks.every((t) => t.key >= range.start && t.key <= range.end)).toBe(true);
  });

  it("labels a single-day range with its day number", () => {
    const ticks = axisTicks(R("2026-10-20", "2026-10-20"), scaleFor("day", 1, 0));
    expect(ticks).toEqual([{ key: "2026-10-20", label: "20" }]);
  });
});

describe("bar geometry", () => {
  const range = R("2026-10-20", "2026-10-29"); // 10 days, 10px/day

  it("positions a bar by its start date with an inclusive width", () => {
    expect(barRect("2026-10-20", "2026-10-20", range, 10)).toEqual({ left: 0, width: 10 });
    expect(barRect("2026-10-22", "2026-10-24", range, 10)).toEqual({ left: 20, width: 30 });
    expect(barRect("2026-10-20", "2026-10-29", range, 10)).toEqual({ left: 0, width: 100 });
  });

  it("clamps bars to the visible range", () => {
    expect(barRect("2026-10-01", "2026-10-20", range, 10)).toEqual({ left: 0, width: 10 });
    expect(barRect("2026-10-28", "2026-12-01", range, 10)).toEqual({ left: 80, width: 20 });
  });

  it("keeps at least one day of width even at extreme zoom-out", () => {
    const tiny = barRect("2026-10-25", "2026-10-25", range, 0.4);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
  });

  it("keeps an inverted range visible as a single day", () => {
    expect(barRect("2026-10-25", "2026-10-22", range, 10)).toEqual({ left: 50, width: 10 });
  });
});
