"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { buildCalendarPdf } from "@/lib/pdf";
import { dayKey, isWeekendDay, monthGrid, weekGrid, occursOn, type CalendarData, type CalendarTask } from "@/lib/calendar";
import { classifyDay, holidayDayKeys, type ExceptionRow, type HolidaySpan } from "@/lib/holidayDates";
import { TIMER_HEX, TIMER_LABEL } from "@/lib/timerFormat";
import CalendarSettings from "@/components/CalendarSettings";
import {
  IconChevronLeft, IconChevronRight, IconDownload, IconFlag, IconSliders, IconSun, IconX,
} from "@/components/icons";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Colour classes for the calendar's day classification (shared with the legend). */
const DAY_CLASS: Record<string, string> = {
  working: "bg-surface",
  weekly_holiday: "bg-hol-weekly",
  holiday: "bg-hol-holiday",
  exception: "bg-hol-exception",
};

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [projectId, setProjectId] = useState("");
  // Phase 5: the calendar opens on MY tasks; "All tasks" lifts the filter.
  const [assigneeId, setAssigneeId] = useState("me");
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyDay, setBusyDay] = useState("");

  const cells = useMemo(() => (view === "month" ? monthGrid(anchor) : weekGrid(anchor)), [view, anchor]);
  const fromKey = dayKey(cells[0]);
  const toKey = dayKey(cells[cells.length - 1]);
  const todayKey = dayKey(new Date());

  useEffect(() => {
    const params = new URLSearchParams({ from: fromKey, to: toKey });
    if (projectId) params.set("projectId", projectId);
    if (assigneeId) params.set("assigneeId", assigneeId);
    api<CalendarData>(`/api/calendar?${params.toString()}`)
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load calendar."));
  }, [fromKey, toKey, projectId, assigneeId, reloadKey]);

  /** Holiday spans as the shared precedence helper wants them (startDate/endDate). */
  const spans = useMemo<HolidaySpan[]>(
    () => (data?.holidays ?? []).map((h) => ({
      id: h.id, startDate: h.date, endDate: h.endDate,
      name: h.name, description: h.description, type: h.type,
    })),
    [data],
  );

  /** Every day of every range → the spans covering it (a range shows on all its days). */
  const holidayByDay = useMemo(() => {
    const map = new Map<string, HolidaySpan[]>();
    for (const span of spans) {
      for (const key of holidayDayKeys(span)) {
        const list = map.get(key) ?? [];
        list.push(span);
        map.set(key, list);
      }
    }
    return map;
  }, [spans]);

  const exceptionByDay = useMemo(() => {
    const map: Record<string, ExceptionRow> = {};
    for (const e of data?.exceptions ?? []) map[e.date] = e;
    return map;
  }, [data]);

  const title = view === "month"
    ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `${cells[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${cells[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  function step(dir: number) {
    setAnchor((a) => view === "month"
      ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
      : new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7));
  }

  /** Admin quick action: mark a holiday/weekend as a working day, or restore it. */
  async function toggleException(day: string, has: boolean) {
    if (busyDay) return;
    setBusyDay(day);
    setError("");
    setMsg("");
    try {
      if (has) {
        await api(`/api/working-days?date=${day}`, { method: "DELETE" });
        setMsg(`${day}: working-day exception removed — the holiday status is back.`);
      } else {
        await api("/api/working-days", { method: "POST", body: JSON.stringify({ date: day }) });
        setMsg(`${day}: office open — this date now counts as a working day.`);
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the working day.");
    } finally {
      setBusyDay("");
    }
  }

  // Phase 5: PDF export of the current view + filters. Holiday ranges are
  // expanded to one entry per day; working-day exceptions print as an extra
  // "Office open" label so the paper copy matches the grid.
  async function downloadPdf() {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    try {
      const projName = data.projects.find((p) => p.id === projectId)?.name;
      const assigneeName =
        assigneeId === "me" ? "Assigned to me" :
        assigneeId === "none" ? "Unassigned" :
        data.members.find((m) => m.userId === assigneeId)?.name;
      const pdfHolidays: { date: string; name: string }[] = [];
      for (const [date, list] of holidayByDay) {
        for (const h of list) pdfHolidays.push({ date, name: h.name || "Holiday" });
      }
      for (const e of data.exceptions) pdfHolidays.push({ date: e.date, name: e.note || "Office open" });
      const doc = await buildCalendarPdf({
        title,
        subtitle: `${projName ?? "All projects"} · ${assigneeName ?? "Anyone"}`,
        generatedAt: new Date(),
        cells: cells.map((d) => ({ dayKey: dayKey(d), inMonth: d.getMonth() === anchor.getMonth() })),
        holidays: pdfHolidays,
        tasks: data.tasks.map((t) => ({ key: t.key, title: t.title, startDate: t.startDate, endDate: t.endDate, statusColor: t.statusColor })),
      });
      doc.save(`calendar-${fromKey}${toKey !== fromKey ? `_${toKey}` : ""}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  const chip = (t: CalendarTask) => (
    <button
      key={t.id}
      onClick={() => router.push(`/p/${t.projectId}/board?task=${t.id}`)}
      title={`${t.key} ${t.title}\n${t.startDate ?? "…"} → ${t.endDate ?? "…"} · ${t.statusName}${t.assigneeName ? ` · ${t.assigneeName}` : ""}\nTimer: ${TIMER_LABEL[t.timerState] ?? t.timerState}`}
      className="block w-full truncate rounded-r border-l-4 bg-surface px-1 text-left text-[10px] leading-4 shadow-sm hover:bg-line"
      style={{ borderLeftColor: TIMER_HEX[t.timerState] ?? t.statusColor }}
    >
      <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: t.statusColor }} />
      <span className="font-mono text-slate-500">{t.key}</span> {t.title}
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <h1 className="tt-title">Calendar</h1>
        <button onClick={() => step(-1)} className="rounded border px-2 py-1 dark:border-slate-700" aria-label={view === "month" ? "Previous month" : "Previous week"} title={view === "month" ? "Previous month" : "Previous week"}><IconChevronLeft className="h-3.5 w-3.5" /></button>
        <button onClick={() => setAnchor(new Date())} className="rounded border px-2 py-1 dark:border-slate-700">Today</button>
        <button onClick={() => step(1)} className="rounded border px-2 py-1 dark:border-slate-700" aria-label={view === "month" ? "Next month" : "Next week"} title={view === "month" ? "Next month" : "Next week"}><IconChevronRight className="h-3.5 w-3.5" /></button>
        <span className="font-semibold">{title}</span>
        <select value={view} onChange={(e) => setView(e.target.value as "month" | "week")} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" aria-label="Calendar view" title="Month or week view">
          <option value="month">Month</option>
          <option value="week">Week</option>
        </select>
        {/* Phase 5: "My tasks" is the default view; "All tasks" lifts the assignee filter. */}
        <div className="flex overflow-hidden rounded border dark:border-slate-700">
          <button
            onClick={() => setAssigneeId("me")}
            className={`px-2 py-1 ${assigneeId === "me" ? "bg-accent font-semibold text-white" : "hover:bg-line"}`}
            title="Only tasks assigned to me"
          >
            My tasks
          </button>
          <button
            onClick={() => { if (assigneeId === "me") setAssigneeId(""); }}
            className={`px-2 py-1 ${assigneeId !== "me" ? "bg-accent font-semibold text-white" : "hover:bg-line"}`}
            title="Tasks of everyone"
          >
            All tasks
          </button>
        </div>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" title="Project filter" aria-label="Project filter">
          <option value="">All projects</option>
          {(data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.key} · {p.name}</option>
          ))}
        </select>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" title="Assignee filter" aria-label="Assignee filter">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {(data?.members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </select>
        {error && (
          <span className="flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">
            {error}
            <button onClick={() => setReloadKey((k) => k + 1)} className="underline underline-offset-2" title="Try loading the calendar again">
              Retry
            </button>
          </span>
        )}
        {msg && <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" role="status">{msg}</span>}
        <button onClick={() => setSettingsOpen(true)} className="tt-btn" title="Holidays and working-day exceptions are managed here">
          <IconSliders className="h-3.5 w-3.5" /> Calendar Settings
        </button>
        <button onClick={downloadPdf} disabled={pdfBusy || !data} className="tt-btn" title="Download this view as PDF">
          <IconDownload className="h-3.5 w-3.5" /> Download PDF{pdfBusy ? "…" : ""}
        </button>
      </div>

      {/* Colour legend — the same classification the cells below use. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-hol-weekly" /> Weekly holiday (Fri/Sat)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-hol-holiday" /> Holiday
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-hol-exception" /> Working-day exception (office open)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border-2 border-accent" /> Today
        </span>
        <span className="ml-auto">Tasks show from start → due; border colour = timer state.</span>
      </div>

      {!data && !error && <p className="text-sm">Loading calendar…</p>}

      {data && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-line bg-line">
          {DAY_NAMES.map((d, i) => (
            <div
              key={d}
              className={`px-1 py-0.5 text-center text-[11px] font-bold uppercase ${
                i === 5 || i === 6 ? "bg-hol-weekly text-muted" : "bg-canvas text-muted"
              }`}
              title={i === 5 || i === 6 ? "Weekly holiday (Friday/Saturday)" : undefined}
            >
              {d}
            </div>
          ))}
          {cells.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === anchor.getMonth();
            const info = classifyDay(key, d, spans, exceptionByDay);
            const holidays = holidayByDay.get(key) ?? [];
            // Tasks span from start date to end date on the calendar.
            const tasks = data.tasks.filter((t) => occursOn(t.startDate, t.endDate, key));
            const canToggle = data.canManageGlobal;
            return (
              <div
                key={key}
                className={`group relative ${view === "week" ? "min-h-96" : "min-h-28"} p-1 ${DAY_CLASS[info.kind]} ${
                  info.kind === "holiday" || info.kind === "exception" ? "ring-1 ring-inset ring-red-200/70 dark:ring-red-900/50" : ""
                } ${inMonth ? "" : "opacity-60"} ${key === todayKey ? "ring-2 ring-inset ring-accent" : ""}`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className={`text-[11px] font-semibold ${info.kind === "working" ? "text-slate-500" : "text-muted"}`}>{d.getDate()}</span>
                  {canToggle && (info.kind === "exception" ? (
                    <button
                      onClick={() => toggleException(key, true)}
                      disabled={busyDay === key}
                      className="rounded p-0.5 text-amber-700 opacity-70 hover:bg-amber-200 hover:opacity-100 disabled:opacity-40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                      title="Remove the working-day exception and restore the holiday status"
                      aria-label={`Restore the holiday status of ${key}`}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  ) : info.kind !== "working" ? (
                    <button
                      onClick={() => toggleException(key, false)}
                      disabled={busyDay === key}
                      className="rounded p-0.5 text-muted opacity-60 hover:bg-amber-100 hover:text-amber-800 hover:opacity-100 disabled:opacity-40 dark:hover:bg-amber-900/50 dark:hover:text-amber-200"
                      title="Mark as a working day (office open)"
                      aria-label={`Mark ${key} as a working day (office open)`}
                    >
                      <IconSun className="h-3 w-3" />
                    </button>
                  ) : null)}
                </div>
                {info.exception && (
                  <div
                    title={info.exception.note ? `Working day: ${info.exception.note}` : "Working-day exception: the office is open"}
                    className="mb-1 flex items-center gap-0.5 truncate rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
                  >
                    <IconSun className="h-3 w-3 shrink-0" /> Office open
                  </div>
                )}
                {holidays.map((h) => (
                  <div
                    key={h.id}
                    title={`Holiday (all projects)${h.description ? `: ${h.description}` : ""}`}
                    className="mb-1 flex items-center gap-0.5 truncate rounded bg-red-100 px-1 text-[10px] text-red-700 dark:bg-red-900/60 dark:text-red-200"
                  >
                    <IconFlag className="h-3 w-3 shrink-0" /> {h.name || "Holiday"}
                  </div>
                ))}
                <div className="flex flex-col gap-0.5">{tasks.map(chip)}</div>
              </div>
            );
          })}
        </div>
      )}

      {settingsOpen && data && (
        <CalendarSettings
          onClose={() => setSettingsOpen(false)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
