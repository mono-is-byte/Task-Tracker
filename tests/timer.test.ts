import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, getMembership } from "../src/lib/permissions";
import { ctxFromLoad, createTask, serializeTask, updateTask, type TaskContext } from "../src/lib/tasks";
import {
  deriveTimerState, runTimerSweep, startTimer, stopTimer, timerInfo,
} from "../src/lib/timer";

const TEST_URL = "file:./tests/test-timer.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

interface Fixture {
  project: { id: string; key: string; hoursPerDay: number };
  S: Record<string, string>;
  users: Record<string, string>;
}

let fx: Fixture;

async function ctxFor(userKey: string, superadmin = false): Promise<TaskContext> {
  const m = await getMembership(db, fx.users[userKey], superadmin, fx.project.id);
  expect(m).not.toBeNull();
  return ctxFromLoad(fx.project, m!, fx.users[userKey]);
}

beforeAll(async () => {
  await db.$connect();
  const roles: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    // test DBs persist between runs — refresh so DEFAULT_ROLES changes apply.
    const r = await db.role.upsert({
      where: { name: `TM-${name}` },
      update: { permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules) },
      create: {
        name: `TM-${name}`, description: def.description,
        permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules),
      },
    });
    roles[name] = r.id;
  }
  const project = await db.project.create({
    data: { key: `TM${String(Date.now()).slice(-6)}`, name: uniq("timer-proj"), hoursPerDay: 8 },
  });
  // Status layout: To Do (NONE) → In Progress (TRACK) → Review (TRACK)
  // → Re-open (NONE) → Done (FINAL).
  const todo = await db.status.create({ data: { projectId: project.id, name: "To Do", category: "todo", color: "#888", position: 0, timerRole: "NONE" } });
  const prog = await db.status.create({ data: { projectId: project.id, name: "In Progress", category: "inprogress", color: "#00f", position: 1, timerRole: "TRACK" } });
  const review = await db.status.create({ data: { projectId: project.id, name: "Review", category: "inprogress", color: "#a0a", position: 2, timerRole: "TRACK" } });
  const reopen = await db.status.create({ data: { projectId: project.id, name: "Re-open", category: "inprogress", color: "#f00", position: 3, timerRole: "NONE" } });
  const done = await db.status.create({ data: { projectId: project.id, name: "Done", category: "done", color: "#0a0", position: 4, timerRole: "FINAL" } });
  await db.statusTransition.create({ data: { projectId: project.id, fromId: todo.id, toId: prog.id, roleIds: "[]" } });
  await db.priority.create({ data: { projectId: project.id, name: "Medium", level: 3, color: "#888" } });
  await db.issueType.create({ data: { projectId: project.id, name: "Task", color: "#00f" } });

  const users: Record<string, string> = {};
  for (const [key, roleName] of [["pm", "Project Manager"], ["dev", "Developer"], ["dev2", "Developer"]] as [string, string][]) {
    const u = await db.user.create({
      data: {
        email: uniq(key) + "@t.local", username: uniq(key), name: key,
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    users[key] = u.id;
    await db.projectMember.create({
      data: { projectId: project.id, userId: u.id, roles: { create: [{ roleId: roles[roleName] }] } },
    });
  }
  // Superadmin is NOT a project member — the superadmin membership is synthesised.
  const sa = await db.user.create({
    data: {
      email: uniq("sa") + "@t.local", username: uniq("sa"), name: "sa", isSuperAdmin: true,
      passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
    },
  });
  users.sa = sa.id;

  fx = {
    project: { id: project.id, key: project.key, hoursPerDay: 8 },
    S: { todo: todo.id, prog: prog.id, review: review.id, reopen: reopen.id, done: done.id },
    users,
  };
});

const shift = (ms: number) => new Date(Date.now() + ms);

async function newTask(ctx: TaskContext, extra: Record<string, unknown> = {}) {
  return createTask(db, ctx, { title: uniq("task"), ...extra });
}

async function readTask(id: string) {
  return db.task.findUniqueOrThrow({ where: { id }, include: { status: true } });
}

/** Pretend the open stage segment began `ms` ago so tests don't wait real time. */
async function backdateOpenSegment(taskId: string, ms: number) {
  const enteredAt = new Date(Date.now() - ms);
  const open = await db.taskStageTime.findFirstOrThrow({ where: { taskId, leftAt: null } });
  await db.taskStageTime.update({ where: { id: open.id }, data: { enteredAt } });
  await db.task.update({ where: { id: taskId }, data: { stageEnteredAt: enteredAt } });
}

async function notificationsFor(taskId: string) {
  return db.notification.findMany({ where: { link: { contains: taskId } }, orderBy: { createdAt: "asc" } });
}

describe("timer state derivation (pure)", () => {
  const t0 = new Date("2026-10-16T10:00:00Z");

  it("not_started until the first Start; TRACK is running, overdue past dueAt", () => {
    expect(deriveTimerState({ statusRole: "TRACK" }, t0)).toBe("not_started");
    expect(deriveTimerState({ statusRole: "TRACK", startedAt: t0, stageEnteredAt: t0 }, t0)).toBe("running");
    const due = new Date("2026-10-16T12:00:00Z");
    // exactly at dueAt is still RUNNING; one ms later OVERDUE
    expect(deriveTimerState({ statusRole: "TRACK", startedAt: t0, stageEnteredAt: t0, dueAt: due }, due)).toBe("running");
    expect(deriveTimerState({ statusRole: "TRACK", startedAt: t0, stageEnteredAt: t0, dueAt: due }, new Date(due.getTime() + 1))).toBe("overdue");
  });

  it("NONE pauses (stopped), FINAL finishes — a started task is never 'not_started' again", () => {
    expect(deriveTimerState({ statusRole: "NONE", startedAt: t0, stageEnteredAt: null, totalSeconds: 60 }, t0)).toBe("paused");
    expect(deriveTimerState({ statusRole: "FINAL", startedAt: t0, stageEnteredAt: null, totalSeconds: 60 }, t0)).toBe("finished");
    // stopped in a TRACK stage (no open segment) → paused, not not_started
    expect(deriveTimerState({ statusRole: "TRACK", startedAt: t0, stageEnteredAt: null, totalSeconds: 60 }, t0)).toBe("paused");
    // never started → not_started even in a counting stage
    expect(deriveTimerState({ statusRole: "TRACK" }, t0)).toBe("not_started");
  });

  it("worked time = totalSeconds + the live segment; due windows only while running/overdue", () => {
    const running = timerInfo(
      { statusRole: "TRACK", startedAt: t0, stageEnteredAt: t0, totalSeconds: 120, dueAt: new Date(t0.getTime() + 10_000) },
      new Date(t0.getTime() + 4_000),
    );
    expect(running.workedMs).toBe(124_000);
    expect(running.remainingMs).toBe(6_000);
    expect(running.overdueMs).toBeNull();

    const overdue = timerInfo(
      { statusRole: "TRACK", startedAt: t0, stageEnteredAt: t0, totalSeconds: 120, dueAt: new Date(t0.getTime() - 5_000) },
      t0,
    );
    expect(overdue.state).toBe("overdue");
    expect(overdue.overdueMs).toBe(5_000);
    expect(overdue.remainingMs).toBeNull();

    // stopped (paused): only the frozen accumulator counts — no live tick
    const paused = timerInfo({ statusRole: "TRACK", startedAt: t0, stageEnteredAt: null, totalSeconds: 90 }, t0);
    expect(paused.workedMs).toBe(90_000);
    expect(paused.remainingMs).toBeNull();

    expect(timerInfo({ statusRole: "TRACK" }, t0).workedMs).toBeNull();
  });
});

describe("Start/Stop rules", () => {
  it("Start only from a TRACK stage; assignee, PM and Admin may start; other developers may not", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const dev2 = await ctxFor("dev2");
    const sa = await ctxFor("sa", true);

    // Never from To Do (NONE), even for the assignee.
    const inTodo = await newTask(pm, { assigneeId: fx.users.dev });
    await expect(startTimer(db, dev, inTodo.id)).rejects.toThrow(/does not track time/);
    expect((await readTask(inTodo.id)).startedAt).toBeNull();

    // From In Progress (TRACK): not the wrong developer…
    const task = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(startTimer(db, dev2, task.id)).rejects.toThrow(/assignee or a project manager/);
    expect((await readTask(task.id)).startedAt).toBeNull();

    // …but the assignee yes, and the call is idempotent while running.
    const started = await startTimer(db, dev, task.id);
    expect(started.startedAt).not.toBeNull();
    expect(started.stageEnteredAt).not.toBeNull();
    const again = await startTimer(db, dev, task.id);
    expect(again.startedAt?.getTime()).toBe(started.startedAt?.getTime());
    const activities = await db.activity.findMany({ where: { taskId: task.id, action: "timer.started" } });
    expect(activities).toHaveLength(1);

    // PM override on someone else's task.
    const task2 = await newTask(pm, { assigneeId: fx.users.dev2, statusId: fx.S.prog });
    await startTimer(db, pm, task2.id);
    expect((await readTask(task2.id)).startedAt).not.toBeNull();

    // Superadmin override.
    const task3 = await newTask(pm, { assigneeId: fx.users.dev2, statusId: fx.S.prog });
    await startTimer(db, sa, task3.id);
    expect((await readTask(task3.id)).startedAt).not.toBeNull();
  });

  it("never starts from Re-open (NONE) or from Done (FINAL)", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const task = await newTask(pm, { assigneeId: fx.users.dev });
    await updateTask(db, pm, task.id, { statusId: fx.S.prog });
    await updateTask(db, pm, task.id, { statusId: fx.S.reopen });
    await expect(startTimer(db, dev, task.id)).rejects.toThrow(/does not track time/);

    await updateTask(db, pm, task.id, { statusId: fx.S.done });
    await expect(startTimer(db, dev, task.id)).rejects.toThrow(/does not track time/);
    expect((await readTask(task.id)).startedAt).toBeNull();
  });

  it("Start works again after a Stop — the old 'Start only once' bug stays fixed", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const task = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });

    await startTimer(db, dev, task.id);
    await backdateOpenSegment(task.id, 60_000);
    const stopped = await stopTimer(db, dev, task.id);
    expect(stopped.stageEnteredAt).toBeNull();
    expect(stopped.totalSeconds).toBeGreaterThanOrEqual(59);

    // Regression: after a Stop the Start button must work again (same stage).
    const restarted = await startTimer(db, dev, task.id);
    expect(restarted.stageEnteredAt).not.toBeNull();
    // startedAt stays the FIRST Start click — never reset.
    expect(restarted.startedAt?.getTime()).toBe(stopped.startedAt?.getTime());

    // A second Stop folds the second segment in too.
    await backdateOpenSegment(task.id, 30_000);
    await stopTimer(db, dev, task.id);
    const after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull();
    expect(after.totalSeconds).toBeGreaterThanOrEqual(89);
  });

  it("Stop without a running segment is rejected", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const task = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(stopTimer(db, dev, task.id)).rejects.toThrow(/not running/);
  });
});

