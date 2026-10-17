"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import StatBar from "@/components/StatBar";
import { buildReportPdf } from "@/lib/pdf";

interface RTask {
  id: string; key: string; title: string; serial: number;
  storyPoints: number | null; estHours: number | null; loggedHours: number; rdTime: number;
  statusId: string; status: { name: string; color: string; category: string };
  priority: { name: string };
  assignee: { name: string } | null; assigneeId: string | null;
  testedBy: { name: string } | null; testedById: string | null;
  startDate: string | null; endDate: string | null;
}

export default function ReportsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  const [tasks, setTasks] = useState<RTask[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    api<{ tasks: RTask[] }>(`/api/projects/${projectId}/tasks?take=1000`).then((d) => setTasks(d.tasks)).catch(() => {});
  }, [projectId]);

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
      if (t.status.category === "done") continue;
      const name = t.assignee?.name ?? "(unassigned)";
      const cur = map.get(name) ?? { pts: 0, hrs: 0, n: 0 };
      cur.pts += t.storyPoints ?? 0;
      cur.hrs += t.estHours ?? 0;
      cur.n += 1;
      map.set(name, cur);
    }
    return [...map.entries()];
  }, [tasks]);

  const perTester = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.status.name !== "In Testing") continue;
      const name = t.testedBy?.name ?? "(no tester)";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()];
  }, [tasks]);

  const overdue = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => t.endDate && new Date(t.endDate) < now && t.status.category !== "done");
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
      const done = tasks.filter((t) => t.status.category === "done").length;
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
        perTester: perTester.map(([name, n]) => ({ name, n })),
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
          ⬇ Download PDF{pdfBusy ? "…" : ""}
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 font-bold">Status distribution</h3>
        {statusDist.map((s) => <StatBar key={s.name} label={s.name} value={s.count} max={Math.max(1, ...statusDist.map((x) => x.count))} color={s.color} />)}
      </section>

      <section className="rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 font-bold">Open tasks per assignee</h3>
        {perAssignee.map(([name, v]) => <StatBar key={name} label={`${name} (${v.pts}p/${v.hrs}h)`} value={v.n} max={maxV} color="#3b82f6" />)}
        <h3 className="mb-1 mt-3 font-bold">QA queue — In Testing per tester</h3>
        {perTester.length === 0 && <p className="text-xs text-slate-500">Nothing in testing.</p>}
        {perTester.map(([name, n]) => <StatBar key={name} label={name} value={n} max={Math.max(1, ...perTester.map(([, x]) => x))} color="#a855f7" />)}
      </section>

      <section className="rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
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
