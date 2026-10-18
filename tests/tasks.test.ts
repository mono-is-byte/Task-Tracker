import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, getMembership, userHasGlobalAction, type Membership } from "../src/lib/permissions";
import { ctxFromLoad, createTask, defaultCreationStatusId, listTasks, updateTask, type TaskContext } from "../src/lib/tasks";
import { listAssignableUsers } from "../src/lib/userDirectory";
import { replaceStatusDesignations, suggestedForStatus } from "../src/lib/workflow";
import { resolveDesignationRole } from "../src/lib/users";
import { estDays } from "../src/lib/domain";

const TEST_URL = "file:./tests/test-tasks.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

interface Fixture {
  project: { id: string; key: string; hoursPerDay: number; pointScale: number[] };
  S: Record<string, string>;
  P: Record<string, string>;
  users: Record<string, string>;
  roles: Record<string, string>;
}

let fx: Fixture;

async function membership(userKey: string): Promise<{ ctx: TaskContext; m: Membership }> {
  const m = (await getMembership(db, fx.users[userKey], false, fx.project.id))!;
  expect(m).not.toBeNull();
  return {
    m,
    ctx: ctxFromLoad(fx.project, m, fx.users[userKey]),
  };
}

beforeAll(async () => {
  await db.$connect();
  const roles: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const existing = await db.role.findUnique({ where: { name: `T-${name}` } });
    const r = existing ?? (await db.role.create({
      data: {
        name: `T-${name}`, description: def.description,
        permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules),
      },
    }));
    roles[name] = r.id;
  }
  const project = await db.project.create({
    data: { key: `T${String(Date.now()).slice(-6)}`, name: uniq("proj"), hoursPerDay: 8 },
  });
  const todo = await db.status.create({ data: { projectId: project.id, name: "To Do", category: "todo", color: "#888", position: 0 } });
  const prog = await db.status.create({ data: { projectId: project.id, name: "In Progress", category: "inprogress", color: "#00f", position: 1 } });
  const done = await db.status.create({ data: { projectId: project.id, name: "Done", category: "done", color: "#0a0", position: 2 } });
  await db.statusTransition.create({ data: { projectId: project.id, fromId: todo.id, toId: prog.id, roleIds: "[]" } });
  await db.statusTransition.create({
    data: {
      projectId: project.id, fromId: prog.id, toId: done.id,
      roleIds: JSON.stringify([roles["Project Manager"], roles["QA / Tester"]]),
    },
  });
  const med = await db.priority.create({ data: { projectId: project.id, name: "Medium", level: 3, color: "#888" } });
  const high = await db.priority.create({ data: { projectId: project.id, name: "High", level: 4, color: "#f80" } });
  await db.issueType.create({ data: { projectId: project.id, name: "Task", color: "#00f" } });
  // automation: Done sets End Date = today
  await db.automationRule.create({
    data: {
      projectId: project.id, name: "Done sets end", trigger: "status_changed",
      condition: JSON.stringify({ toCategory: "done" }), action: JSON.stringify({ set: { endDate: "today" } }),
    },
  });

  const users: Record<string, string> = {};
  const plan: [string, string][] = [
    ["pm", "Project Manager"], ["dev", "Developer"], ["dev2", "Developer"],
    ["qa", "QA / Tester"], ["viewer", "Viewer / Stakeholder"],
  ];
  for (const [key, roleName] of plan) {
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
  fx = {
    project: { id: project.id, key: project.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] },
    S: { todo: todo.id, prog: prog.id, done: done.id },
    P: { med: med.id, high: high.id },
    users, roles,
  };
});

describe("task creation guards", () => {
  it("only PM can create tasks; developer and viewer cannot", async () => {
    // Rule: task creation is restricted to PM + Admin. Developer/Viewer/QA cannot create.
    const { ctx: pmctx } = await membership("pm");
    const t = await createTask(db, pmctx, { title: "pm task", priorityId: fx.P.med, statusId: fx.S.todo });
    expect(t.serial).toBeGreaterThan(0);

    const { ctx: devctx } = await membership("dev");
    await expect(createTask(db, devctx, { title: "dev task" })).rejects.toThrow(/create tasks/);

    const { ctx: vctx } = await membership("viewer");
    await expect(createTask(db, vctx, { title: "x" })).rejects.toThrow();
  });
  it("rejects non-Fibonacci points but allows hours-only", async () => {
    const { ctx } = await membership("pm");
    await expect(createTask(db, ctx, { title: "bad pts", storyPoints: 4 })).rejects.toThrow(/Story points/);
    const hoursOnly = await createTask(db, ctx, { title: "hours only", estHours: 6.5 });
    expect(hoursOnly.storyPoints).toBeNull();
    expect(estDays(hoursOnly.estHours, 8)).toBe(0.81);
  });
});

