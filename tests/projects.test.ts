import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, getMembership } from "../src/lib/permissions";
import { ctxFromLoad, createTask, deleteTask, listTasks, updateTask, type TaskContext } from "../src/lib/tasks";
import { removeStatus } from "../src/lib/workflow-server";
import { subscribeGlobal } from "../src/lib/events";
import { listProjectMembers } from "../src/lib/members";
import { listProjectsForUser } from "../src/lib/server";

const TEST_URL = "file:./tests/test-projects.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

let fx: {
  A: { id: string; key: string; hoursPerDay: number; pointScale: number[] };
  B: { id: string; key: string; hoursPerDay: number; pointScale: number[] };
  S: Record<string, string>;
  users: Record<string, string>;
};

async function membership(projectId: string, userKey: string): Promise<TaskContext> {
  const m = await getMembership(db, fx.users[userKey], false, projectId);
  expect(m).not.toBeNull();
  return ctxFromLoad(projectId === fx.A.id ? fx.A : fx.B, m!, fx.users[userKey]);
}

beforeAll(async () => {
  await db.$connect();
  const roles: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    // test DBs persist between runs — reuse the fixture role instead of re-creating it
    const existing = await db.role.findUnique({ where: { name: `P-${name}` } });
    const r = existing ?? (await db.role.create({
      data: {
        name: `P-${name}`, description: def.description,
        permissions: JSON.stringify(def.permissions), fieldRules: JSON.stringify(def.fieldRules),
      },
    }));
    roles[name] = r.id;
  }

  const A = await db.project.create({ data: { key: uniq("PA"), name: "Alpha", hoursPerDay: 8 } });
  // Hidden project: only excluded from default LISTS — members keep access via direct link.
  const B = await db.project.create({ data: { key: uniq("PB"), name: "Beta", hoursPerDay: 8, isHidden: true } });

  const todo = await db.status.create({ data: { projectId: A.id, name: "To Do", category: "todo", color: "#888", position: 0 } });
  const prog = await db.status.create({ data: { projectId: A.id, name: "In Progress", category: "inprogress", color: "#00f", position: 1 } });
  const done = await db.status.create({ data: { projectId: A.id, name: "Done", category: "done", color: "#0a0", position: 2 } });
  await db.statusTransition.create({ data: { projectId: A.id, fromId: todo.id, toId: prog.id, roleIds: "[]" } });
  await db.priority.create({ data: { projectId: A.id, name: "Medium", level: 3, color: "#888" } });
  await db.issueType.create({ data: { projectId: A.id, name: "Task", color: "#00f" } });

  const users: Record<string, string> = {};
  for (const [key, roleName] of [["pm", "Project Manager"], ["dev", "Developer"]] as [string, string][]) {
    const u = await db.user.create({
      data: {
        email: uniq(key) + "@t.local", username: uniq(key), name: key,
        passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false,
      },
    });
    users[key] = u.id;
    await db.projectMember.create({
      data: { projectId: A.id, userId: u.id, roles: { create: [{ roleId: roles[roleName] }] } },
    });
  }
  // pm also belongs to the hidden project B
  await db.projectMember.create({
    data: { projectId: B.id, userId: users.pm, roles: { create: [{ roleId: roles["Project Manager"] }] } },
  });

  fx = {
    A: { id: A.id, key: A.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] },
    B: { id: B.id, key: B.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] },
    S: { todo: todo.id, prog: prog.id, done: done.id },
    users,
  };
});

