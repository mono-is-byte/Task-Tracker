import type { PrismaClient } from "@prisma/client";
import { timerInfo, type TimerFields } from "./timerState";

/**
 * Phase 4: cross-project Calendar data + month/week grid helpers.
 * A task "occurs" on days from its start date through its due date (inclusive);
 * tasks with only one of the two appear on that single day. Holidays are
 * global for everyone (item 1) and show as all-day entries.
 * Scope: a user only ever sees tasks of projects they belong to
 * (superadmin sees everything). Hidden projects stay visible here — their
 * members still have work in them.
 * Phase 5 adds the Friday/Saturday weekend helper.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal user shape needed for scoping (route passes the session user). */
export interface CalendarUser {
  id: string;
  isSuperAdmin: boolean;
}

/** Local day key YYYY-MM-DD (matches <input type="date"> values users type). */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Phase 5: Friday/Saturday weekend (highlighted in the calendar grid). */
export function isWeekendDay(d: Date): boolean {
  const day = d.getDay();
  return day === 5 || day === 6;
}

/** 42 cells (6 weeks, Sunday start) covering the month of `anchor`. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** 7 cells covering the week of `anchor` (Sunday start). */
export function weekGrid(anchor: Date): Date[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Does a task with these date keys occur on the given day key? (start..due span) */
export function occursOn(startDate: string | null, endDate: string | null, day: string): boolean {
  if (!startDate && !endDate) return false;
  if (startDate && endDate) return day >= startDate && day <= endDate;
  return day === (startDate ?? endDate);
}

export interface CalendarTask {
  id: string; key: string; title: string; serial: number;
  projectId: string; projectKey: string; projectName: string;
  statusName: string; statusColor: string; statusCategory: string;
  priorityName: string; priorityColor: string;
  assigneeId: string | null; assigneeName: string | null;
  /** PHASE 4: who performed the latest assignment ("(removed)" when deleted). */
  assignedByName: string | null;
  startDate: string | null; endDate: string | null;
  /** Timer due (day key) — takes precedence over endDate as the calendar due day. */
  dueAt: string | null;
  timerState: string;
}

export interface CalendarHoliday {
  id: string;
  /** First day of the holiday, YYYY-MM-DD. */
  date: string;
  /** Last day (inclusive); equal to `date` for single-day holidays. */
  endDate: string;
  name: string;
  description: string;
  type: string;
}

/** A working-day exception ("Office Open") — see lib/holidayDates precedence. */
export interface CalendarException {
  id: string;
  date: string;
  note: string;
}

export interface CalendarFilters {
  /** Inclusive range; query is usually widened ±1 day for timezone slack. */
  from: Date;
  to: Date;
  projectId?: string;
  /** User id; "none" matches unassigned tasks. */
  assigneeId?: string;
}

export interface CalendarData {
  projects: { id: string; key: string; name: string }[];
  /** True for Admins: they may manage the (global) holidays from Calendar Settings. */
  canManageGlobal: boolean;
  members: { userId: string; name: string }[];
  tasks: CalendarTask[];
  holidays: CalendarHoliday[];
  /** Working-day exceptions inside the fetched window (global, like holidays). */
  exceptions: CalendarException[];
}

async function scopeProjectIds(client: PrismaClient, user: CalendarUser): Promise<string[]> {
  if (user.isSuperAdmin) {
    return (await client.project.findMany({ select: { id: true } })).map((p) => p.id);
  }
  const memberships = await client.projectMember.findMany({ where: { userId: user.id }, select: { projectId: true } });
  return memberships.map((m) => m.projectId);
}

export async function fetchCalendarData(
  client: PrismaClient,
  user: CalendarUser,
  filters: CalendarFilters,
): Promise<CalendarData> {
  const scope = await scopeProjectIds(client, user);
  if (filters.projectId) {
    if (!scope.includes(filters.projectId)) throw new Error("No access to this project.");
    scope.length = 0;
    scope.push(filters.projectId);
  }
  const projects = await client.project.findMany({
    where: { id: { in: scope } },
    select: { id: true, key: true, name: true },
    orderBy: { key: "asc" },
  });

  const overlap = [
    { endDate: { gte: filters.from, lte: filters.to } },
    { startDate: { gte: filters.from, lte: filters.to } },
    { dueAt: { gte: filters.from, lte: filters.to } },
    { startDate: { lt: filters.from }, endDate: { gt: filters.to } },
    { startDate: { lt: filters.from }, dueAt: { gt: filters.to } },
  ];
  const assignee =
    filters.assigneeId === "none" ? { assigneeId: null } :
    filters.assigneeId ? { assigneeId: filters.assigneeId } : {};

  const [tasks, holidays, exceptions, memberRows] = await Promise.all([
    client.task.findMany({
      where: { projectId: { in: scope }, OR: overlap, ...assignee },
      include: {
        status: { select: { name: true, color: true, category: true, timerRole: true } },
        priority: { select: { name: true, color: true } },
        assignee: { select: { id: true, name: true } },
        assignedBy: { select: { name: true, deletedAt: true } },
        project: { select: { key: true, name: true } },
      },
    }),
    // Ranges overlap the window when they start before `to` and end after
    // `from` — a holiday running through the window is included even when its
    // start date is outside it (legacy single-day rows: endDate is NULL).
    client.holiday.findMany({
      where: {
        date: { lte: filters.to },
        OR: [
          { endDate: null, date: { gte: filters.from } },
          { endDate: { gte: filters.from } },
        ],
      },
      orderBy: [{ date: "asc" }, { name: "asc" }],
    }),
    client.workingDayException.findMany({
      where: { date: { gte: filters.from, lte: filters.to } },
      orderBy: { date: "asc" },
    }),
    client.projectMember.findMany({
      where: { projectId: { in: scope } },
      select: { userId: true, user: { select: { name: true } } },
      distinct: ["userId"],
    }),
  ]);

  // The assignee filter must cover everyone who appears in the shown tasks:
  // members of the scoped projects PLUS anyone assigned to a task in them —
  // tasks can be assigned to a registered user who is not a project member.
  const people = new Map<string, string>();
  for (const m of memberRows) people.set(m.userId, m.user.name);
  for (const t of tasks) if (t.assignee) people.set(t.assignee.id, t.assignee.name);

  return {
    canManageGlobal: user.isSuperAdmin,
    projects,
    members: [...people].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name)),
    tasks: tasks.map((t) => ({
      id: t.id, key: `${t.project.key}-${t.serial}`, title: t.title, serial: t.serial,
      projectId: t.projectId, projectKey: t.project.key, projectName: t.project.name,
      statusName: t.status.name, statusColor: t.status.color, statusCategory: t.status.category,
      priorityName: t.priority.name, priorityColor: t.priority.color,
      assigneeId: t.assigneeId, assigneeName: t.assignee?.name ?? null,
      assignedByName: t.assignedBy ? `${t.assignedBy.name}${t.assignedBy.deletedAt ? " (removed)" : ""}` : null,
      startDate: t.startDate ? dayKey(t.startDate) : null,
      endDate: t.endDate ? dayKey(t.endDate) : null,
      dueAt: t.dueAt ? dayKey(t.dueAt) : null,
      timerState: timerInfo({ ...t, statusRole: t.status.timerRole } as TimerFields).state,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      date: dayKey(h.date),
      endDate: h.endDate ? dayKey(h.endDate) : dayKey(h.date),
      name: h.name,
      description: h.description ?? "",
      type: h.type || "public",
    })),
    exceptions: exceptions.map((e) => ({ id: e.id, date: dayKey(e.date), note: e.note ?? "" })),
  };
}

/** Widen a [from,to] day range by `slackDays` for timezone-safety in queries. */
export function widenRange(fromKey: string, toKey: string, slackDays = 1): { from: Date; to: Date } {
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = new Date(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Invalid date.");
  return { from: new Date(from.getTime() - slackDays * DAY_MS), to: new Date(to.getTime() + (slackDays + 1) * DAY_MS - 1) };
}