// Change request: new tasks can only be created in the To Do section — the
// API resolves the initial status through defaultCreationStatusId.
describe("creation starts in To Do", () => {
  it("resolves the To Do category status even when it is not the first column", async () => {
    const p = await db.project.create({ data: { key: uniq("T"), name: uniq("todo-rule"), hoursPerDay: 8 } });
    const wip = await db.status.create({ data: { projectId: p.id, name: "In Progress", category: "inprogress", color: "#00f", position: 0 } });
    const todo = await db.status.create({ data: { projectId: p.id, name: "To Do", category: "todo", color: "#888", position: 1 } });
    expect(await defaultCreationStatusId(db, p.id)).toBe(todo.id);
    // A project without a "todo" category falls back to the first status.
    await db.status.delete({ where: { id: todo.id } });
    expect(await defaultCreationStatusId(db, p.id)).toBe(wip.id);
  });
  it("creates with the resolved status (so the API override lands in To Do)", async () => {
    const { ctx } = await membership("pm");
    const t = await createTask(db, ctx, { title: uniq("todo-only"), statusId: await defaultCreationStatusId(db, fx.project.id) });
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.statusId).toBe(fx.S.todo);
  });
});

describe("edit + field-level permissions", () => {
  it("developer edits own task but not a teammate's", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx } = await membership("dev");
    const mine = await createTask(db, pm, { title: "mine", assigneeId: fx.users.dev });
    await updateTask(db, ctx, mine.id, { title: "mine v2", gitBranch: "feature/x" });
    const { ctx: ctx2 } = await membership("dev2");
    await expect(updateTask(db, ctx2, mine.id, { title: "hijack" })).rejects.toThrow(/cannot edit/);
  });
  it("estimate changes need edit_estimates even with full edit rights", async () => {
    // custom role: can edit everything except estimates
    const limited = await db.role.create({
      data: {
        name: uniq("NoEstimates"),
        permissions: JSON.stringify({ view_project: true, create_task: true, edit_task_all: true, change_status: true, comment: true }),
        fieldRules: JSON.stringify({ title: "editable", estHours: "editable", status: "editable" }),
      },
    });
    const u = await db.user.create({
      data: { email: uniq("le") + "@t.local", username: uniq("le"), name: "le", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    await db.projectMember.create({ data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: limited.id }] } } });
    const m = (await getMembership(db, u.id, false, fx.project.id))!;
    const ctx = ctxFromLoad(fx.project, m, u.id);
    const t = await createTask(db, ctx, { title: "limited task", assigneeId: u.id });
    await expect(updateTask(db, ctx, t.id, { estHours: 50 })).rejects.toThrow(/estimates/);
    await updateTask(db, ctx, t.id, { title: "renamed ok" });
  });
  it("QA cannot touch estimates; can edit feedback-ish fields only", async () => {
    const { ctx: qa } = await membership("qa");
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: "qa target", assigneeId: fx.users.pm });
    await expect(updateTask(db, qa, t.id, { estHours: 9 })).rejects.toThrow();
    await expect(updateTask(db, qa, t.id, { title: "qa rename" })).rejects.toThrow();
  });
});

