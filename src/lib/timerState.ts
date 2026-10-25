/**
 * Pure timer derivation (client-safe, no imports).
 *
 * Round-2 timer workflow — every status carries a `timerRole`:
 *   NONE   no timer UI at all (the initial "To Do", "Re-open")
 *   TRACK  time-tracked stage: a Start button begins a segment, a Stop button
 *          ends it; a running segment is visible and ticks live
 *   FINAL  Done: the total time of all segments, read-only
 *
 * Task timestamps (all derived from the server — the client never sends state):
 *   startedAt      the FIRST Start click. Never cleared, never reset.
 *   stageEnteredAt the open (running) segment; null while stopped/paused
 *   totalSeconds   accumulated seconds of all closed segments
 *   stoppedAt      the moment the task entered a FINAL stage (Done time)
 *
 * Worked time = totalSeconds + the live part of the open segment. Moving the
 * task to another stage auto-stops the running segment (never auto-starts);
 * every tracked stage starts from its own Start button.
 */

export type TimerState = "not_started" | "running" | "overdue" | "paused" | "finished";

export interface TimerFields {
  /** status.timerRole of the task's current status. */
  statusRole?: string | null;
  startedAt?: Date | null;
  stageEnteredAt?: Date | null;
  stoppedAt?: Date | null;
  totalSeconds?: number | null;
  dueAt?: Date | null;
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v as string);
}

/** Does a status with this timer role offer the Start/Stop buttons? */
export function isCountingRole(role: string | null | undefined): boolean {
  return role === "TRACK";
}

export function deriveTimerState(t: TimerFields, now: Date = new Date()): TimerState {
  const role = t.statusRole ?? "TRACK";
  if (role === "FINAL") return "finished";
  const started = asDate(t.startedAt);
  if (!started) return "not_started";
  const segment = asDate(t.stageEnteredAt);
  if (!segment || !isCountingRole(role)) return "paused"; // stopped / NONE stage
  const due = asDate(t.dueAt);
  if (due && now.getTime() > due.getTime()) return "overdue";
  return "running";
}

export interface TimerInfo {
  state: TimerState;
  /** First Start click (never reset). */
  startedAt: Date | null;
  /** Total worked time (closed segments + live open segment); null before the first Start. */
  workedMs: number | null;
  /** Time left until dueAt (running only, when dueAt is set). */
  remainingMs: number | null;
  /** How long past dueAt (overdue only). */
  overdueMs: number | null;
}

export function timerInfo(t: TimerFields, now: Date = new Date()): TimerInfo {
  const state = deriveTimerState(t, now);
  const started = asDate(t.startedAt);
  let workedMs: number | null = null;
  if (started) {
    const base = Math.max(0, t.totalSeconds ?? 0) * 1000;
    const segment = asDate(t.stageEnteredAt);
    const live = segment && isCountingRole(t.statusRole ?? "TRACK") ? Math.max(0, now.getTime() - segment.getTime()) : 0;
    workedMs = base + live;
  }
  let remainingMs: number | null = null;
  let overdueMs: number | null = null;
  const due = asDate(t.dueAt);
  if (due && state === "running") remainingMs = Math.max(0, due.getTime() - now.getTime());
  if (due && state === "overdue") overdueMs = Math.max(0, now.getTime() - due.getTime());
  return { state, startedAt: started, workedMs, remainingMs, overdueMs };
}