describe("cumulative timer across stages", () => {
  it("auto-stops on move (never auto-starts), accumulates per-stage segments, freezes Done", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const task = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });

    // Start in In Progress, then pretend 2h have passed there.
    await startTimer(db, dev, task.id);
    const firstStart = (await readTask(task.id)).startedAt!;
    await backdateOpenSegment(task.id, 2 * 60 * 60 * 1000);

    // Move to Review (TRACK): the segment auto-stops; nothing auto-starts.
    await updateTask(db, pm, task.id, { statusId: fx.S.review });
    let after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull(); // never auto-starts in the target
    expect(after.stoppedAt).toBeNull();
    expect(after.totalSeconds).toBeGreaterThanOrEqual(2 * 3600 - 5);
    expect(after.totalSeconds).toBeLessThanOrEqual(2 * 3600 + 5);
    expect(after.startedAt?.getTime()).toBe(firstStart.getTime()); // never reset
    // …and the state shows as paused (started, but no open segment).
    expect(deriveTimerState({ statusRole: "TRACK", startedAt: after.startedAt, stageEnteredAt: after.stageEnteredAt, totalSeconds: after.totalSeconds })).toBe("paused");

    // The user presses Start again in Review — 30m there, then Stop manually.
    await startTimer(db, dev, task.id);
    await backdateOpenSegment(task.id, 30 * 60 * 1000);
    await stopTimer(db, dev, task.id);
    after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull();
    const stoppedTotal = after.totalSeconds;
    expect(stoppedTotal).toBeGreaterThanOrEqual(2.5 * 3600 - 10);
    expect(stoppedTotal).toBeLessThanOrEqual(2.5 * 3600 + 10);

    // Move to Re-open (NONE): nothing to start there.
    await updateTask(db, pm, task.id, { statusId: fx.S.reopen });
    after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull();
    await expect(startTimer(db, dev, task.id)).rejects.toThrow(/does not track time/);

    // Back to In Progress (TRACK): manual Start again, 10m, then Done.
    await updateTask(db, pm, task.id, { statusId: fx.S.prog });
    after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull(); // move never auto-starts
    expect(after.totalSeconds).toBe(stoppedTotal); // nothing lost
    await startTimer(db, dev, task.id);
    await backdateOpenSegment(task.id, 10 * 60 * 1000);
    await updateTask(db, pm, task.id, { statusId: fx.S.done });
    after = await readTask(task.id);
    expect(after.stageEnteredAt).toBeNull(); // auto-stopped on the way into Done
    expect(after.stoppedAt).not.toBeNull();
    expect(after.status.timerRole).toBe("FINAL");
    const frozenTotal = after.totalSeconds;
    const ser = serializeTask(fx.project.key, 8, after as unknown as Record<string, unknown>);
    expect(ser.timerState).toBe("finished");
    // 2h (In Progress) + 30m (Review) + 10m (In Progress again) = 2h 40m.
    const expectedMs = (2 * 3600 + 40 * 60) * 1000;
    expect(ser.timerWorkedMs).toBeGreaterThanOrEqual(expectedMs - 15_000);
    expect(ser.timerWorkedMs).toBeLessThanOrEqual(expectedMs + 15_000);

    // Per-stage history: In Progress → Review → In Progress, all closed;
    // the total is exactly the sum of the segments.
    const stages = await db.taskStageTime.findMany({ where: { taskId: task.id }, orderBy: { enteredAt: "asc" } });
    expect(stages).toHaveLength(3);
    expect(stages.every((s) => s.leftAt !== null)).toBe(true);
    const sum = stages.reduce((acc, s) => acc + s.seconds, 0);
    expect(Math.abs(sum - after.totalSeconds)).toBeLessThanOrEqual(2);

    // Re-opening Done keeps accumulating — never a restart, nothing lost.
    await updateTask(db, pm, task.id, { statusId: fx.S.reopen });
    after = await readTask(task.id);
    expect(after.stoppedAt).toBeNull();
    expect(after.totalSeconds).toBe(frozenTotal);
    await updateTask(db, pm, task.id, { statusId: fx.S.prog });
    after = await readTask(task.id);
    expect(after.startedAt?.getTime()).toBe(firstStart.getTime());
  });
});

