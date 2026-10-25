import { describe, expect, it } from "vitest";
import { liveStageTimes, summarizeStageTimes } from "../src/lib/stageTime";

/** One closed TaskStageTime row (leftAt defaults to a finished segment). */
const seg = (
  name: string,
  seconds: number,
  leftAt: string | null = "2026-10-01T10:00:00.000Z",
) => ({
  status: { name },
  seconds,
  enteredAt: "2026-10-01T09:00:00.000Z",
  leftAt,
});

describe("stage time summary (Development / Testing / Total)", () => {
  it("sums only closed segments in In Progress and In Testing", () => {
    const totals = summarizeStageTimes([
      seg("In Progress", 3600),
      seg("  in   progress ", 600),
      seg("In Testing", 1800),
      // Tracked stages that are NOT part of the two buckets.
      seg("Development Done", 9999),
      seg("Re-open", 500),
      // The open segment is added live on the client, never in the snapshot.
      seg("In Progress", 1200, null),
    ]);
    expect(totals).toEqual({ developmentMs: 4_200_000, testingMs: 1_800_000 });
  });

  it("is defensive about missing data", () => {
    expect(summarizeStageTimes(null)).toEqual({ developmentMs: 0, testingMs: 0 });
    expect(summarizeStageTimes([{ status: null, seconds: null, leftAt: null }])).toEqual({
      developmentMs: 0,
      testingMs: 0,
    });
  });

  it("adds the open segment live only while the task sits in a counted stage", () => {
    const base = {
      devTimeMs: 60_000,
      testTimeMs: 30_000,
      stageEnteredAt: "2026-10-25T10:00:00.000Z",
    };
    const now = new Date("2026-10-25T10:05:00.000Z"); // 5 minutes open

    expect(liveStageTimes({ ...base, status: { name: "In Progress" } }, now)).toEqual({
      developmentMs: 360_000,
      testingMs: 30_000,
      totalMs: 390_000,
    });
    expect(liveStageTimes({ ...base, status: { name: "In Testing" } }, now)).toEqual({
      developmentMs: 60_000,
      testingMs: 330_000,
      totalMs: 390_000,
    });
    expect(liveStageTimes({ ...base, status: { name: "Development Done" } }, now)).toEqual({
      developmentMs: 60_000,
      testingMs: 30_000,
      totalMs: 90_000,
    });
  });

  it("returns the closed totals when no live clock is supplied", () => {
    expect(
      liveStageTimes({
        devTimeMs: 1000,
        testTimeMs: 2000,
        stageEnteredAt: "2026-10-25T10:00:00.000Z",
        status: { name: "In Progress" },
      }),
    ).toEqual({ developmentMs: 1000, testingMs: 2000, totalMs: 3000 });
  });
});
