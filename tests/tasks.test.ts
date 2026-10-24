import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, getMembership, userHasGlobalAction, type Membership } from "../src/lib/permissions";
import { ctxFromLoad, createTask, defaultCreationStatusId, listTasks, updateTask, TaskInput, type TaskContext, type TaskPatch } from "../src/lib/tasks";
import { listAssignableUsers } from "../src/lib/userDirectory";
import { replaceStatusDesignations, suggestedForStatus } from "../src/lib/workflow";
import { repairDesignations, syncUserDesignation } from "../src/lib/designation";
import { resolveDesignationRole, softDeleteUser } from "../src/lib/users";
import { estDays } from "../src/lib/domain";

const TEST_URL = "file:./tests/test-tasks.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

interface Fixture {
  project: { id: string; key: string; hoursPerDay: number };
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
    // test DBs persist between runs — always refresh the role definition so a
    // changed DEFAULT_ROLES (e.g. the new bypass_transitions flag) is applied.
    const r = await db.role.upsert({
      where: { name: `T-${name}` },
      update: { permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules) },
      create: {
        name: `T-${name}`, description: def.description,
        permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules),
      },
    });
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
    project: { id: project.id, key: project.key, hoursPerDay: 8 },
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
  it("allows hours-only tasks", async () => {
    const { ctx } = await membership("pm");
    const hoursOnly = await createTask(db, ctx, { title: "hours only", estHours: 6.5 });
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
        fieldRules: JSON.stringify({ title: "editable", estHours: "editable", status: "editable", assignee: "editable" }),
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

  it("Phase 1: readonly fields are rejected on CREATE too (server-enforced)", async () => {
    const role = await db.role.create({
      data: {
        name: uniq("CreateReadonly"),
        permissions: JSON.stringify({ view_project: true, create_task: true }),
        fieldRules: JSON.stringify({ title: "editable", status: "editable", assignee: "editable", estHours: "readonly", description: "hidden" }),
      },
    });
    const u = await db.user.create({
      data: { email: uniq("cr") + "@t.local", username: uniq("cr"), name: "cr", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    await db.projectMember.create({ data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: role.id }] } } });
    try {
      const m = (await getMembership(db, u.id, false, fx.project.id))!;
      const ctx = ctxFromLoad(fx.project, m, u.id);
      await expect(createTask(db, ctx, { title: "ro", estHours: 3 })).rejects.toThrow(/readonly/);
      await expect(createTask(db, ctx, { title: "hid", description: "secret" })).rejects.toThrow(/hidden/);
      const ok = await createTask(db, ctx, { title: "allowed", assigneeId: u.id });
      expect(ok.title).toBe("allowed");
    } finally {
      await db.projectMemberRole.deleteMany({ where: { roleId: role.id } });
      await db.projectMember.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } });
      await db.role.delete({ where: { id: role.id } });
    }
  });

  it("Phase 1: hidden fields are stripped from listTasks responses", async () => {
    const role = await db.role.create({
      data: {
        name: uniq("HiddenDesc"),
        permissions: JSON.stringify({ view_project: true, change_status: true }),
        fieldRules: JSON.stringify({ title: "editable", description: "hidden", status: "editable" }),
      },
    });
    const u = await db.user.create({
      data: { email: uniq("hd") + "@t.local", username: uniq("hd"), name: "hd", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    await db.projectMember.create({ data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: role.id }] } } });
    try {
      const { ctx: pm } = await membership("pm");
      const t = await createTask(db, pm, { title: uniq("hidden"), description: "top secret" });
      const m = (await getMembership(db, u.id, false, fx.project.id))!;
      const ctx = ctxFromLoad(fx.project, m, u.id);
      const list = await listTasks(db, ctx, { take: 1000 });
      const row = list.tasks.find((x) => x.id === t.id) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.description).toBeNull();
      expect(row!.title).toContain("hidden");
    } finally {
      await db.projectMemberRole.deleteMany({ where: { roleId: role.id } });
      await db.projectMember.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } });
      await db.role.delete({ where: { id: role.id } });
    }
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