describe("workflow transitions per role", () => {
  it("developer moves To Do -> In Progress but not -> Done", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "flow", assigneeId: fx.users.dev });
    await updateTask(db, dev, t.id, { statusId: fx.S.prog });
    await expect(updateTask(db, dev, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/i);
  });
  it("QA moves In Progress -> Done and automation stamps endDate", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: "qa flow", assigneeId: fx.users.pm, statusId: fx.S.prog, startDate: "2026-10-01" });
    const { ctx: qa } = await membership("qa");
    await updateTask(db, qa, t.id, { statusId: fx.S.done });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.endDate).not.toBeNull();
    expect(after.endDate!.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });
  it("Phase 3: a status-only move into a final status never reassigns the task", async () => {
    // The board/table/drawer skip the "Assign to" step for final statuses and send
    // only { statusId }; the server must leave the assignee exactly as it was.
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: "final keeps assignee", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await updateTask(db, qa, t.id, { statusId: fx.S.done });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.done);
    expect(after.assigneeId).toBe(fx.users.dev);
  });
  it("Phase 3: the status-change Assign step may bundle an assignee pick", async () => {
    // QA has no `assign` permission and assignee is readonly for the role, but the
    // status-change "Assign to" step is allowed to change the assignee together with
    // the status (non-final target).
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: "assign step", assigneeId: fx.users.pm, statusId: fx.S.todo });
    await updateTask(db, qa, t.id, { statusId: fx.S.prog, assigneeId: fx.users.dev });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.prog);
    expect(after.assigneeId).toBe(fx.users.dev);
  });
});

describe("archive is a derived view + Bangla search", () => {
  it("Done tasks show under archived=true only", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: "arch me", assigneeId: fx.users.pm, statusId: fx.S.done });
    const archived = await listTasks(db, pm, { archived: true, take: 1000 });
    const active = await listTasks(db, pm, { archived: false, take: 1000 });
    expect(archived.tasks.some((x) => x.id === t.id)).toBe(true);
    expect(active.tasks.some((x) => x.id === t.id)).toBe(false);
  });
  it("finds Bangla content", async () => {
    const { ctx: pm } = await membership("pm");
    await createTask(db, pm, { title: "bangla task", description: "ম্যাপে বিভাগগুলো প্রদর্শন" });
    const found = await listTasks(db, pm, { search: "বিভাগ", take: 1000 });
    expect(found.tasks.some((x) => x.title === "bangla task")).toBe(true);
    const miss = await listTasks(db, pm, { search: "চিঠি", take: 1000 });
    expect(miss.tasks.some((x) => x.title === "bangla task")).toBe(false);
  });
});

describe("Phase 1: multi-role membership (union of permissions)", () => {
  it("a member with Developer + QA roles gets the union of both", async () => {
    // give dev a second role (QA) in this project
    const member = await db.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: fx.project.id, userId: fx.users.dev } },
    });
    await db.projectMemberRole.deleteMany({ where: { memberId: member.id, roleId: fx.roles["QA / Tester"] } });
    await db.projectMemberRole.create({
      data: { memberId: member.id, roleId: fx.roles["QA / Tester"] },
    });
    const m = (await getMembership(db, fx.users.dev, false, fx.project.id))!;
    expect(m.roleIds).toHaveLength(2);
    expect(m.roleNames.sort()).toEqual(["T-Developer", "T-QA / Tester"].sort());
    // union: still cannot create (neither role grants it), can change_status (both do)
    expect(m.perms.create_task).toBeFalsy();
    expect(m.perms.change_status).toBe(true);
    expect(m.perms.view_project).toBe(true);
    // field rules take the most permissive across roles (QA gets feedback editable)
    expect(m.fieldRules.feedback).toBe("editable");
    // cleanup: back to single role so other tests are unaffected
    await db.projectMemberRole.deleteMany({ where: { memberId: member.id, roleId: fx.roles["QA / Tester"] } });
  });

  it("transition allowed if ANY held role is listed", async () => {
    // prog -> done allows PM + QA only. Give dev the QA role temporarily.
    const member = await db.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: fx.project.id, userId: fx.users.dev } },
    });
    await db.projectMemberRole.deleteMany({ where: { memberId: member.id, roleId: fx.roles["QA / Tester"] } });
    await db.projectMemberRole.create({ data: { memberId: member.id, roleId: fx.roles["QA / Tester"] } });
    try {
      const m = (await getMembership(db, fx.users.dev, false, fx.project.id))!;
      const ctx = ctxFromLoad(fx.project, m, fx.users.dev);
      const { ctx: pmctx } = await membership("pm");
      const t = await createTask(db, pmctx, { title: "qa-assisted", assigneeId: fx.users.dev, statusId: fx.S.prog });
      // prog -> done is restricted to PM/QA; dev+QA union passes
      await updateTask(db, ctx, t.id, { statusId: fx.S.done });
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.statusId).toBe(fx.S.done);
    } finally {
      await db.projectMemberRole.deleteMany({ where: { memberId: member.id, roleId: fx.roles["QA / Tester"] } });
    }
  });
});

