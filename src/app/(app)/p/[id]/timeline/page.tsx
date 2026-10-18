"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import { useTasks, type TaskRow } from "@/lib/taskStore";
import { fmtDateTime, fmtDur, timerChipClass, timerSummary } from "@/lib/timerFormat";
import {
  TIMELINE_ZOOMS, ZOOM_LABEL, axisTicks, barRect, localDayKey, offsetPx, padRange,
  projectRange, scheduleWidth, scaleFor, spanDays, storedDayKey, tickEvery,
  type DayRange, type TimelineZoom,
} from "@/lib/timeline";

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
  story: { id: string; title: string } | null;
};

/** The fixed detail columns left of the schedule (Task … Logged). */
const LEFT_COLS = "15rem 8.5rem 5.5rem 5.5rem 3.5rem 3rem 3.5rem";
/** Same columns in px (44rem at the default root size) + the inner gaps. */
const LEFT_PX = 704 + 56;

/** Date-only fields (start/end) are stored as UTC midnight day keys. */
const asDay = (v: string | null) => (v ? v.slice(0, 10) : "—");
/** Instant fields (due/started/done) render in the viewer's local time. */
const asDayLocal = (v: string | null) => (v ? new Date(v).toLocaleDateString("sv") : "—");

function fmtKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * The day range a task occupies on the schedule: its planned start → due date
 * (both inclusive), falling back to the timer instants for tasks that only have
 * those. `null` = the task has no usable dates and is listed without a bar.
 */
function taskDays(t: TTask): DayRange | null {
  const start = storedDayKey(t.startDate) ?? localDayKey(t.startedAt);
  const end = storedDayKey(t.endDate) ?? localDayKey(t.dueAt) ?? localDayKey(t.stoppedAt);
  if (!start && !end) return null;
  return { start: start ?? (end as string), end: end ?? (start as string) };
}

