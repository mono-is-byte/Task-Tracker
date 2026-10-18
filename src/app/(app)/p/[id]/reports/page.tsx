"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import { useTasks } from "@/lib/taskStore";
import { qaQueueByTester, qaQueueSize } from "@/lib/reports";
import StatBar from "@/components/StatBar";
import { buildReportPdf } from "@/lib/pdf";
import { IconDownload } from "@/components/icons";

interface RTask {
  id: string; key: string; title: string; serial: number;
  storyPoints: number | null; estHours: number | null; loggedHours: number; rdTime: number;
  statusId: string; status: { name: string; color: string; category: string };
  priority: { name: string };
  assignee: { name: string } | null; assigneeId: string | null;
  testedBy: { name: string } | null; testedById: string | null;
  startDate: string | null; endDate: string | null;
}

const SECTION = "rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900";

export default function ReportsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  // Reports read from the SHARED task store, so a status or tester change made
  // on the Board/Table (or by another user) lands here without a reload.
  const { tasks: storeTasks, loading, error, refresh } = useTasks(projectId);
  const tasks = storeTasks as unknown as RTask[];
  const [pdfBusy, setPdfBusy] = useState(false);

  const statusDist = useMemo(() => {
    if (!lookups) return [];
    return lookups.statuses.map((s) => ({
      name: s.name, color: s.color,
      count: tasks.filter((t) => t.statusId === s.id).length,
    }));
  }, [lookups, tasks]);

  const perAssignee = useMemo(() => {
    const map = new Map<string, { pts: number; hrs: number; n: number }>();
    for (const t of tasks) {
      if (t.status?.category === "done") continue;
      const name = t.assignee?.name ?? "(unassigned)";
      const cur = map.get(name) ?? { pts: 0, hrs: 0, n: 0 };
      cur.pts += t.storyPoints ?? 0;
      cur.hrs += t.estHours ?? 0;
      cur.n += 1;
      map.set(name, cur);
    }
    return [...map.entries()];
  }, [tasks]);

  /** Standalone QA queue: tasks in "In Testing" per tester (src/lib/reports.ts). */
  const qaGroups = useMemo(() => qaQueueByTester(tasks), [tasks]);
  const qaSize = useMemo(() => qaQueueSize(qaGroups), [qaGroups]);
  const qaMax = Math.max(1, ...qaGroups.map((g) => g.count));

  const overdue = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => t.endDate && new Date(t.endDate) < now && t.status?.category !== "done");
  }, [tasks]);

  const estVsActual = useMemo(() => {
    const est = tasks.reduce((a, t) => a + (t.estHours ?? 0), 0);
    const logged = tasks.reduce((a, t) => a + (t.loggedHours ?? 0), 0);
    const rd = tasks.reduce((a, t) => a + (t.rdTime ?? 0), 0);
    return { est: Math.round(est * 100) / 100, logged: Math.round(logged * 100) / 100, rd: Math.round(rd * 100) / 100 };
  }, [tasks]);

  // Phase 5: client-side PDF export of exactly what this page shows
  async function downloadPdf() {
    if (!lookups || pdfBusy) return;
    setPdfBusy(true);
    try {
      const done = tasks.filter((t) => t.status?.category === "done").length;
      const doc = await buildReportPdf({
        project: { key: lookups.project.key, name: lookups.project.name },
        generatedAt: new Date(),
        summary: {
          total: tasks.length,
          open: tasks.length - done,
          done,
          overdue: overdue.length,
          points: Math.round(tasks.reduce((a, t) => a + (t.storyPoints ?? 0), 0) * 100) / 100,
          est: estVsActual.est,
          logged: estVsActual.logged,
          rd: estVsActual.rd,
        },
        statusDist: statusDist.map((s) => ({ name: s.name, count: s.count, color: s.color })),
        perAssignee: perAssignee.map(([name, v]) => ({ name, n: v.n, pts: v.pts, hrs: v.hrs })),
        perTester: qaGroups.map((g) => ({ name: g.tester, n: g.count })),
        overdue: overdue.map((t) => ({ key: t.key, title: t.title, endDate: t.endDate })),
      });
      doc.save(`${lookups.project.key}-reports.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  if (!lookups) return <p className="text-sm">Loading…</p>;
  const maxV = Math.max(1, ...perAssignee.map(([, v]) => v.n));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-bold">Reports — {lookups.project.key}</h1>
        <span className="text-xs text-slate-500">{lookups.project.name}</span>
        <button onClick={downloadPdf} disabled={pdfBusy} className="tt-btn ml-auto" title="Download this report as PDF">
          <IconDownload className="h-3.5 w-3.5" /> Download PDF{pdfBusy ? "…" : ""}
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
      <section className={SECTION}>
        <h3 className="mb-2 font-bold">Status distribution</h3>
        {loading && tasks.length === 0 && <p className="text-xs text-slate-500">Loading…</p>}
        {error && <p className="text-xs text-red-600" role="alert">Could not load tasks: {error}</p>}
        {statusDist.map((s) => <StatBar key={s.name} label={s.name} value={s.count} max={Math.max(1, ...statusDist.map((x) => x.count))} color={s.color} />)}
      </section>

      <section className={SECTION}>
        <h3 className="mb-2 font-bold">Open tasks per assignee</h3>
        {perAssignee.map(([name, v]) => <StatBar key={name} label={`${name} (${v.pts}p/${v.hrs}h)`} value={v.n} max={maxV} color="#3b82f6" />)}
      </section>

      <section className={SECTION} aria-labelledby="qa-queue-heading">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <h3 id="qa-queue-heading" className="font-bold">QA Queue — In Testing per Tester</h3>
          <span className="text-xs text-slate-500">
            {qaSize} task{qaSize === 1 ? "" : "s"} · {qaGroups.length} tester{qaGroups.length === 1 ? "" : "s"}
          </span>
        </div>
        {loading && tasks.length === 0 && <p className="text-xs text-slate-500">Loading…</p>}
        {error && (
          <p className="text-xs text-red-600" role="alert">
            Could not load the QA queue: {error}{" "}
            <button onClick={() => refresh()} className="underline">Retry</button>
          </p>
        )}
        {!error && !(loading && tasks.length === 0) && qaGroups.length === 0 && (
          <p className="text-xs text-slate-500">Nothing is in testing right now.</p>
        )}
        <ul className="flex flex-col gap-2">
          {qaGroups.map((g) => (
            <li key={g.tester} className="rounded border border-slate-200 p-2 dark:border-slate-800">
              <StatBar label={g.tester} value={g.count} max={qaMax} color="#a855f7" />
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-1">
                    <span className="font-mono text-slate-500">{t.key}</span>
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className={SECTION}>
        <h3 className="mb-2 font-bold">Estimate vs actual</h3>
        <StatBar label={`Estimated`} value={estVsActual.est} max={Math.max(estVsActual.est, estVsActual.logged, 1)} color="#3b82f6" />
        <StatBar label={`Logged`} value={estVsActual.logged} max={Math.max(estVsActual.est, estVsActual.logged, 1)} color="#22c55e" />
        <StatBar label={`Unestimated R&D`} value={estVsActual.rd} max={Math.max(estVsActual.est, estVsActual.logged, estVsActual.rd, 1)} color="#f59e0b" />
        <h3 className="mb-1 mt-3 font-bold">Overdue ({overdue.length})</h3>
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-xs">
          {overdue.map((t) => (
            <li key={t.id}><span className="font-mono text-slate-500">{t.key}</span> {t.title} <span className="text-red-600">due {t.endDate?.slice(0, 10)}</span></li>
          ))}
        </ul>
      </section>
      </div>
    </div>
  );
}