describe("Phase 1: project-creation gate (Admin/PM only)", () => {
  it("PM-level user passes; developer and viewer do not", async () => {
    const pmCan = await userHasGlobalAction(db, fx.users.pm, false, "manage_members");
    const devCan = await userHasGlobalAction(db, fx.users.dev, false, "manage_members");
    const viewerCan = await userHasGlobalAction(db, fx.users.viewer, false, "manage_members");
    const superCan = await userHasGlobalAction(db, fx.users.dev, true, "manage_members");
    expect(pmCan).toBe(true);
    expect(devCan).toBe(false);
    expect(viewerCan).toBe(false);
    expect(superCan).toBe(true);
  });
});

describe("Designation is a role reference and a label only", () => {
  it("setting a designation never changes roles or permissions", async () => {
    const before = (await getMembership(db, fx.users.dev, false, fx.project.id))!;
    // Designation points at a role (the Users page stores the role id).
    const pmRole = await db.role.create({ data: { name: `TMP-PM-${Date.now()}`, permissions: "{}", fieldRules: "{}" } });
    await db.user.update({ where: { id: fx.users.dev }, data: { designation: pmRole.id } });
    const after = (await getMembership(db, fx.users.dev, false, fx.project.id))!;
    // identical permission surface despite a PM-sounding designation
    expect(after.perms).toEqual(before.perms);
    expect(after.roleIds).toEqual(before.roleIds);
    expect(after.roleName).toBe(before.roleName);
    const roleCount = await db.projectMemberRole.count({
      where: { member: { projectId: fx.project.id, userId: fx.users.dev } },
    });
    expect(roleCount).toBe(1);
    // cleanup
    await db.user.update({ where: { id: fx.users.dev }, data: { designation: null } });
    await db.role.delete({ where: { id: pmRole.id } });
  });

  it("rejects a designation pointing at a role that does not exist", async () => {
    const res = await resolveDesignationRole(db, "role-does-not-exist");
    expect(res).toMatchObject({ ok: false, status: 400 });
    // empty / null simply clears the designation
    await expect(resolveDesignationRole(db, "")).resolves.toBeNull();
    await expect(resolveDesignationRole(db, null)).resolves.toBeNull();
  });
});

describe("Phase 2: forward-only status rule (server-enforced)", () => {
  it("another role may move a task forward but not backward", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "flow fwd", assigneeId: fx.users.dev, statusId: fx.S.todo });
    // forward: To Do(0) -> In Progress(1), transition allows all roles
    await updateTask(db, dev, t.id, { statusId: fx.S.prog });
    // even with a role-allowing backward transition row, direction rule wins
    await db.statusTransition.create({
      data: { projectId: fx.project.id, fromId: fx.S.prog, toId: fx.S.todo, roleIds: "[]" },
    });
    try {
      await expect(updateTask(db, dev, t.id, { statusId: fx.S.todo })).rejects.toThrow(/cannot move a task back/);
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.statusId).toBe(fx.S.prog);
    } finally {
      await db.statusTransition.deleteMany({
        where: { projectId: fx.project.id, fromId: fx.S.prog, toId: fx.S.todo },
      });
    }
  });

  it("PM (manage_workflow) may move to any status, including backward", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: "pm back", statusId: fx.S.prog });
    // no prog->todo transition row exists; PM bypasses the matrix entirely
    await updateTask(db, pm, t.id, { statusId: fx.S.todo });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.todo);
  });

  it("superadmin may move backward", async () => {
    const { ctx: pm } = await membership("pm");
    const m = (await getMembership(db, fx.users.dev, true, fx.project.id))!;
    const superCtx = ctxFromLoad(fx.project, m, fx.users.dev);
    const t = await createTask(db, pm, { title: "super back", statusId: fx.S.done });
    await updateTask(db, superCtx, t.id, { statusId: fx.S.prog });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.prog);
  });

  it("forward move still requires a transition row for non-managers", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    // fixture: prog(1) -> done(2) is forward but limited to PM/QA roles
    const t = await createTask(db, pm, { title: "matrix block", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(updateTask(db, dev, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/);
  });
});

