/** Timer display helpers (pure, client-safe). */

export function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Text label per timer state (gray Not started, blue Running, green
 * Finished/Done, red Overdue — always colour + label).
 */
export const TIMER_LABEL: Record<string, string> = {
  not_started: "Not started",
  running: "Running",
  overdue: "Overdue",
  paused: "Stopped",
  finished: "Done",
};

export function timerChipClass(state: string | undefined): string {
  switch (state) {
    case "running": return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
    case "overdue": return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    case "finished": return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
    default: return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

/** Hex colours per timer state (inline styles: calendar chips, borders). */
export const TIMER_HEX: Record<string, string> = {
  not_started: "#94a3b8",
  running: "#3b82f6",
  overdue: "#ef4444",
  paused: "#94a3b8",
  finished: "#22c55e",
};

export interface TimerRow {
  timerState?: string;
  timerWorkedMs?: number | null;
  timerRemainingMs?: number | null;
  timerOverdueMs?: number | null;
  /** Serialized task rows also carry the raw columns — used for live ticking. */
  stageEnteredAt?: string | null;
  totalSeconds?: number | null;
}

/**
 * Worked time for display. The server-computed `timerWorkedMs` is a snapshot;
 * when the timer is running and the row carries the raw columns, recompute it
 * against `now` so the display ticks live on the client.
 */
function liveWorkedMs(t: TimerRow, now?: Date): number | null {
  if (now && (t.timerState === "running" || t.timerState === "overdue") && t.stageEnteredAt && t.totalSeconds != null) {
    const entered = new Date(t.stageEnteredAt).getTime();
    if (Number.isFinite(entered)) return Math.max(0, t.totalSeconds) * 1000 + Math.max(0, now.getTime() - entered);
  }
  return t.timerWorkedMs ?? null;
}

/** Compact one-line summary: "⏱ 1h 05m · 20m left" / "overdue …" / "✓ 2h 00m" / "○ Not started". */
export function timerSummary(t: TimerRow, now?: Date): string {
  const worked = liveWorkedMs(t, now);
  switch (t.timerState) {
    case "running":
      return `⏱ ${fmtDur(worked)}${t.timerRemainingMs != null ? ` · ${fmtDur(t.timerRemainingMs)} left` : ""}`;
    case "overdue":
      return `⏱ ${fmtDur(worked)} · overdue ${fmtDur(t.timerOverdueMs)}`;
    case "finished":
      return worked == null ? "✓ Done" : `✓ ${fmtDur(worked)}`;
    case "paused":
      return `⏸ ${fmtDur(worked)}`;
    default:
      return "○ Not started";
  }
}
