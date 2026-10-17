import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { dayKey, isWeekendDay, monthGrid, weekGrid, occursOn, widenRange, fetchCalendarData } from "../src/lib/calendar";
import { dashboardSummary } from "../src/lib/dashboard";

const TEST_URL = "file:./tests/test-calendar.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
// today at local midnight; day(offset) = a local-midnight date offset days from today
const BASE = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const day = (offset: number) => new Date(BASE.getFullYear(), BASE.getMonth(), BASE.getDate() + offset);

let fx: {
  A: string; B: string; C: string;
  S: Record<string, Record<string, string>>; // per project: todo/done
  P: Record<string, string>; // per project: High
  users: { member: string; other: string };
};

beforeAll(async () => {
  await db.$connect();

  const mk = async (key: string, hidden = false) =>
    (await db.project.create({ data: { key: uniq(key), name: `proj-${key}`, hoursPerDay: 8, isHidden: hidden } })).id;
  const A = await mk("CA"); // member's main project
  const B = await mk("CB", true); // hidden project the member belongs to
  const C = await mk("CC"); // outsider project

  const S: Record<string, Record<string, string>> = {};
  for (const pid of [A, B, C]) {
    const todo = await db.status.create({ data: { projectId: pid, name: "To Do", category: "todo", color: "#888", position: 0 } });
    const done = await db.status.create({ data: { projectId: pid, name: "Done", category: "done", color: "#0a0", position: 1 } });
    S[pid] = { todo: todo.id, done: done.id };
  }
  const P: Record<string, string> = {};
  for (const pid of [A, B, C]) {
    P[pid] = (await db.priority.create({ data: { projectId: pid, name: "High", level: 4, color: "#f80" } })).id;
  }

  const mkUser = async () =>
    (await db.user.create({
      data: { email: uniq("u") + "@t.local", username: uniq("u"), name: "u", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    })).id;
  const member = await mkUser();
  const other = await mkUser();
  await db.projectMember.create({ data: { projectId: A, userId: member } });
  await db.projectMember.create({ data: { projectId: B, userId: member } });
  await db.projectMember.create({ data: { projectId: C, userId: other } });

  let serial = 1;
  const mkTask = async (pid: string, data: Record<string, unknown>) =>
    (await db.task.create({
      data: { projectId: pid, serial: serial++, title: uniq("t"), statusId: S[pid].todo, priorityId: P[pid], ...data },
    })).id;

  // dashboard fixture (see expectations below)
  await mkTask(A, { endDate: day(-2), assigneeId: member });   // a1 overdue + mine
  await mkTask(A, { endDate: day(5), assigneeId: other });     // a2
  await mkTask(A, { statusId: S[A].done, endDate: day(1), assigneeId: member }); // a3 done
  await mkTask(A, { endDate: day(6) });                        // a4 unassigned, due in range
  await mkTask(B, { endDate: day(3), assigneeId: member });    // a5 hidden project, mine
  await mkTask(C, { endDate: day(2), assigneeId: other });     // c1 outsider

  // holidays: global for everyone (item 1) — no per-project scope any more
  await db.holiday.create({ data: { date: day(0), name: "Global Day" } });
  await db.holiday.create({ data: { date: day(2), name: "Team Day" } });
  await db.holiday.create({ data: { date: day(3), name: "Other Day" } });

  fx = { A, B, C, S, P, users: { member, other } };
});

describe("calendar grid helpers", () => {
  it("monthGrid is42 cells starting on a Sunday of the anchor month", () => {
    const anchor = new Date(2026, 9, 15); // Oct 15 2026 (Thursday)
    const cells = monthGrid(anchor);
    expect(cells).toHaveLength(42);
    expect(cells[0].getDay()).toBe(0);
    expect(dayKey(cells[0])).toBe("2026-09-27");
    expect(cells.some((d) => dayKey(d) === "2026-10-01")).toBe(true);
  });

  it("weekGrid is7 cells containing the anchor day", () => {
    const anchor = new Date(2026, 9, 15);
    const cells = weekGrid(anchor);
    expect(cells).toHaveLength(7);
    expect(dayKey(cells[0])).toBe("2026-10-11");
    expect(cells.some((d) => dayKey(d) === "2026-10-15")).toBe(true);
  });

  it("occursOn spans start..due and handles single-date tasks", () => {
    expect(occursOn("2026-10-01", "2026-10-05", "2026-10-03")).toBe(true);
    expect(occursOn("2026-10-01", "2026-10-05", "2026-10-06")).toBe(false);
    expect(occursOn(null, "2026-10-05", "2026-10-05")).toBe(true);
    expect(occursOn("2026-10-05", null, "2026-10-05")).toBe(true);
    expect(occursOn("2026-10-05", null, "2026-10-04")).toBe(false);
    expect(occursOn(null, null, "2026-10-05")).toBe(false);
  });

  it("widenRange expands a day range for timezone slack", () => {
    const { from, to } = widenRange("2026-10-01", "2026-10-01");
    expect(from.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-02T23:59:59.999Z");
  });

  it("flags Friday and Saturday as the weekend (Phase 5 highlight)", () => {
    expect(isWeekendDay(new Date(2026, 9, 15))).toBe(false); // Thursday
    expect(isWeekendDay(new Date(2026, 9, 16))).toBe(true);  // Friday
    expect(isWeekendDay(new Date(2026, 9, 17))).toBe(true);  // Saturday
    expect(isWeekendDay(new Date(2026, 9, 18))).toBe(false); // Sunday
  });
});

describe("fetchCalendarData scoping", () => {
  it("member sees own + global items, never the outsider project; holidays are global", async () => {
    const data = await fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: false }, {
      from: day(-7), to: day(7),
    });
    const pkeys = data.tasks.map((t) => t.projectKey);
    expect(new Set(pkeys).size).toBe(2); // A + hidden B only
    const holidayNames = data.holidays.map((h) => h.name);
    // item 1: holidays are global for everyone (no project scope any more)
    expect(holidayNames).toContain("Global Day");
    expect(holidayNames).toContain("Team Day");
    expect(holidayNames).toContain("Other Day");
    expect(data.members.map((m) => m.userId)).toContain(fx.users.member);
    expect(data.members.map((m) => m.userId)).not.toContain(fx.users.other);
  });

  it("superadmin sees everything", async () => {
    const data = await fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: true }, {
      from: day(-7), to: day(7),
    });
    // test DBs persist between runs — assert this fixture's projects are all visible
    const ids = data.projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([fx.A, fx.B, fx.C]));
    expect(data.holidays.map((h) => h.name)).toContain("Other Day");
  });

  it("rejects a projectId outside the user's scope", async () => {
    await expect(fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: false }, {
      from: day(-1), to: day(1), projectId: fx.C,
    })).rejects.toThrow(/No access/);
  });

  it("assignee filter narrows to a user or unassigned", async () => {
    const mine = await fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: false }, {
      from: day(-7), to: day(7), assigneeId: fx.users.member,
    });
    expect(mine.tasks.length).toBeGreaterThan(0);
    expect(mine.tasks.every((t) => t.assigneeId === fx.users.member)).toBe(true);

    const none = await fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: false }, {
      from: day(-7), to: day(7), assigneeId: "none",
    });
    expect(none.tasks.every((t) => t.assigneeId === null)).toBe(true);
    expect(none.tasks.length).toBe(1); // a4
  });

  it("excludes tasks and holidays outside the range", async () => {
    const data = await fetchCalendarData(db, { id: fx.users.member, isSuperAdmin: false }, {
      from: day(10), to: day(12),
    });
    expect(data.tasks).toHaveLength(0);
    expect(data.holidays).toHaveLength(0);
  });
});