describe("Phase 2: status-change 'Assign to' step", () => {
  it("member without `assign` may set the assignee only together with a status change", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: "assign step", assigneeId: fx.users.pm, statusId: fx.S.prog });
    // QA lacks `assign` and its assignee field rule is readonly — both bypassed by the assign step
    await updateTask(db, qa, t.id, { statusId: fx.S.done, assigneeId: fx.users.dev });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.done);
    expect(after.assigneeId).toBe(fx.users.dev);
  });

  it("same member cannot reassign without a status change", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: "no lone reassign", assigneeId: fx.users.pm, statusId: fx.S.done });
    await expect(updateTask(db, qa, t.id, { assigneeId: fx.users.dev })).rejects.toThrow(/cannot edit|cannot assign/);
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBe(fx.users.pm);
  });

  it("developer cannot reassign a task alone either", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "dev no reassign", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(updateTask(db, dev, t.id, { assigneeId: fx.users.dev2 })).rejects.toThrow(/assign/);
  });

  it("Admin/PM may reassign at any time without a status change", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: "pm reassign", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await updateTask(db, pm, t.id, { assigneeId: fx.users.qa });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBe(fx.users.qa);
  });

  it("a rejected status move also rejects the bundled assignee", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "bundled reject", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(
      updateTask(db, dev, t.id, { statusId: fx.S.todo, assigneeId: fx.users.dev2 }),
    ).rejects.toThrow(/cannot move a task back/);
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBe(fx.users.dev);
    expect(after.statusId).toBe(fx.S.prog);
  });
});

describe("Phase 2: status + assignee changes are logged and notified", () => {
  it("status change writes task.status activity; new assignee gets a notification", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: "logged move", assigneeId: fx.users.pm, statusId: fx.S.prog });
    await updateTask(db, qa, t.id, { statusId: fx.S.done, assigneeId: fx.users.dev });

    const statusAct = await db.activity.findFirst({
      where: { taskId: t.id, action: "task.status" },
      orderBy: { createdAt: "desc" },
    });
    expect(statusAct).not.toBeNull();
    expect(statusAct!.after).toBe("Done");

    const notif = await db.notification.findFirst({
      where: { userId: fx.users.dev, kind: "task_assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(notif).not.toBeNull();
    expect(notif!.body).toBe("logged move");
  });
});

describe("status → designation suggestion helpers (role names)", () => {
  it("replaceStatusDesignations stores trimmed, case-insensitively deduplicated text", async () => {
    try {
      const saved = await replaceStatusDesignations(db, fx.S.prog, ["  QA ", "qa", "Dev Ops", "", "   "]);
      expect(saved).toEqual(["QA", "Dev Ops"]);
      const rows = await db.statusDesignationTag.findMany({ where: { statusId: fx.S.prog }, orderBy: { text: "asc" } });
      expect(rows.map((r) => r.text)).toEqual(["Dev Ops", "QA"]);
      await replaceStatusDesignations(db, fx.S.prog, ["\tReviewer "]);
      const replaced = await db.statusDesignationTag.findMany({ where: { statusId: fx.S.prog } });
      expect(replaced.map((r) => r.text)).toEqual(["Reviewer"]);
      await replaceStatusDesignations(db, fx.S.prog, []);
      expect(await db.statusDesignationTag.count({ where: { statusId: fx.S.prog } })).toBe(0);
    } finally {
      await db.statusDesignationTag.deleteMany({ where: { statusId: fx.S.prog } });
    }
  });

  it("suggestedForStatus matches free-text designations case- and space-insensitively", () => {
    const members = [
      { userId: "u1", name: "Dev", designationName: "Frontend Developer" },
      { userId: "u2", name: "QA", designationName: " QA  Engineer " },
      { userId: "u3", name: "No title", designationName: null },
    ];
    const { suggested, others } = suggestedForStatus(members, ["qa engineer"]);
    expect(suggested.map((m) => m.userId)).toEqual(["u2"]);
    expect(others.map((m) => m.userId)).toEqual(["u1", "u3"]);
    const empty = suggestedForStatus(members, []);
    expect(empty.suggested).toHaveLength(0);
    expect(empty.others).toHaveLength(3);
  });
});

/**
 * Item 1: Assignee / Tested By must offer EVERY valid user (Users section),
 * not just the members of the project being viewed — and the server must accept
 * them. Soft-deleted users stay unusable; deactivated users stay assignable so
 * existing work keeps its owner.
 */
