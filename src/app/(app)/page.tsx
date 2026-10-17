import Link from "next/link";
import { db, taskKey } from "@/lib/db";
import { listProjectsForUser, requireViewer } from "@/lib/server";
import { dashboardSummary } from "@/lib/dashboard";
import StatBar from "@/components/StatBar";

export default async function MyWorkPage() {
  const { user } = await requireViewer("/");
  // Hidden projects stay in My Work task queries (members keep their assignments);
  // only the project LIST hides them (Hide/Unhide UI was removed in Phase 2).
  const projects = await listProjectsForUser(user.id, user.isSuperAdmin);
  const projectIds = projects.map((p) => p.id);

  const whereActive = { projectId: { in: projectIds } };

  const [assigned, qaQueue, overdue, recent, summary] = await Promise.all([
    db.task.findMany({
      where: { ...whereActive, assigneeId: user.id, status: { category: { not: "done" } } },
      include: { status: true, priority: true, project: true },
      orderBy: [{ endDate: "asc" }, { updatedAt: "desc" }],
      take: 20,
    }),
    db.task.findMany({
      where: { ...whereActive, testedById: user.id, status: { name: "In Testing" } },
      include: { status: true, priority: true, project: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    db.task.findMany({
      where: {
        ...whereActive,
        OR: [{ assigneeId: user.id }, { testedById: user.id }],
        endDate: { lt: new Date() },
        status: { category: { not: "done" } },
      },
      include: { status: true, priority: true, project: true },
      orderBy: { endDate: "asc" },
      take: 20,
    }),
    db.activity.findMany({
      where: { task: { projectId: { in: projectIds } } },
      include: { task: { include: { project: true } }, actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    dashboardSummary(db, user.id, user.isSuperAdmin),
  ]);

  function row(t: (typeof assigned)[number]) {
    return (
      <li key={t.id} className="flex items-center gap-2 rounded border bg-surface px-2 py-1 text-sm border-line">
        <span className="font-mono text-xs text-slate-500">{taskKey(t.project.key, t.serial)}</span>
        <Link href={`/p/${t.projectId}/board?task=${t.id}`} className="min-w-0 flex-1 truncate hover:underline">
          {t.title}
        </Link>
        <span className="rounded px-1 text-xs" style={{ background: `${t.status.color}22`, color: t.status.color }}>{t.status.name}</span>
        <span className="text-xs" style={{ color: t.priority.color }}>● {t.priority.name}</span>
      </li>
    );
  }

  function stat(label: string, value: string | number, sub?: string, danger?: boolean) {
    return (
      <div className="rounded border bg-surface p-2 border-line">
        <div className="text-[11px] uppercase text-slate-400">{label}</div>
        <div className={`text-xl font-bold ${danger && Number(value) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Dashboard</h1>
      <p className="mb-4 text-sm text-slate-500">Welcome, {user.name} ({user.isSuperAdmin ? "Super Admin" : "team member"})</p>

      <section className="mb-4 rounded border bg-surface p-3 border-line">
        <h2 className="mb-2 font-semibold">📊 Summary</h2>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {stat("Projects", summary.projectCount)}
          {stat("Tasks", summary.totals.all, `${summary.totals.open} open · ${summary.totals.done} done`)}
          {stat("Overdue", summary.totals.overdue, undefined, true)}
          {stat("My open tasks", summary.myOpen, summary.myOverdue > 0 ? `${summary.myOverdue} overdue` : undefined, true)}
          {stat("⏱ Running now", summary.runningNow)}
          {stat("⏱ Timer overdue", summary.timerOverdue, undefined, true)}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase text-slate-400">Tasks by status</h3>
            <div className="flex flex-col gap-1">
              {summary.byStatus.length === 0 && <span className="text-xs text-slate-400">No tasks yet.</span>}
              {summary.byStatus.map((s) => (
                <StatBar key={s.id} label={s.name} value={s.count} max={Math.max(1, ...summary.byStatus.map((x) => x.count))} color={s.color} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase text-slate-400">Tasks by priority</h3>
            <div className="flex flex-col gap-1">
              {summary.byPriority.length === 0 && <span className="text-xs text-slate-400">No tasks yet.</span>}
              {summary.byPriority.map((p) => (
                <StatBar key={p.name} label={p.name} value={p.count} max={Math.max(1, ...summary.byPriority.map((x) => x.count))} color={p.color} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase text-slate-400">Open tasks per member</h3>
            <div className="flex flex-col gap-1">
              {summary.perMember.length === 0 && <span className="text-xs text-slate-400">No open tasks.</span>}
              {summary.perMember.map((m) => (
                <StatBar key={m.userId} label={m.name} value={m.count} max={Math.max(1, ...summary.perMember.map((x) => x.count))} color="#3b82f6" />
              ))}
            </div>
          </div>
        </div>
      </section>

      {projects.length === 0 && (
        <p className="rounded border bg-surface p-4 text-sm border-line">
          You are not a member of any project yet. Ask an administrator to add you.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">📌 Assigned to me ({assigned.length})</h2>
          <ul className="flex flex-col gap-1">{assigned.map(row)}</ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">🧪 Waiting for my testing ({qaQueue.length})</h2>
          <ul className="flex flex-col gap-1">{qaQueue.map(row)}</ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">⏰ Overdue ({overdue.length})</h2>
          <ul className="flex flex-col gap-1">{overdue.map(row)}</ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">🕘 Recently changed</h2>
          {/* Item 8: capped + scrollable so the feed never stretches the dashboard. */}
          <ul className="scroll-thin flex max-h-44 flex-col gap-1 overflow-y-auto overscroll-contain">
            {recent.map((a) => (
              <li key={a.id} className="rounded border bg-surface px-2 py-1 text-xs border-line">
                <span className="font-mono text-slate-500">{taskKey(a.task.project.key, a.task.serial)}</span>{" "}
                <Link href={`/p/${a.task.projectId}/board?task=${a.taskId}`} className="hover:underline">{a.task.title}</Link>
                <span className="text-slate-500"> — {a.actor?.name ?? "system"} · {a.action}{a.field ? `:${a.field}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {projects.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 font-semibold">Projects</h2>
          <div className="flex flex-wrap gap-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/p/${p.id}/board`} className="rounded border bg-surface px-3 py-2 text-sm hover:shadow border-line">
                <span className="font-mono text-xs text-slate-500">{p.key}</span> {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