describe("dashboardSummary", () => {
  it("aggregates totals, overdue, per-status/priority/member", async () => {
    const s = await dashboardSummary(db, fx.users.member, false);
    // projectCount excludes the hidden project; its tasks still count
    expect(s.projectCount).toBe(1);
    //5 tasks total: a1-a4 in A + a5 in hidden B; a3 done; a1 overdue (a3 is done → not overdue)
    expect(s.totals).toEqual({ all: 5, open: 4, done: 1, overdue: 1 });
    expect(s.myOpen).toBe(2); // a1 + a5
    expect(s.myOverdue).toBe(1); // a1
    expect(s.byStatus.reduce((a, x) => a + x.count, 0)).toBe(5);
    expect(s.byPriority).toEqual([{ name: "High", color: "#f80", count: 5 }]);
    // open tasks per member: member a1+a5, other a2, unassigned a4
    expect(s.perMember.find((m) => m.userId === fx.users.member)?.count).toBe(2);
    expect(s.perMember.find((m) => m.userId === fx.users.other)?.count).toBe(1);
    expect(s.perMember.find((m) => m.userId === "none")?.count).toBe(1);
  });

  it("superadmin sees all projects", async () => {
    const s = await dashboardSummary(db, fx.users.member, true);
    // accumulation-safe: this run contributes3 visible +1 hidden project and6 tasks
    expect(s.projectCount).toBeGreaterThanOrEqual(2);
    expect(s.totals.all).toBeGreaterThanOrEqual(6);
  });
});
