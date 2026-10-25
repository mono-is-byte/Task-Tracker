/**
 * Development / testing time from the stage timer (client-safe, pure).
 *
 * The project's canonical flow names the two tracked stages:
 *   - "In Progress"  → development time
 *   - "In Testing"   → testing time
 * and the table/board "Total time" is exactly their sum.
 *
 * One `TaskStageTime` row is written per Start→Stop segment. The closed rows are
 * summed on the server; the single still-open segment is added live on the
 * client from `stageEnteredAt` (see `liveStageTimes`), so the number counts up
 * without a request. Other stages (Development Done, Re-open, …) are ignored.
 */

/** Canonical status names used by the preset workflow. */
export const DEVELOPMENT_STAGE_NAME = "In Progress";
export const TESTING_STAGE_NAME = "In Testing";

/** One TaskStageTime row (only the parts the summary needs). */
export interface StageTimeSegment {
  status?: { name?: string | null } | null;
  seconds?: number | null;
  enteredAt?: string | Date | null;
  leftAt?: string | Date | null;
}

export interface StageTimeTotals {
  developmentMs: number;
  testingMs: number;
  totalMs: number;
}

/** Case/whitespace-insensitive status-name comparison (" in  progress "). */
function stageKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const DEV_KEY = stageKey(DEVELOPMENT_STAGE_NAME);
const TEST_KEY = stageKey(TESTING_STAGE_NAME);

/**
 * Closed segments only. The open segment is intentionally left to
 * `liveStageTimes` — otherwise the server snapshot and the client tick would
 * both count the same elapsed time.
 */
export function summarizeStageTimes(segments: readonly StageTimeSegment[] | null | undefined): {
  developmentMs: number;
  testingMs: number;
} {
  let developmentMs = 0;
  let testingMs = 0;
  for (const s of segments ?? []) {
    if (!s.leftAt) continue; // running segment — added live on the client
    const key = stageKey(s.status?.name);
    const ms = Math.max(0, Number(s.seconds ?? 0)) * 1000;
    if (key === DEV_KEY) developmentMs += ms;
    else if (key === TEST_KEY) testingMs += ms;
  }
  return { developmentMs: Math.round(developmentMs), testingMs: Math.round(testingMs) };
}

/** Task-row fields the live calculation reads. */
export interface StageTimeRow {
  /** Closed development time (ms) from the API. */
  devTimeMs?: number | null;
  /** Closed testing time (ms) from the API. */
  testTimeMs?: number | null;
  /** Start of the still-open segment (null when not running). */
  stageEnteredAt?: string | null;
  status?: { name?: string | null } | null;
}

/**
 * Display totals: the server's closed seconds plus, when a segment is running
 * in In Progress / In Testing, the elapsed part since it started.
 */
export function liveStageTimes(t: StageTimeRow, now?: Date): StageTimeTotals {
  let developmentMs = Math.max(0, Number(t.devTimeMs ?? 0));
  let testingMs = Math.max(0, Number(t.testTimeMs ?? 0));
  if (now && t.stageEnteredAt) {
    const entered = new Date(t.stageEnteredAt).getTime();
    if (Number.isFinite(entered)) {
      const elapsed = Math.max(0, now.getTime() - entered);
      const key = stageKey(t.status?.name);
      if (key === DEV_KEY) developmentMs += elapsed;
      else if (key === TEST_KEY) testingMs += elapsed;
    }
  }
  return { developmentMs, testingMs, totalMs: developmentMs + testingMs };
}
