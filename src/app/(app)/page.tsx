import Link from "next/link";
import { db, taskKey } from "@/lib/db";
import { listProjectsForUser, requireViewer } from "@/lib/server";
import { dashboardLists, dashboardSummary } from "@/lib/dashboard";
import StatBar from "@/components/StatBar";
import DashboardProjectFilter from "@/components/DashboardProjectFilter";
import DashboardExport from "@/components/DashboardExport";
import {
  IconAlarmClock, IconChart, IconCheckCircle, IconClipboardCheck, IconClock, IconHistory,
  IconListChecks, IconTrendUp, IconWarning,
} from "@/components/icons";

/**
 * Dashboard (home) — server-rendered from real task data only. The KPI cards
 * (Total / Completed / In progress / Pending / Overdue) all come from
 * `dashboardSummary`, so they always agree with the Board, Table and Calendar.
 */

const TONE = {
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  red: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
} as const;

function Kpi({
  label, value, hint, icon, tone = "indigo",
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="tt-kpi">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
          <div className="truncate text-[11px] text-muted">{hint}</div>
        </div>
        <span className={`shrink-0 rounded-lg p-2 ${TONE[tone]}`} aria-hidden="true">{icon}</span>
      </div>
    </div>
  );
}

function Card({ title, icon, action, children }: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="tt-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</h2>
        {action && <span className="ml-auto text-xs text-muted">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-dashed border-line px-3 py-2 text-xs text-muted">{children}</p>;
}

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireViewer("/");
  const sp = await searchParams;
  const requestedProject = typeof sp.project === "string" ? sp.project : "";
  // Hidden projects stay in My Work task queries (members keep their assignments);
  // only the project LIST hides them (Hide/Unhide UI was removed in Phase 2).
  const projects = await listProjectsForUser(user.id, user.isSuperAdmin);
  // Change request: ONE combined project-wise filter (?project=<id>) scopes the
  // whole dashboard to a single project. The id must belong to the viewer —
  // anything else falls back to all projects.
  const selected = projects.find((p) => p.id === requestedProject) ?? null;
  const projectIds = selected ? [selected.id] : projects.map((p) => p.id);

  // Change request (dashboard exports): the four lists come from the shared
  // helper so the page, the PDF and the Excel workbook always agree.
  const [lists, summary] = await Promise.all([
    dashboardLists(db, user.id, projectIds),
    dashboardSummary(db, user.id, user.isSuperAdmin, selected?.id),
  ]);
  const { assigned, qaQueue, overdue, recent } = lists;

  /** Plain-string snapshot of a task row for the export buttons. */
  const lite = (t: (typeof assigned)[number]) => ({
    key: taskKey(t.project.key, t.serial),
    title: t.title,
    status: t.status.name,
    priority: t.priority.name,
    due: t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : "—",
  });

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

  const { totals } = summary;
  const pct = (n: number) => (totals.all === 0 ? "0%" : `${Math.round((n / totals.all) * 100)}% of all`);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">
            Welcome back, {user.name} · {selected
              ? selected.name
              : `${summary.projectCount} project${summary.projectCount === 1 ? "" : "s"} in view`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Change request: one project-wise filter + whole-dashboard downloads
              (PDF and Excel — CSV is gone). */}
          <DashboardProjectFilter
            projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
            selected={selected?.id ?? ""}
          />
          <DashboardExport
            scopeId={selected?.id ?? ""}
            scopeKey={selected?.key ?? "all"}
            scopeLabel={selected ? `${selected.key} · ${selected.name}` : "All projects"}
            summary={summary}
            assigned={assigned.map(lite)}
            qaQueue={qaQueue.map(lite)}
            overdue={overdue.map(lite)}
            recent={recent.map((a) => ({
              key: taskKey(a.task.project.key, a.task.serial),
              title: a.task.title,
              action: a.field ? `${a.action}:${a.field}` : a.action,
              actor: a.actor?.name ?? "system",
              when: new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " "),
            }))}
            projects={selected
              ? [{ key: selected.key, name: selected.name }]
              : projects.map((p) => ({ key: p.key, name: p.name }))}
          />
          <span className={`rounded-full border border-line px-2.5 py-1 text-xs font-medium ${user.isSuperAdmin ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300" : "bg-surface text-muted"}`}>
            {user.isSuperAdmin ? "Super Admin" : "Team member"}
          </span>
        </div>
      </div>

      {/* KPI cards — every number is derived from the saved tasks. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total tasks" value={totals.all} hint={pct(totals.all)} icon={<IconListChecks className="h-4 w-4" />} tone="indigo" />
        <Kpi label="Completed" value={totals.done} hint={`${summary.completionPct}% done`} icon={<IconCheckCircle className="h-4 w-4" />} tone="emerald" />
        <Kpi label="In progress" value={totals.inProgress} hint={pct(totals.inProgress)} icon={<IconClock className="h-4 w-4" />} tone="sky" />
        <Kpi label="Pending" value={totals.pending} hint={pct(totals.pending)} icon={<IconHistory className="h-4 w-4" />} tone="slate" />
        <Kpi label="Overdue" value={totals.overdue} hint={totals.overdue > 0 ? "past the due date" : "nothing overdue"} icon={<IconWarning className="h-4 w-4" />} tone="red" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <Card title="Completion & timers" icon={<IconTrendUp className="h-4 w-4 text-emerald-500" />}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">Completion rate</span>
            <span className="tabular-nums text-muted">{summary.completionPct}%</span>
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Completion rate"
            aria-valuenow={summary.completionPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${summary.completionPct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>{totals.done} of {totals.all} done</span>
            <span>· {totals.open} open</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-muted">
              <IconClock className="h-3 w-3" /> {summary.runningNow} timer{summary.runningNow === 1 ? "" : "s"} running
            </span>
            {summary.timerOverdue > 0 && (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <IconAlarmClock className="h-3 w-3" /> {summary.timerOverdue} timer overdue
              </span>
            )}
          </div>
        </Card>

        <Card title="Tasks by status" icon={<IconChart className="h-4 w-4 text-muted" />}>
          <div className="flex flex-col gap-1">
            {summary.byStatus.length === 0 && <Empty>No tasks yet.</Empty>}
            {summary.byStatus.map((s) => (
              <StatBar key={s.id} label={s.name} value={s.count} max={Math.max(1, ...summary.byStatus.map((x) => x.count))} color={s.color} />
            ))}
          </div>
        </Card>

        <Card title="Tasks by priority" icon={<IconChart className="h-4 w-4 text-muted" />}>
          <div className="flex flex-col gap-1">
            {summary.byPriority.length === 0 && <Empty>No tasks yet.</Empty>}
            {summary.byPriority.map((p) => (
              <StatBar key={p.name} label={p.name} value={p.count} max={Math.max(1, ...summary.byPriority.map((x) => x.count))} color={p.color} />
            ))}
          </div>
        </Card>

        <Card title="Open tasks per member" icon={<IconChart className="h-4 w-4 text-muted" />}>
          <div className="flex flex-col gap-1">
            {summary.perMember.length === 0 && <Empty>No open tasks.</Empty>}
            {summary.perMember.map((m) => (
              <StatBar key={m.userId} label={m.name} value={m.count} max={Math.max(1, ...summary.perMember.map((x) => x.count))} color="#3b82f6" />
            ))}
          </div>
        </Card>
      </div>

      {projects.length === 0 && (
        <p className="mt-3 rounded border bg-surface p-4 text-sm border-line">
          You are not a member of any project yet. Ask an administrator to add you.
        </p>
      )}

      {projects.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Card
            title={`Assigned to me (${assigned.length})`}
            icon={<IconListChecks className="h-4 w-4 text-muted" />}
            action={summary.myOpen > 0 ? <>{summary.myOpen} open{summary.myOverdue > 0 ? ` · ${summary.myOverdue} overdue` : ""}</> : undefined}
          >
            {assigned.length === 0 ? <Empty>Nothing assigned to you right now.</Empty> : <ul className="flex flex-col gap-1">{assigned.map(row)}</ul>}
          </Card>

          <Card title={`Waiting for my testing (${qaQueue.length})`} icon={<IconClipboardCheck className="h-4 w-4 text-muted" />}>
            {qaQueue.length === 0 ? <Empty>No task is waiting for your testing.</Empty> : <ul className="flex flex-col gap-1">{qaQueue.map(row)}</ul>}
          </Card>

          <Card
            title={`Overdue (${overdue.length})`}
            icon={<IconAlarmClock className="h-4 w-4 text-red-500" />}
          >
            {overdue.length === 0 ? <Empty>Nothing overdue — nice.</Empty> : <ul className="flex flex-col gap-1">{overdue.map(row)}</ul>}
          </Card>

          <Card title="Recently changed" icon={<IconHistory className="h-4 w-4 text-muted" />}>
            {recent.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              /* Item 8: capped + scrollable so the feed never stretches the dashboard. */
              <ul className="scroll-thin flex max-h-44 flex-col gap-1 overflow-y-auto overscroll-contain">
                {recent.map((a) => (
                  <li key={a.id} className="rounded border bg-surface px-2 py-1 text-xs border-line">
                    <span className="font-mono text-slate-500">{taskKey(a.task.project.key, a.task.serial)}</span>{" "}
                    <Link href={`/p/${a.task.projectId}/board?task=${a.taskId}`} className="hover:underline">{a.task.title}</Link>
                    <span className="text-slate-500"> — {a.actor?.name ?? "system"} · {a.action}{a.field ? `:${a.field}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {projects.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">Projects</h2>
          <div className="flex flex-wrap gap-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/p/${p.id}/board`} className="tt-card px-3 py-2 text-sm transition-shadow hover:shadow">
                <span className="font-mono text-xs text-slate-500">{p.key}</span> {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
