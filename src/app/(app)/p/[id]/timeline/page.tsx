"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import { useTasks, type TaskRow } from "@/lib/taskStore";
import { fmtDateTime, fmtDur, timerChipClass, timerSummary } from "@/lib/timerFormat";

type TTask = TaskRow & {
  key: string; title: string;
  startDate: string | null; endDate: string | null;
  dueAt: string | null;
  startedAt: string | null; stoppedAt: string | null;
  estHours: number | null; loggedHours: number;
  timerState: string; timerWorkedMs: number | null; timerRemainingMs: number | null; timerOverdueMs: number | null;
  status: { name: string; color: string; category: string; timerRole: string };
  assignee: { name: string } | null;
  epic: { id: string; name: string } | null;
};

const DAY = 24 * 60 * 60 * 1000;

/** Date-only fields (start/end) are stored as UTC midnight day keys. */
const asDay = (v: string | null) => (v ? v.slice(0, 10) : "—");
/** Instant fields (due/started/done) render in the viewer's local time. */
const asDayLocal = (v: string | null) => (v ? new Date(v).toLocaleDateString("sv") : "—");

// One grid for the header + every row, so the details columns line up.
const ROW_GRID =
  "grid min-w-[1060px] grid-cols-[15rem_8.5rem_5.5rem_5.5rem_3.5rem_3rem_3.5rem_minmax(10rem,1fr)] items-center gap-2";

export default function TimelinePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  // Single source of truth (item 7): the timeline renders the shared store and
  // picks up edits from the board/table/drawer instantly.
  const { tasks: allTasks } = useTasks(projectId);
  const tasks = useMemo(
    () => (allTasks as TTask[]).filter((t) => t.startDate || t.endDate || t.dueAt || t.startedAt),
    [allTasks],
  );
  const [group, setGroup] = useState("epic");

  const range = useMemo(() => {
    const dates = tasks
      .flatMap((t) => [t.startDate, t.endDate, t.dueAt, t.startedAt, t.stoppedAt].filter(Boolean) as string[])
      .map((d) => new Date(d).getTime());
    if (dates.length === 0) return null;
    const min = Math.min(...dates) - 2 * DAY;
    const max = Math.max(...dates, Date.now()) + 7 * DAY;
    return { min, max, days: Math.ceil((max - min) / DAY) };
  }, [tasks]);

  const groups = useMemo(() => {
    const map = new Map<string, TTask[]>();
    for (const t of tasks) {
      const name =
        group === "epic" ? (t.epic?.name ?? "(no epic)") :
        group === "assignee" ? (t.assignee?.name ?? "(unassigned)") :
        t.status.name;
      const arr = map.get(name) ?? [];
      arr.push(t);
      map.set(name, arr);
    }
    return [...map.entries()];
  }, [tasks, group]);

  if (!lookups) return <p className="text-sm">Loading…</p>;
  const today = Date.now();

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <h2 className="tt-title">Timeline</h2>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="epic">Group: Epic</option>
          <option value="assignee">Group: Assignee</option>
          <option value="status">Group: Status</option>
        </select>
        <span className="text-slate-500">{tasks.length} task(s) on the timeline</span>
      </div>
      {!range && <p className="text-sm text-slate-500">No dated tasks yet. Set Start/End dates or a due time on tasks to see them here.</p>}
      {range && (
        <div className="tt-card overflow-auto p-2">
          {/* Phase 5: readable per-task details (start, due, time, est + logged hours), aligned with every row. */}
          <div className={`${ROW_GRID} mb-1 border-b border-line pb-1 text-[10px] font-semibold uppercase text-muted`}>
            <span>Task</span>
            <span>Timer</span>
            <span>Start</span>
            <span>Due</span>
            <span>Time</span>
            <span title="Estimated work hours">Est</span>
            <span title="Logged work hours">Logged</span>
            <span>Schedule</span>
          </div>
          {groups.map(([name, items]) => (
            <div key={name} className="mb-2">
              <div className="text-xs font-bold">{name} ({items.length})</div>
              {items.map((t) => {
                // Step 4: the bar spans the actual timer start → due time (or the
                // Done time when it already finished), falling back to the dates.
                const s = t.startedAt ? new Date(t.startedAt).getTime()
                  : (t.startDate ? new Date(t.startDate).getTime() : today);
                const e = t.dueAt ? new Date(t.dueAt).getTime()
                  : (t.stoppedAt ? new Date(t.stoppedAt).getTime()
                    : (t.endDate ? new Date(t.endDate).getTime() : Math.max(s, today)));
                const left = Math.max(0, ((s - range.min) / (range.max - range.min)) * 100);
                const width = Math.max(1.5, ((Math.max(e, s + DAY) - Math.max(s, range.min)) / (range.max - range.min)) * 100);
                const duePos = t.dueAt
                  ? Math.max(0, Math.min(100, ((new Date(t.dueAt).getTime() - range.min) / (range.max - range.min)) * 100))
                  : null;
                return (
                  <div
                    key={t.id}
                    className={`${ROW_GRID} py-0.5 text-[11px]`}
                    title={`${t.key}: ${t.title} (${t.startDate ?? "?"} → ${t.endDate ?? "?"}${t.dueAt ? `, due ${fmtDateTime(t.dueAt)}` : ""})`}
                  >
                    <span className="truncate font-mono">{t.key} {t.title}</span>
                    <span className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${timerChipClass(t.timerState)}`}>
                      {timerSummary(t)}
                    </span>
                    <span className="truncate text-slate-500" title={t.startedAt ? `Started ${fmtDateTime(t.startedAt)}` : undefined}>
                      {t.startedAt ? asDayLocal(t.startedAt) : t.startDate ? asDay(t.startDate) : "—"}
                    </span>
                    <span className="truncate text-slate-500" title={t.stoppedAt ? `Done ${fmtDateTime(t.stoppedAt)}` : undefined}>
                      {t.dueAt ? asDayLocal(t.dueAt) : t.stoppedAt ? asDayLocal(t.stoppedAt) : t.endDate ? asDay(t.endDate) : "—"}
                    </span>
                    <span className="truncate text-slate-500" title="Total worked time">
                      {t.timerState === "not_started" ? "—" : fmtDur(t.timerWorkedMs)}
                    </span>
                    <span className="truncate text-slate-500">{t.estHours != null ? `${t.estHours}h` : "—"}</span>
                    <span className="truncate text-slate-500">{t.loggedHours ? `${t.loggedHours}h` : "—"}</span>
                    <div className="relative h-4 rounded bg-slate-100 dark:bg-slate-800">
                      <div className="absolute h-4 rounded" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: t.status.color }} />
                      {duePos != null && (
                        <div className="absolute h-4 w-0.5 bg-slate-900/70 dark:bg-white/70" style={{ left: `${duePos}%` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="mt-1 text-[11px] text-slate-500">Bar = timer start → due time (or the Done time), colour = status, ▍ = due time. Range: {new Date(range.min).toISOString().slice(0, 10)} → {new Date(range.max).toISOString().slice(0, 10)}</p>
        </div>
      )}
    </div>
  );
}