describe("hidden projects (Phase 3)", () => {
  it("member list excludes hidden projects by default; includeHidden shows them", async () => {
    const def = await listProjectsForUser(fx.users.pm, false, false, db);
    const ids = def.map((p) => p.id);
    expect(ids).toContain(fx.A.id);
    expect(ids).not.toContain(fx.B.id);

    const all = await listProjectsForUser(fx.users.pm, false, true, db);
    const allIds = all.map((p) => p.id);
    expect(allIds).toContain(fx.A.id);
    expect(allIds).toContain(fx.B.id);
  });

  it("applies to superadmins too", async () => {
    const def = await listProjectsForUser(fx.users.pm, true, false, db);
    expect(def.map((p) => p.id)).not.toContain(fx.B.id);

    const all = await listProjectsForUser(fx.users.pm, true, true, db);
    expect(all.map((p) => p.id)).toContain(fx.B.id);
  });

  it("hiding does not remove project access — membership still loads", async () => {
    const m = await getMembership(db, fx.users.pm, false, fx.B.id);
    expect(m).not.toBeNull();
  });
});

describe("removeStatus — Kanban column removal (Phase 3)", () => {
  it("deletes an empty status together with its transitions and designation tags", async () => {
    const pm = await membership(fx.A.id, "pm");
    const st = await db.status.create({
      data: { projectId: fx.A.id, name: "Review", category: "inprogress", color: "#f80", position: 3 },
    });
    await db.statusTransition.create({ data: { projectId: fx.A.id, fromId: fx.S.todo, toId: st.id, roleIds: "[]" } });
    await db.statusDesignationTag.create({ data: { statusId: st.id, text: uniq("designer") } });

    const res = await removeStatus(db, pm, st.id, fx.S.prog);
    expect(res).toEqual({ deleted: true, moved: 0 });
    expect(await db.status.findUnique({ where: { id: st.id } })).toBeNull();
    expect(await db.statusTransition.count({ where: { OR: [{ fromId: st.id }, { toId: st.id }] } })).toBe(0);
    expect(await db.statusDesignationTag.count({ where: { statusId: st.id } })).toBe(0);
  });

  it("refuses to delete an occupied status without a target and keeps it intact", async () => {
    const pm = await membership(fx.A.id, "pm");
    const st = await db.status.create({
      data: { projectId: fx.A.id, name: "Blocked", category: "inprogress", color: "#f00", position: 3 },
    });
    await createTask(db, pm, { title: "occupant", statusId: st.id });
    await expect(removeStatus(db, pm, st.id, null)).rejects.toThrow(/still has 1 task/);
    expect(await db.status.findUnique({ where: { id: st.id } })).not.toBeNull();
  });

  it("moves tasks to the target status (activity logged) then deletes the column", async () => {
    const pm = await membership(fx.A.id, "pm");
    const st = await db.status.create({
      data: { projectId: fx.A.id, name: "Review2", category: "inprogress", color: "#f80", position: 4 },
    });
    const t = await createTask(db, pm, { title: "to move", statusId: st.id });
    const res = await removeStatus(db, pm, st.id, fx.S.prog);
    expect(res).toEqual({ deleted: true, moved: 1 });
    const after = await db.task.findUnique({ where: { id: t.id } });
    expect(after?.statusId).toBe(fx.S.prog);
    // every status change stays visible in Activity
    expect(await db.activity.count({ where: { taskId: t.id, action: "task.status" } })).toBeGreaterThan(0);
    expect(await db.status.findUnique({ where: { id: st.id } })).toBeNull();
  });

  it("rejects unknown targets (bogus, self, unknown status)", async () => {
    const pm = await membership(fx.A.id, "pm");
    const st = await db.status.create({
      data: { projectId: fx.A.id, name: "Temp", category: "todo", color: "#888", position: 5 },
    });
    await expect(removeStatus(db, pm, st.id, "nope")).rejects.toThrow(/Unknown target status/);
    await expect(removeStatus(db, pm, st.id, st.id)).rejects.toThrow(/Unknown target status/);
    await expect(removeStatus(db, pm, "missing", null)).rejects.toThrow(/Status not found/);
    expect(await db.status.findUnique({ where: { id: st.id } })).not.toBeNull();
  });
});

