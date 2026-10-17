import type { PrismaClient } from "@prisma/client";
import { dayKey } from "./calendar";
import { deriveTimerState } from "./timerState";

/**
 * Phase 4: Summary Dashboard aggregation for the home page.
 * Scoped to projects the user belongs to (superadmin: all). Hidden projects
 * stay in the TASK scope — members keep their assignments — but are excluded
 * from the project count.
 */

export interface DashboardSummary {
  projectCount: number;
  totals: { all: number; open: number; done: number; overdue: number };
  myOpen: number;
  myOverdue: number;
  /** Tasks whose timer is running right now (incl. lazily auto-started). */
  runningNow: number;
  /** Tasks whose timer is past its due time without a stop. */
  timerOverdue: number;
  byStatus: { id: string; name: string; color: string; count: number }[];
  byPriority: { name: string; color: string; count: number }[];
  perMember: { userId: string; name: string; count: number }[];
}

export async function dashboardSummary(
  client: PrismaClient,
  userId: string,
  isSuperAdmin: boolean,
): Promise<DashboardSummary> {
  const projects = isSuperAdmin
    ? await client.project.findMany({ select: { id: true, key: true, name: true, isHidden: true } })
    : (await client.projectMember.findMany({
        where: { userId },
        include: { project: { select: { id: true, key: true, name: true, isHidden: true } } },
      })).map((m) => m.project);
  const projectIds = projects.map((p) => p.id);

  const tasks = projectIds.length === 0 ? [] : await client.task.findMany({
    where: { projectId: { in: projectIds } },
    include: {
      status: { select: { id: true, name: true, color: true, category: true, timerRole: true } },
      priority: { select: { name: true, color: true, level: true } },
      assignee: { select: { id: true, name: true } },
      project: { select: { key: true, name: true } },
    },
  });

  const today = dayKey(new Date());
  const isDone = (category: string) => category === "done";
  const isOverdue = (endDate: Date | null, category: string) =>
    !isDone(category) && endDate != null && dayKey(endDate) < today;

  const totals = { all: tasks.length, open: 0, done: 0, overdue: 0 };
  // statuses are per-project — merge same-named ones for a cross-project overview
  const byStatusMap = new Map<string, { id: string; name: string; color: string; count: number }>();
  const byPriorityMap = new Map<string, { name: string; color: string; count: number }>();
  const perMemberMap = new Map<string, { userId: string; name: string; count: number }>();
  let myOpen = 0;
  let myOverdue = 0;
  let runningNow = 0;
  let timerOverdue = 0;
  const now = new Date();

  for (const t of tasks) {
    const done = isDone(t.status.category);
    if (done) totals.done += 1;
    else {
      totals.open += 1;
      if (isOverdue(t.endDate, t.status.category)) totals.overdue += 1;
    }
    if (t.assigneeId === userId && !done) {
      myOpen += 1;
      if (isOverdue(t.endDate, t.status.category)) myOverdue += 1;
    }

    // Timer counters use the same derived state as the board/table.
    const timerState = deriveTimerState({ ...t, statusRole: t.status.timerRole }, now);
    if (timerState === "running") runningNow += 1;
    else if (timerState === "overdue") timerOverdue += 1;

    const s = byStatusMap.get(t.status.name) ?? { id: t.status.name, name: t.status.name, color: t.status.color, count: 0 };
    s.count += 1;
    byStatusMap.set(t.status.name, s);

    const p = byPriorityMap.get(t.priority.name) ?? { name: t.priority.name, color: t.priority.color, count: 0 };
    p.count += 1;
    byPriorityMap.set(t.priority.name, p);

    if (!done) {
      const key = t.assigneeId ?? "none";
      const m = perMemberMap.get(key) ?? { userId: key, name: t.assignee?.name ?? "(unassigned)", count: 0 };
      m.count += 1;
      perMemberMap.set(key, m);
    }
  }

  return {
    projectCount: projects.filter((p) => !p.isHidden).length,
    totals,
    myOpen,
    myOverdue,
    runningNow,
    timerOverdue,
    byStatus: [...byStatusMap.values()].sort((a, b) => b.count - a.count),
    byPriority: [...byPriorityMap.values()].sort((a, b) => b.count - a.count),
    perMember: [...perMemberMap.values()].sort((a, b) => b.count - a.count),
  };
}