export default function TimelinePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  // Single source of truth (item 7): the timeline renders the shared store and
  // picks up edits from the board/table/drawer instantly.
  const { tasks: allTasks } = useTasks(projectId);
  const rows = allTasks as unknown as TTask[];
  const [group, setGroup] = useState("epic");
  const [zoom, setZoom] = useState<TimelineZoom>("fit");

  const days = useMemo(() => rows.map((task) => ({ task, range: taskDays(task) })), [rows]);
  const dated = useMemo(
    () => days.filter((d): d is { task: TTask; range: DayRange } => d.range !== null),
    [days],
  );

  // Overall project range: configured project dates when the project settings
  // define them, otherwise earliest task start → latest task due date. The
  // VISIBLE range is widened so tasks outside the project dates stay visible.
  const schedule = useMemo(
    () => projectRange(lookups?.project.settings ?? null, dated.map((d) => d.range)),
    [lookups, dated],
  );
  const project = schedule.project;
  const visible = useMemo(() => (schedule.visible ? padRange(schedule.visible, 1, 1) : null), [schedule.visible]);

  // Measure the width the schedule column actually gets, so "Fit entire
  // project" can squeeze the whole range into the visible area.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const hasSchedule = Boolean(visible);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSchedule]);

  const totalDays = visible ? spanDays(visible) : 0;
  // "Fit" targets the width left of the detail columns, but never below ~320px
  // so the bars stay readable on narrow windows (the card then scrolls).
  const fitWidth = Math.max(320, viewWidth - LEFT_PX);
  const pxPerDay = visible ? scaleFor(zoom, totalDays, fitWidth) : 0;
  const schedulePx = visible ? scheduleWidth(visible, pxPerDay) : 0;
  const ticks = visible ? axisTicks(visible, pxPerDay) : [];
  const gridStep = pxPerDay >= 6 ? pxPerDay : Math.max(24, pxPerDay * tickEvery(pxPerDay));
  const gridLines = { backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${gridStep}px)` };

  const today = new Date().toLocaleDateString("sv");
  const todayInRange = Boolean(visible && today >= visible.start && today <= visible.end);
  const todayPx = visible ? offsetPx(today, visible, pxPerDay) : 0;
  const projectBand = project && visible ? barRect(project.start, project.end, visible, pxPerDay) : null;

  const groups = useMemo(() => {
    const map = new Map<string, { task: TTask; range: DayRange | null }[]>();
    for (const d of days) {
      const t = d.task;
      const name =
        group === "epic" ? (t.epic?.name ?? "(no project name)") :
        group === "story" ? (t.story?.title ?? "(no parent story)") :
        group === "assignee" ? (t.assignee?.name ?? "(unassigned)") :
        t.status.name;
      const arr = map.get(name) ?? [];
      arr.push(d);
      map.set(name, arr);
    }
    return [...map.entries()];
  }, [days, group]);

  if (!lookups) return <p className="text-sm">Loading…</p>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <h2 className="tt-title">Timeline</h2>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" aria-label="Group timeline rows">
          <option value="epic">Group: Project Name</option>
          <option value="story">Group: Parent story</option>
          <option value="assignee">Group: Assignee</option>
          <option value="status">Group: Status</option>
        </select>
        <label className="flex items-center gap-1">
          Zoom
          <select value={zoom} onChange={(e) => setZoom(e.target.value as TimelineZoom)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" aria-label="Timeline zoom">
            {TIMELINE_ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setZoom("fit")}
          className="tt-btn"
          title="Scale the timeline so the whole project duration is visible at once"
        >
          Fit entire project
        </button>
        <span className="text-muted">
          {dated.length} of {rows.length} task(s) scheduled
          {rows.length > dated.length ? ` · ${rows.length - dated.length} without dates` : ""}
        </span>
      </div>

      {!visible && (
        <p className="text-sm text-slate-500">
          No project or task dates yet. Set a Start/End date (or a due time) on a task to see it on the schedule.
        </p>
      )}

      {visible && project && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-surface px-2 py-1 text-[11px]">
          <span className="font-semibold uppercase tracking-wide text-muted">Project schedule</span>
          <span className="font-mono">{fmtKey(project.start)} → {fmtKey(project.end)}</span>
          <span className="text-muted">{spanDays(project)} days</span>
          {schedule.outside && (
            <span className="text-amber-600 dark:text-amber-400">
              Some tasks fall outside these dates — the chart spans {fmtKey(visible.start)} → {fmtKey(visible.end)}.
            </span>
          )}
          <span className="ml-auto text-muted">Bar = start → due date (inclusive) · colour = status</span>
        </div>
      )}

      {visible && (
        <div className="tt-card overflow-x-auto p-2" ref={scrollerRef}>
          <div
            className="grid items-center gap-2 border-b border-line pb-1 text-[10px] font-semibold uppercase text-muted"
            style={{ gridTemplateColumns: `${LEFT_COLS} ${schedulePx}px`, width: "max-content", minWidth: "100%" }}
          >
            <span className="sticky left-0 z-10 border-r border-line bg-surface pr-1">Task</span>
            <span>Timer</span>
            <span>Start</span>
            <span>Due</span>
            <span>Time</span>
            <span title="Estimated work hours">Est</span>
            <span title="Logged work hours">Logged</span>
            <div className="relative h-7" style={gridLines} aria-hidden="true">
              {project && projectBand && (
                <span
                  className="absolute top-0 h-1.5 rounded bg-accent/30"
                  style={{ left: projectBand.left, width: projectBand.width }}
                  title={`Project range: ${fmtKey(project.start)} → ${fmtKey(project.end)}`}
                />
              )}
              {ticks.map((tk) => (
                <span key={tk.key} className="absolute top-2.5 whitespace-nowrap" style={{ left: offsetPx(tk.key, visible, pxPerDay) + 2 }}>
                  {tk.label}
                </span>
              ))}
              {todayInRange && (
                <span className="absolute top-1.5 h-5 w-0.5 bg-red-500/70" style={{ left: todayPx }} title={`Today (${today})`} />
              )}
            </div>
          </div>

          {groups.map(([name, items]) => (
            <div key={name} className="mt-1">
              <div className="text-[11px] font-bold text-muted">{name} ({items.length})</div>
              {items.map(({ task: t, range }) => {
                const rect = range ? barRect(range.start, range.end, visible, pxPerDay) : null;
                return (
                  <div
                    key={t.id}
                    className="grid items-center gap-2 py-0.5 text-[11px]"
                    style={{ gridTemplateColumns: `${LEFT_COLS} ${schedulePx}px`, width: "max-content", minWidth: "100%" }}
                  >
                    <span className="sticky left-0 z-10 truncate border-r border-line bg-surface pr-1 font-mono" title={`${t.key}: ${t.title}`}>
                      {t.key} {t.title}
                    </span>
                    <span className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${timerChipClass(t.timerState)}`}>
                      {timerSummary(t)}
                    </span>
                    <span className="truncate text-muted" title={t.startedAt ? `Started ${fmtDateTime(t.startedAt)}` : undefined}>
                      {t.startedAt ? asDayLocal(t.startedAt) : t.startDate ? asDay(t.startDate) : "—"}
                    </span>
                    <span className="truncate text-muted" title={t.stoppedAt ? `Done ${fmtDateTime(t.stoppedAt)}` : undefined}>
                      {t.dueAt ? asDayLocal(t.dueAt) : t.stoppedAt ? asDayLocal(t.stoppedAt) : t.endDate ? asDay(t.endDate) : "—"}
                    </span>
                    <span className="truncate text-muted" title="Total worked time">
                      {t.timerState === "not_started" ? "—" : fmtDur(t.timerWorkedMs)}
                    </span>
                    <span className="truncate text-muted">{t.estHours != null ? `${t.estHours}h` : "—"}</span>
                    <span className="truncate text-muted">{t.loggedHours ? `${t.loggedHours}h` : "—"}</span>
                    <div className="relative h-4 rounded bg-slate-100 dark:bg-slate-800" style={gridLines}>
                      {range && rect ? (
                        <div
                          className="absolute top-0 h-4 rounded"
                          style={{ left: rect.left, width: rect.width, background: t.status.color }}
                          title={`${t.key}: ${range.start} → ${range.end} (${spanDays(range)} day${spanDays(range) === 1 ? "" : "s"})`}
                        />
                      ) : (
                        <span className="absolute left-1 top-0 text-[10px] italic text-muted">no dates set</span>
                      )}
                      {todayInRange && (
                        <span className="absolute top-0 h-4 w-px bg-red-500/60" style={{ left: todayPx }} title={`Today (${today})`} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <p className="mt-2 text-[11px] text-muted">
            The chart always covers the whole project range ({fmtKey(visible.start)} → {fmtKey(visible.end)}, {totalDays} days) — scroll
            sideways for long projects and switch between Day, Week, Month or Fit entire project.
          </p>
        </div>
      )}
    </div>
  );
}