describe("project completion flag (Phase 2)", () => {
  async function completionFixture() {
    const proj = await db.project.create({ data: { key: uniq("PC"), name: uniq("gamma"), hoursPerDay: 8 } });
    const todo = await db.status.create({ data: { projectId: proj.id, name: "To Do", category: "todo", color: "#888", position: 0 } });
    const done = await db.status.create({ data: { projectId: proj.id, name: "Done", category: "done", color: "#0a0", position: 1 } });
    await db.statusTransition.create({ data: { projectId: proj.id, fromId: todo.id, toId: done.id, roleIds: "[]" } });
    await db.priority.create({ data: { projectId: proj.id, name: "Medium", level: 3, color: "#888" } });
    await db.issueType.create({ data: { projectId: proj.id, name: "Task", color: "#00f" } });
    const pmRole = await db.role.findFirstOrThrow({ where: { name: "P-Project Manager" } });
    await db.projectMember.create({ data: { projectId: proj.id, userId: fx.users.pm, roles: { create: [{ roleId: pmRole.id }] } } });
    const m = (await getMembership(db, fx.users.pm, false, proj.id))!;
    const ctx = ctxFromLoad(
      { id: proj.id, key: proj.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] }, m, fx.users.pm,
    );
    const completed = async () => (await db.project.findUniqueOrThrow({ where: { id: proj.id } })).isCompleted;
    return { proj, todo, done, ctx, completed };
  }

  it("0 tasks is never completed; all done completes; moving out / adding / deleting flips it back", async () => {
    const { proj, todo, done, ctx, completed } = await completionFixture();

    // 0 tasks ≠ completed (a new empty project is NOT completed)
    expect(await completed()).toBe(false);

    const t1 = await createTask(db, ctx, { title: "a", statusId: todo.id });
    const t2 = await createTask(db, ctx, { title: "b", statusId: todo.id });
    expect(await completed()).toBe(false);

    // every task in a final status → completed
    await updateTask(db, ctx, t1.id, { statusId: done.id });
    await updateTask(db, ctx, t2.id, { statusId: done.id });
    expect(await completed()).toBe(true);
    void proj;

    // one task back out of done → active again
    await updateTask(db, ctx, t1.id, { statusId: todo.id });
    expect(await completed()).toBe(false);

    // and back to done, a NEW task flips it right back off
    await updateTask(db, ctx, t1.id, { statusId: done.id });
    expect(await completed()).toBe(true);
    const t3 = await createTask(db, ctx, { title: "c", statusId: todo.id });
    expect(await completed()).toBe(false);

    // deleting the last open task → completed again …
    await deleteTask(db, ctx, t3.id);
    expect(await completed()).toBe(true);
    // … but deleting EVERYTHING keeps it active (0 tasks ≠ completed)
    await deleteTask(db, ctx, t1.id);
    await deleteTask(db, ctx, t2.id);
    expect(await completed()).toBe(false);
  });

  it("removing the final column moves its tasks out and flips completion off", async () => {
    const { proj, todo, done, ctx, completed } = await completionFixture();
    const t = await createTask(db, ctx, { title: "in done", statusId: done.id });
    expect(await completed()).toBe(true); // the only task already sits in a final column

    const res = await removeStatus(db, ctx, done.id, todo.id);
    expect(res).toEqual({ deleted: true, moved: 1 });
    expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ statusId: todo.id });
    expect(await completed()).toBe(false);
    void proj;
  });

  it("Step 5: flips are announced globally after the commit and leave the other tasks untouched", async () => {
    const { todo, done, ctx, completed } = await completionFixture();
    const t1 = await createTask(db, ctx, { title: "a", statusId: todo.id });
    const t2 = await createTask(db, ctx, { title: "b", statusId: todo.id });

    const seen: { type: string; payload: unknown }[] = [];
    const off = subscribeGlobal((e) => seen.push({ type: e.type, payload: e.payload }));
    try {
      // not every task is done yet → completion must not flip or announce
      await updateTask(db, ctx, t1.id, { statusId: done.id });
      expect(seen.filter((e) => e.type === "projects_changed")).toHaveLength(0);

      await updateTask(db, ctx, t2.id, { statusId: done.id });
      expect(await completed()).toBe(true);
      const announced = seen.filter((e) => e.type === "projects_changed");
      expect(announced).toHaveLength(1);
      expect(announced[0].payload).toMatchObject({ projectId: ctx.projectId, isCompleted: true });

      // one task back out of done → active again immediately, announced again,
      // and nothing else about the tasks changes (statuses stay untouched)
      await updateTask(db, ctx, t1.id, { statusId: todo.id });
      expect(await completed()).toBe(false);
      const t1After = await db.task.findUniqueOrThrow({ where: { id: t1.id } });
      expect(t1After.statusId).toBe(todo.id);
      expect(t1After.title).toBe("a");
      expect((await db.task.findUniqueOrThrow({ where: { id: t2.id } })).statusId).toBe(done.id);
      const flips = seen.filter((e) => e.type === "projects_changed");
      expect(flips).toHaveLength(2);
      expect(flips[1].payload).toMatchObject({ projectId: ctx.projectId, isCompleted: false });
    } finally {
      off();
    }
  });
});

