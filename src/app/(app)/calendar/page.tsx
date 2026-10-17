"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { buildCalendarPdf } from "@/lib/pdf";
import { dayKey, isWeekendDay, monthGrid, weekGrid, occursOn, type CalendarData, type CalendarTask } from "@/lib/calendar";
import { TIMER_HEX, TIMER_LABEL } from "@/lib/timerFormat";
import CalendarSettings from "@/components/CalendarSettings";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [projectId, setProjectId] = useState("");
  // Phase 5: the calendar opens on MY tasks; "All tasks" lifts the filter.
  const [assigneeId, setAssigneeId] = useState("me");
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  const title = view === "month"
    ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `${cells[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${cells[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  function step(dir: number) {
    setAnchor((a) => view === "month"
      ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
      : new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7));
  }

  // Phase 5: PDF export of the current view + filters
  async function downloadPdf() {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    try {
      const projName = data.projects.find((p) => p.id === projectId)?.name;
      const assigneeName =
        assigneeId === "me" ? "Assigned to me" :
        assigneeId === "none" ? "Unassigned" :
        data.members.find((m) => m.userId === assigneeId)?.name;
      const doc = await buildCalendarPdf({
        title,
        subtitle: `${projName ?? "All projects"} · ${assigneeName ?? "Anyone"}`,
        generatedAt: new Date(),
        cells: cells.map((d) => ({ dayKey: dayKey(d), inMonth: d.getMonth() === anchor.getMonth() })),
        holidays: data.holidays,
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
      title={`${t.key} ${t.title}\n${t.startDate ?? "…"} → ${t.endDate ?? "…"}${t.dueAt ? ` (due ${t.dueAt})` : ""} · ${t.statusName}${t.assigneeName ? ` · ${t.assigneeName}` : ""}\nTimer: ${TIMER_LABEL[t.timerState] ?? t.timerState}`}
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
        <button onClick={() => step(-1)} className="rounded border px-2 py-1 dark:border-slate-700" title={view === "month" ? "Previous month" : "Previous week"}>◀</button>
        <button onClick={() => setAnchor(new Date())} className="rounded border px-2 py-1 dark:border-slate-700">Today</button>
        <button onClick={() => step(1)} className="rounded border px-2 py-1 dark:border-slate-700" title={view === "month" ? "Next month" : "Next week"}>▶</button>
        <span className="font-semibold">{title}</span>
        <select value={view} onChange={(e) => setView(e.target.value as "month" | "week")} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
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
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" title="Project filter">
          <option value="">All projects</option>
          {(data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.key} · {p.name}</option>
          ))}
        </select>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" title="Assignee filter">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {(data?.members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </select>
        {error && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">{error}</span>}
        <button onClick={() => setSettingsOpen(true)} className="tt-btn" title="Holiday management lives here now">
          ⚙ Calendar Settings
        </button>
        <button onClick={downloadPdf} disabled={pdfBusy || !data} className="tt-btn" title="Download this view as PDF">
          ⬇ Download PDF{pdfBusy ? "…" : ""}
        </button>
        <span className="ml-auto text-slate-500">Tasks show from start → due; border colour = timer state. Fri/Sat and holidays are tinted.</span>
      </div>

      {!data && !error && <p className="text-sm">Loading calendar…</p>}

      {data && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-line bg-line">
          {DAY_NAMES.map((d, i) => (
            <div
              key={d}
              className={`px-1 py-0.5 text-center text-[11px] font-bold uppercase ${
                i === 5 || i === 6 ? "bg-line/50 text-muted" : "bg-canvas text-muted"
              }`}
              title={i === 5 || i === 6 ? "Weekend (Friday/Saturday)" : undefined}
            >
              {d}
            </div>
          ))}
          {cells.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === anchor.getMonth();
            const holidays = data.holidays.filter((h) => h.date === key);
            const weekend = isWeekendDay(d);
            // Timer due (dueAt) takes precedence over endDate as the calendar due day.
            const tasks = data.tasks.filter((t) => occursOn(t.startDate, t.dueAt ?? t.endDate, key));
            return (
              <div
                key={key}
                className={`${view === "week" ? "min-h-96" : "min-h-28"} p-1 ${
                  holidays.length > 0 ? "bg-red-50 dark:bg-red-950/40" : weekend ? "bg-line/40" : "bg-surface"
                } ${inMonth ? "" : "opacity-50"} ${key === todayKey ? "ring-2 ring-inset ring-accent" : ""}`}
              >
                <div className={`mb-1 text-[11px] font-semibold ${weekend ? "text-muted" : "text-slate-500"}`}>{d.getDate()}</div>
                {holidays.map((h) => (
                  <div
                    key={h.id}
                    title="Holiday (all projects)"
                    className="mb-1 truncate rounded bg-red-100 px-1 text-[10px] text-red-700 dark:bg-red-900/60 dark:text-red-200"
                  >
                    🏖 {h.name || "Holiday"}
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