describe("Phase 1: transitions are the only source of truth (no forward-only rule)", () => {
  it("a move with no configured transition row is denied, even forward", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "no row", assigneeId: fx.users.dev, statusId: fx.S.todo });
    // To Do(0) -> Done(2) is "forward" but no row exists -> DENIED.
    await expect(updateTask(db, dev, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/i);
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(fx.S.todo);
  });

  it("backward moves are denied without an explicit row, allowed with one", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    const t = await createTask(db, pm, { title: "back rule", assigneeId: fx.users.dev, statusId: fx.S.todo });
    await updateTask(db, dev, t.id, { statusId: fx.S.prog });
    // No prog->todo row yet: backward is denied (there is no implicit allow).
    await expect(updateTask(db, dev, t.id, { statusId: fx.S.todo })).rejects.toThrow(/transition/i);
    // Configure prog->todo for all roles, then it is allowed.
    const row = await db.statusTransition.create({
      data: { projectId: fx.project.id, fromId: fx.S.prog, toId: fx.S.todo, roleIds: "[]" },
    });
    try {
      await updateTask(db, dev, t.id, { statusId: fx.S.todo });
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.statusId).toBe(fx.S.todo);
    } finally {
      await db.statusTransition.delete({ where: { id: row.id } });
    }
  });

  it("Project Manager (bypass_transitions) may move to any status, including backward", async () => {
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

  it("forward move still requires a transition row for non-bypass roles", async () => {
    const { ctx: pm } = await membership("pm");
    const { ctx: dev } = await membership("dev");
    // fixture: prog(1) -> done(2) is forward but limited to PM/QA roles
    const t = await createTask(db, pm, { title: "matrix block", assigneeId: fx.users.dev, statusId: fx.S.prog });
    await expect(updateTask(db, dev, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/);
  });
});

/**
 * Phase 1 (the reported bug): a role that supervises support work is NOT a
 * workflow manager. `manage_workflow` lets a role EDIT the matrix, never bypass
 * it, and the role NAME / designation never matters — only the explicit
 * `bypass_transitions` flag does.
 */
describe("Phase 1: manage_workflow and role names do NOT bypass transitions", () => {
  async function roleContext(key: string, perms: Record<string, boolean>) {
    const role = await db.role.create({
      data: {
        name: uniq(key),
        permissions: JSON.stringify({ view_project: true, change_status: true, ...perms }),
        fieldRules: JSON.stringify({ title: "editable", status: "editable" }),
      },
    });
    const u = await db.user.create({
      data: {
        email: uniq(key) + "@t.local", username: uniq(key), name: key,
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    await db.projectMember.create({
      data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: role.id }] } },
    });
    const m = (await getMembership(db, u.id, false, fx.project.id))!;
    return { ctx: ctxFromLoad(fx.project, m, u.id), cleanup: async () => {
      await db.projectMemberRole.deleteMany({ where: { roleId: role.id } });
      await db.projectMember.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } });
      await db.role.delete({ where: { id: role.id } });
    } };
  }

  it("IT Support Executive cannot drag To Do -> Done or skip To Do -> Development Done", async () => {
    const support = await roleContext("IT Support Executive", { manage_workflow: true });
    try {
      const { ctx: pm } = await membership("pm");
      const t = await createTask(db, pm, { title: "support skip", assigneeId: fx.users.dev, statusId: fx.S.todo });
      // No To Do -> Done row exists: denied even though the move is "forward".
      await expect(updateTask(db, support.ctx, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/i);
      // To Do -> In Progress row exists and allows all roles — still allowed.
      await updateTask(db, support.ctx, t.id, { statusId: fx.S.prog });
      // In Progress -> Done is limited to PM/QA; the support role is not listed.
      await expect(updateTask(db, support.ctx, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/i);
    } finally {
      await support.cleanup();
    }
  });

  it("Developer with manage_workflow does not bypass", async () => {
    const devwf = await roleContext("DevWithWorkflow", { manage_workflow: true });
    try {
      const { ctx: pm } = await membership("pm");
      const t = await createTask(db, pm, { title: "dev wf", assigneeId: fx.users.dev, statusId: fx.S.todo });
      await expect(updateTask(db, devwf.ctx, t.id, { statusId: fx.S.done })).rejects.toThrow(/transition/i);
    } finally {
      await devwf.cleanup();
    }
  });

  it("only an explicit bypass_transitions flag grants the bypass", async () => {
    const bypass = await roleContext("ExplicitBypass", { bypass_transitions: true });
    try {
      const { ctx: pm } = await membership("pm");
      const t = await createTask(db, pm, { title: "bypass role", assigneeId: fx.users.dev, statusId: fx.S.todo });
      await updateTask(db, bypass.ctx, t.id, { statusId: fx.S.done });
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.statusId).toBe(fx.S.done);
    } finally {
      await bypass.cleanup();
    }
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
    ).rejects.toThrow(/transition/i);
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

describe("status → role suggestion helpers (Phase 1: role ids)", () => {
  it("replaceStatusDesignations stores role ids and ignores unknown ids", async () => {
    try {
      const saved = await replaceStatusDesignations(db, fx.S.prog, [
        fx.roles["QA / Tester"], fx.roles["Developer"], "not-a-role", fx.roles["QA / Tester"],
      ]);
      expect(saved.sort()).toEqual([fx.roles["Developer"], fx.roles["QA / Tester"]].sort());
      const rows = await db.statusDesignationTag.findMany({ where: { statusId: fx.S.prog } });
      expect(rows.map((r) => r.roleId).sort()).toEqual([...saved].sort());
      await replaceStatusDesignations(db, fx.S.prog, []);
      expect(await db.statusDesignationTag.count({ where: { statusId: fx.S.prog } })).toBe(0);
    } finally {
      await db.statusDesignationTag.deleteMany({ where: { statusId: fx.S.prog } });
    }
  });

  it("suggestedForStatus matches by role id, never by label text", () => {
    const members = [
      { userId: "u1", name: "Dev", roleIds: ["r-dev"] },
      { userId: "u2", name: "QA", roleIds: ["r-qa", "r-dev"] },
      { userId: "u3", name: "No role", roleIds: [] },
    ];
    const { suggested, others } = suggestedForStatus(members, ["r-qa"]);
    expect(suggested.map((m) => m.userId)).toEqual(["u2"]);
    expect(others.map((m) => m.userId)).toEqual(["u1", "u3"]);
    const empty = suggestedForStatus(members, []);
    expect(empty.suggested).toHaveLength(0);
    expect(empty.others).toHaveLength(3);
  });
});

/**
 * Phase 1 (role = designation): the displayed role must equal the role the user
 * actually holds. A stale `User.designation` (the reported "IT Support Executive
 * shows as Developer") is repaired from the real project roles.
 */
describe("Phase 1: designation stays consistent with project roles", () => {
  it("assigning a project role updates the primary designation, and the repair fixes stale rows", async () => {
    const u = await db.user.create({
      data: {
        email: uniq("desig") + "@t.local", username: uniq("desig"), name: "Desig",
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
        designation: fx.roles["Developer"],
      },
    });
    const m = await db.projectMember.create({
      data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: fx.roles["QA / Tester"] }] } },
    });
    try {
      // The user holds QA only; the stale Developer designation is replaced.
      const next = await syncUserDesignation(db, u.id);
      expect(next).toBe(fx.roles["QA / Tester"]);
      const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.designation).toBe(fx.roles["QA / Tester"]);

      // A repair pass is idempotent: the first sweep fixes any other stale rows
      // left in the persistent test DB, the second reports nothing left to fix.
      await repairDesignations(db);
      expect(await repairDesignations(db)).toBe(0);
    } finally {
      await db.projectMemberRole.deleteMany({ where: { memberId: m.id } });
      await db.projectMember.delete({ where: { id: m.id } });
      await db.user.delete({ where: { id: u.id } });
    }
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

/**
 * PHASE 4: "assigned by" snapshot + assignment history.
 *
 * The snapshot (Task.assignedById/assignedAt + the `assignedBy` relation) is
 * server-owned: create/reassign store the CURRENT user; a client-supplied id is
 * stripped by TaskInput (both the create POST and the PATCH parse bodies with
 * it), and the XLSX/CSV import never maps an "Assigned by" column — the
 * importer becomes the assigner. Every real assignee change appends a
 * `task.assigned` Activity row (exposed with resolved names by the API) and a
 * `task.assign` Audit row carrying the request IP. A same-assignee save writes
 * nothing, and unassigning clears the snapshot but keeps the history.
 */
describe("Phase 4: assigned-by snapshot + assignment history", () => {
  it("create stores the creator as assigner and appends a task.assigned row", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: uniq("assign-by"), assigneeId: fx.users.dev });
    // Responses replace the store row, so the snapshot must be on them too.
    expect(t.assignedById).toBe(fx.users.pm);
    expect(t.assignedBy?.id).toBe(fx.users.pm);
    expect(t.assignedAt).not.toBeNull();

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assignedById).toBe(fx.users.pm);
    expect(row.assignedAt).not.toBeNull();
    const act = await db.activity.findFirst({
      where: { taskId: t.id, action: "task.assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(act!.before).toBeNull();
    expect(act!.after).toBe(fx.users.dev);
    expect(act!.actorId).toBe(fx.users.pm);

    // no assignee at creation -> no snapshot, no history row
    const bare = await createTask(db, pm, { title: uniq("no-assignee") });
    const bareRow = await db.task.findUniqueOrThrow({ where: { id: bare.id } });
    expect(bareRow.assignedById).toBeNull();
    expect(bareRow.assignedAt).toBeNull();
    expect(await db.activity.count({ where: { taskId: bare.id, action: "task.assigned" } })).toBe(0);
    await db.task.delete({ where: { id: bare.id } });
  });

  it("client-supplied assignedById/assignedAt are stripped (TaskInput is the API contract)", async () => {
    const parsed = TaskInput.safeParse({ title: "x", assignedById: fx.users.dev, assignedAt: "2020-01-01" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect("assignedById" in data).toBe(false);
      expect("assignedAt" in data).toBe(false);
    }
    // runtime guard: even a fake cast cannot smuggle a snapshot in
    const { ctx: pm } = await membership("pm");
    const sneaky = {
      title: uniq("strip"), assigneeId: fx.users.dev,
      assignedById: fx.users.qa, assignedAt: new Date(0),
    } as unknown as TaskPatch;
    const t = await createTask(db, pm, sneaky);
    expect(t.assignedById).toBe(fx.users.pm); // the actor wins, never the body
  });

  it("reassigning updates the snapshot, history and the task.assign audit (with IP)", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: uniq("reassign"), assigneeId: fx.users.dev });
    const before = await db.task.findUniqueOrThrow({ where: { id: t.id } });

    // PATCH routes attach the request IP to ctx (Phase 6b wiring).
    await updateTask(db, { ...pm, ip: "203.0.113.9" }, t.id, { assigneeId: fx.users.qa });

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assigneeId).toBe(fx.users.qa);
    expect(row.assignedById).toBe(fx.users.pm);
    expect(row.assignedAt!.getTime()).toBeGreaterThanOrEqual(before.assignedAt!.getTime());

    const acts = await db.activity.findMany({
      where: { taskId: t.id, action: "task.assigned" },
      orderBy: { createdAt: "asc" },
    });
    expect(acts).toHaveLength(2);
    expect(acts[1].before).toBe(fx.users.dev);
    expect(acts[1].after).toBe(fx.users.qa);
    expect(acts[1].actorId).toBe(fx.users.pm);

    const auditRow = await db.auditLog.findFirst({
      where: { action: "task.assign", entityId: t.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.ip).toBe("203.0.113.9");
    const meta = JSON.parse(auditRow!.meta ?? "{}") as { from?: string; to?: string };
    expect(meta.from).toBe(fx.users.dev);
    expect(meta.to).toBe(fx.users.qa);
  });

  it("bulk-assigning many tasks snapshots the actor per task (the bulk route loops updateTask)", async () => {
    const { ctx: pm } = await membership("pm");
    const a = await createTask(db, pm, { title: uniq("bulk-a"), assigneeId: fx.users.dev });
    const b = await createTask(db, pm, { title: uniq("bulk-b"), assigneeId: fx.users.dev2 });
    await updateTask(db, pm, a.id, { assigneeId: fx.users.qa });
    await updateTask(db, pm, b.id, { assigneeId: fx.users.qa });
    for (const id of [a.id, b.id]) {
      const row = await db.task.findUniqueOrThrow({ where: { id } });
      expect(row.assigneeId).toBe(fx.users.qa);
      expect(row.assignedById).toBe(fx.users.pm);
      const act = await db.activity.findFirst({
        where: { taskId: id, action: "task.assigned" },
        orderBy: { createdAt: "desc" },
      });
      expect(act!.after).toBe(fx.users.qa);
    }
  });

  it("saving the same assignee is a no-op (no history row, no audit, snapshot untouched)", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: uniq("same-assignee"), assigneeId: fx.users.dev });
    const before = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    const historyBefore = await db.activity.count({ where: { taskId: t.id, field: "assigneeId" } });
    const auditBefore = await db.auditLog.count({ where: { action: "task.assign", entityId: t.id } });

    await updateTask(db, pm, t.id, { assigneeId: fx.users.dev, title: before.title });

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assignedById).toBe(before.assignedById);
    expect(row.assignedAt!.getTime()).toBe(before.assignedAt!.getTime());
    expect(await db.activity.count({ where: { taskId: t.id, field: "assigneeId" } })).toBe(historyBefore);
    expect(await db.auditLog.count({ where: { action: "task.assign", entityId: t.id } })).toBe(auditBefore);
  });

  it("unassigning clears the snapshot but keeps the full history", async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: uniq("unassign"), assigneeId: fx.users.dev });
    await updateTask(db, pm, t.id, { assigneeId: null });

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assigneeId).toBeNull();
    expect(row.assignedById).toBeNull();
    expect(row.assignedAt).toBeNull();

    const acts = await db.activity.findMany({
      where: { taskId: t.id, action: "task.assigned" },
      orderBy: { createdAt: "asc" },
    });
    expect(acts.map((a) => [a.before, a.after])).toEqual([
      [null, fx.users.dev],
      [fx.users.dev, null],
    ]);
  });

  it('filters by assignedById (incl. the "none" bucket) and exposes assignedBy on rows', async () => {
    const { ctx: pm } = await membership("pm");
    const t = await createTask(db, pm, { title: uniq("filter-by"), assigneeId: fx.users.dev });
    const bare = await createTask(db, pm, { title: uniq("filter-none") });

    const byPm = await listTasks(db, pm, { assignedById: fx.users.pm, take: 1000 });
    const row = byPm.tasks.find((x) => x.id === t.id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect((row!.assignedBy as { id: string }).id).toBe(fx.users.pm);
    expect((row!.assignedBy as { deletedAt: Date | null }).deletedAt).toBeNull();

    const none = await listTasks(db, pm, { assignedById: "none", take: 1000 });
    expect(none.tasks.some((x) => x.id === bare.id)).toBe(true);
    expect(none.tasks.some((x) => x.id === t.id)).toBe(false);
    await db.task.delete({ where: { id: bare.id } });
  });

  it("the status-change Assign step records the acting member as assigner", async () => {
    // QA has no `assign` permission — it bundles the pick with a status change.
    const { ctx: pm } = await membership("pm");
    const { ctx: qa } = await membership("qa");
    const t = await createTask(db, pm, { title: uniq("step-actor"), assigneeId: fx.users.pm, statusId: fx.S.prog });
    await updateTask(db, qa, t.id, { statusId: fx.S.done, assigneeId: fx.users.dev });
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assignedById).toBe(fx.users.qa);
    const act = await db.activity.findFirst({
      where: { taskId: t.id, action: "task.assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(act!.actorId).toBe(fx.users.qa);
  });

  it("automation set-assignee records the actor and the rule name (via meta)", async () => {
    const rule = await db.automationRule.create({
      data: {
        projectId: fx.project.id, name: uniq("AutoAssign"), trigger: "status_changed",
        condition: JSON.stringify({ toCategory: "done" }),
        action: JSON.stringify({ set: { assigneeId: fx.users.qa } }),
      },
    });
    try {
      const { ctx: pm } = await membership("pm");
      const { ctx: qa } = await membership("qa");
      const t = await createTask(db, pm, { title: uniq("auto-assign"), assigneeId: fx.users.dev, statusId: fx.S.prog });
      await updateTask(db, qa, t.id, { statusId: fx.S.done });

      const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.assigneeId).toBe(fx.users.qa);
      expect(row.assignedById).toBe(fx.users.qa); // the actor of the status change
      expect(row.assignedAt).not.toBeNull();

      const act = await db.activity.findFirst({
        where: { taskId: t.id, action: "task.assigned" },
        orderBy: { createdAt: "desc" },
      });
      expect(act!.before).toBe(fx.users.dev);
      expect(act!.after).toBe(fx.users.qa);
      expect(JSON.parse(act!.meta ?? "{}")).toEqual({ via: `automation:${rule.name}` });
    } finally {
      await db.automationRule.delete({ where: { id: rule.id } });
    }
  });

  it("automation that sets the current assignee writes nothing", async () => {
    const rule = await db.automationRule.create({
      data: {
        projectId: fx.project.id, name: uniq("AutoSame"), trigger: "status_changed",
        condition: JSON.stringify({ toCategory: "done" }),
        action: JSON.stringify({ set: { assigneeId: fx.users.dev } }),
      },
    });
    try {
      const { ctx: pm } = await membership("pm");
      const { ctx: qa } = await membership("qa");
      const t = await createTask(db, pm, { title: uniq("auto-same"), assigneeId: fx.users.dev, statusId: fx.S.prog });
      const before = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      const historyBefore = await db.activity.count({ where: { taskId: t.id, field: "assigneeId" } });
      await updateTask(db, qa, t.id, { statusId: fx.S.done });
      const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.assigneeId).toBe(fx.users.dev);
      expect(row.assignedAt!.getTime()).toBe(before.assignedAt!.getTime());
      expect(await db.activity.count({ where: { taskId: t.id, field: "assigneeId" } })).toBe(historyBefore);
    } finally {
      await db.automationRule.delete({ where: { id: rule.id } });
    }
  });

  it("deleting a user clears their tasks' snapshot and logs who did it (via:user-deleted)", async () => {
    const { ctx: pm } = await membership("pm");
    const gone = await db.user.create({
      data: {
        email: uniq("gone-owner") + "@t.local", username: uniq("gone-owner"), name: uniq("gone-owner"),
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    const t = await createTask(db, pm, { title: uniq("owner-deleted"), assigneeId: gone.id });
    const res = await softDeleteUser(db, { id: fx.users.pm, isSuperAdmin: false }, gone.id, "198.51.100.4");
    expect(res).toMatchObject({ ok: true, tasksUnassigned: 1 });

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.assigneeId).toBeNull();
    expect(row.assignedById).toBeNull();
    expect(row.assignedAt).toBeNull();

    const act = await db.activity.findFirst({
      where: { taskId: t.id, action: "task.assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(act!.before).toBe(gone.id);
    expect(act!.after).toBeNull();
    expect(act!.actorId).toBe(fx.users.pm);
    expect(JSON.parse(act!.meta ?? "{}")).toEqual({ via: "user-deleted" });
  });

  it('a deleted assigner stays visible with deletedAt (the UI marks "(removed)")', async () => {
    // A throwaway PM creates a task (so it becomes the assigner), then is deleted.
    const u = await db.user.create({
      data: {
        email: uniq("temp-pm") + "@t.local", username: uniq("temp-pm"), name: uniq("temp-pm"),
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    await db.projectMember.create({
      data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: fx.roles["Project Manager"] }] } },
    });
    const m = (await getMembership(db, u.id, false, fx.project.id))!;
    const creatorCtx = ctxFromLoad(fx.project, m, u.id);
    const t = await createTask(db, creatorCtx, { title: uniq("ghost-assigner"), assigneeId: fx.users.dev });

    await softDeleteUser(db, { id: fx.users.pm, isSuperAdmin: false }, u.id, "198.51.100.5");

    const { ctx: pm } = await membership("pm");
    const list = await listTasks(db, pm, { assignedById: u.id, take: 1000 });
    const row = list.tasks.find((x) => x.id === t.id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    const ab = row!.assignedBy as { id: string; name: string; deletedAt: Date | null };
    expect(ab.id).toBe(u.id);
    expect(ab.deletedAt).not.toBeNull();
  });

  it("a role that may not read the assignee never sees the assigned-by snapshot", async () => {
    const role = await db.role.create({
      data: {
        name: uniq("HiddenAssignee"),
        permissions: JSON.stringify({ view_project: true, change_status: true }),
        fieldRules: JSON.stringify({ title: "editable", status: "editable", assignee: "hidden" }),
      },
    });
    const u = await db.user.create({
      data: {
        email: uniq("ha") + "@t.local", username: uniq("ha"), name: "ha",
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    await db.projectMember.create({
      data: { projectId: fx.project.id, userId: u.id, roles: { create: [{ roleId: role.id }] } },
    });
    try {
      const { ctx: pm } = await membership("pm");
      const t = await createTask(db, pm, { title: uniq("hidden-assignee"), assigneeId: fx.users.dev });
      const m = (await getMembership(db, u.id, false, fx.project.id))!;
      const ctx = ctxFromLoad(fx.project, m, u.id);
      const list = await listTasks(db, ctx, { take: 1000 });
      const row = list.tasks.find((x) => x.id === t.id) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.assignee).toBeNull();
      expect(row!.assigneeId).toBeNull();
      expect(row!.assignedBy).toBeNull();
      expect(row!.assignedById).toBeNull();
      expect(row!.assignedAt).toBeNull();
    } finally {
      await db.projectMemberRole.deleteMany({ where: { roleId: role.id } });
      await db.projectMember.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } });
      await db.role.delete({ where: { id: role.id } });
    }
  });
});
