/**
 * Next.js instrumentation — starts the task-timer scheduler once per server process.
 * Every minute it sends the once-only overdue notice for counting tasks
 * (see src/lib/timer.ts runTimerSweep). Guarded against double-registration
 * (dev HMR / multiple register calls) and skipped while building.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as unknown as { __ttTimerSweepTimer?: ReturnType<typeof setInterval> };
  if (g.__ttTimerSweepTimer) return;
  const { db } = await import("./lib/db");
  const { runTimerSweep } = await import("./lib/timer");
  const tick = async () => {
    try {
      await runTimerSweep(db);
    } catch (e) {
      console.error("[timer] sweep failed:", e);
    }
  };
  const t = setInterval(tick, 60_000);
  // Never keep the process alive only for the sweep (builds, CLI scripts).
  (t as unknown as { unref?: () => void }).unref?.();
  g.__ttTimerSweepTimer = t;
}