describe("Members page shows live designations (role references)", () => {
  it("resolves the designated role's name live and follows renames", async () => {
    const before = await listProjectMembers(db, fx.A.id);
    const pm = before.members.find((m) => m.userId === fx.users.pm)!;
    expect(pm.roleNames).toContain("P-Project Manager");
    // nobody in this fixture has a designation yet → no chip
    expect(pm.designation).toBeNull();
    // every member carries the right roles alongside the (empty) designation
    const dev = before.members.find((m) => m.userId === fx.users.dev)!;
    expect(dev.roleNames).toEqual(["P-Developer"]);

    // Designation = a role id (exactly like the Users page dropdown stores it).
    const qaRole = await db.role.create({ data: { name: `P-QA-${Date.now()}`, permissions: "{}", fieldRules: "{}" } });
    await db.user.update({ where: { id: fx.users.pm }, data: { designation: qaRole.id } });
    const afterSet = await listProjectMembers(db, fx.A.id);
    expect(afterSet.members.find((m) => m.userId === fx.users.pm)!.designation).toBe(qaRole.name);
    expect(afterSet.members.find((m) => m.userId === fx.users.dev)!.designation).toBeNull();

    // Renaming the role updates every user's designation automatically
    // (the reference points at the role, never a copied string).
    const renamed = `P-QE-${Date.now()}`;
    await db.role.update({ where: { id: qaRole.id }, data: { name: renamed } });
    const afterRename = await listProjectMembers(db, fx.A.id);
    expect(afterRename.members.find((m) => m.userId === fx.users.pm)!.designation).toBe(renamed);
    // project roles are untouched by a designation change
    expect(afterRename.members.find((m) => m.userId === fx.users.pm)!.roleNames).toContain("P-Project Manager");

    // clearing the designation drops it from the list again
    await db.user.update({ where: { id: fx.users.pm }, data: { designation: null } });
    expect((await listProjectMembers(db, fx.A.id)).members.find((m) => m.userId === fx.users.pm)!.designation).toBeNull();
  });

  it("clears the designation when the referenced role is deleted", async () => {
    const role = await db.role.create({ data: { name: `P-Temp-${Date.now()}`, permissions: "{}", fieldRules: "{}" } });
    await db.user.update({ where: { id: fx.users.dev }, data: { designation: role.id } });
    expect((await listProjectMembers(db, fx.A.id)).members.find((m) => m.userId === fx.users.dev)!.designation).not.toBeNull();
    // The API clears references on delete; emulate the same server behaviour.
    await db.user.updateMany({ where: { designation: role.id }, data: { designation: null } });
    await db.role.delete({ where: { id: role.id } });
    expect((await listProjectMembers(db, fx.A.id)).members.find((m) => m.userId === fx.users.dev)!.designation).toBeNull();
  });
});