describe("assignable user directory (all valid users)", () => {
  async function makeUser(key: string, extra: { active?: boolean; deletedAt?: Date } = {}) {
    const u = await db.user.create({
      data: {
        email: uniq(key) + "@t.local", username: uniq(key), name: uniq(key),
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
        ...extra,
      },
    });
    return u.id;
  }

  it("listAssignableUsers returns every non-deleted user exactly once and flags members", async () => {
    const outsider = await makeUser("outsider");
    const rows = await listAssignableUsers(db, fx.project.id);

    const valid = await db.user.count({ where: { deletedAt: null } });
    expect(rows).toHaveLength(valid);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(rows.length);

    const mine = rows.find((r) => r.userId === outsider);
    expect(mine).toBeDefined();
    expect(mine!.isMember).toBe(false);
    expect(mine!.roleNames).toEqual([]);

    const member = rows.find((r) => r.userId === fx.users.dev);
    expect(member!.isMember).toBe(true);
    expect(member!.roleNames.length).toBeGreaterThan(0);
  });

  it("assigns (and re-assigns) a registered user who is not a project member", async () => {
    const { ctx } = await membership("pm");
    const outsider = await makeUser("outsider-a");
    const t = await createTask(db, ctx, {
      title: "outsider work", statusId: fx.S.todo, priorityId: fx.P.med,
      assigneeId: outsider, testedById: outsider,
    });
    expect(t.assigneeId).toBe(outsider);
    expect(t.testedById).toBe(outsider);
    // assignment did NOT create a project membership
    expect(await db.projectMember.count({ where: { projectId: fx.project.id, userId: outsider } })).toBe(0);

    const other = await makeUser("outsider-b");
    await updateTask(db, ctx, t.id, { assigneeId: other });
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assigneeId).toBe(other);

    await db.task.delete({ where: { id: t.id } });
  });

  it("still rejects a soft-deleted user as assignee or tester", async () => {
    const { ctx } = await membership("pm");
    const gone = await makeUser("gone", { deletedAt: new Date() });
    await expect(createTask(db, ctx, {
      title: "deleted owner", statusId: fx.S.todo, priorityId: fx.P.med, assigneeId: gone,
    })).rejects.toThrow(/registered user/);
  });

  it("keeps a deactivated (inactive) user assignable and their tasks editable", async () => {
    const { ctx } = await membership("pm");
    const id = await makeUser("deactivated");
    const t = await createTask(db, ctx, {
      title: "before deactivation", statusId: fx.S.todo, priorityId: fx.P.med, assigneeId: id,
    });
    await db.user.update({ where: { id }, data: { active: false } });

    // Editing an existing task assigned to a now-inactive user must not fail.
    await updateTask(db, ctx, t.id, { title: "renamed while owner inactive" });
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.title).toBe("renamed while owner inactive");
    expect(row.assigneeId).toBe(id);

    await db.task.delete({ where: { id: t.id } });
  });
});

describe("create/update return the full row every view renders (regression)", () => {
  // The board and table insert the API's task row straight into the shared
  // store, so a bare transaction row (no status/priority/key) crashed the
  // table's row renderer after a quick-add, and left stale status chips after
  // an edit. createTask/updateTask must return the same shape as listTasks.
  it("createTask includes status, priority, key and the serialized fields", async () => {
    const { ctx } = await membership("pm");
    const t = await createTask(db, ctx, { title: uniq("full row"), statusId: fx.S.todo });
    expect(t.status?.id).toBe(fx.S.todo);
    expect(t.status?.category).toBe("todo");
    expect(t.priority?.id).toBe(fx.P.med);
    expect(t.key).toBe(`${fx.project.key}-${t.serial}`);
    expect(t.labels).toEqual([]);
    expect(t.customValues).toEqual({});
    expect(typeof t.timerState).toBe("string");
    await db.task.delete({ where: { id: t.id } });
  });

  it("updateTask returns the refreshed status (and serialized shape) after a change", async () => {
    const { ctx } = await membership("pm");
    const t = await createTask(db, ctx, { title: uniq("status refresh"), statusId: fx.S.todo });
    const updated = await updateTask(db, ctx, t.id, { statusId: fx.S.prog });
    expect(updated.statusId).toBe(fx.S.prog);
    expect(updated.status?.id).toBe(fx.S.prog);
    expect(updated.status?.category).toBe("inprogress");
    expect(updated.key).toBe(`${fx.project.key}-${t.serial}`);
    await db.task.delete({ where: { id: t.id } });
  });
});