describe("runTimerSweep", () => {
  it("notifies the assignee exactly once when a running segment passes dueAt", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");
    const task = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });
    await startTimer(db, dev, task.id);
    await db.task.update({ where: { id: task.id }, data: { dueAt: shift(-60 * 60 * 1000) } });

    await runTimerSweep(db, new Date());
    const timerNotes = (await notificationsFor(task.id)).filter((x) => x.title === "Task is overdue");
    expect(timerNotes).toHaveLength(1);
    expect(timerNotes[0].userId).toBe(fx.users.dev);
    expect((await readTask(task.id)).overdueNotifiedAt).not.toBeNull();

    // Second sweep: exactly once.
    await runTimerSweep(db, new Date());
    const after = (await notificationsFor(task.id)).filter((x) => x.title === "Task is overdue");
    expect(after).toHaveLength(1);
  });

  it("stays quiet for tasks that are not counting (never started, stopped, or Done)", async () => {
    const pm = await ctxFor("pm");
    const dev = await ctxFor("dev");

    // Never started (TRACK stage, no segment).
    const never = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog, dueAt: shift(-60 * 60 * 1000) });
    // Started, then manually stopped.
    const stopped = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });
    await startTimer(db, dev, stopped.id);
    await stopTimer(db, dev, stopped.id);
    await db.task.update({ where: { id: stopped.id }, data: { dueAt: shift(-60 * 60 * 1000) } });
    // Started, then Done (FINAL).
    const finished = await newTask(pm, { assigneeId: fx.users.dev, statusId: fx.S.prog });
    await startTimer(db, dev, finished.id);
    await updateTask(db, pm, finished.id, { statusId: fx.S.done });
    await db.task.update({ where: { id: finished.id }, data: { dueAt: shift(-60 * 60 * 1000) } });

    await runTimerSweep(db, new Date());
    const overdue = (list: { title: string }[]) => list.filter((x) => x.title === "Task is overdue").length;
    expect(overdue(await notificationsFor(never.id))).toBe(0);
    expect(overdue(await notificationsFor(stopped.id))).toBe(0);
    expect(overdue(await notificationsFor(finished.id))).toBe(0);
    expect((await readTask(never.id)).overdueNotifiedAt).toBeNull();
    expect((await readTask(stopped.id)).overdueNotifiedAt).toBeNull();
    expect((await readTask(finished.id)).overdueNotifiedAt).toBeNull();
  });
});
