import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_ROLES, getMembership } from "../src/lib/permissions";
import { ctxFromLoad, createTask, type TaskContext } from "../src/lib/tasks";
import {
  canEditTargetUser,
  canUseUsersPage,
  softDeleteUser,
  updateManagedUser,
  userProjectsSummary,
} from "../src/lib/users";
import {
  AVATAR_MAX_BYTES,
  avatarFileName,
  deleteAvatarFile,
  isJpegBuffer,
  saveAvatarFile,
  validateAvatarUpload,
} from "../src/lib/avatar";

const TEST_URL = "file:./tests/test-users.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

let fx: {
  A: { id: string; key: string; hoursPerDay: number; pointScale: number[] };
  B: { id: string; key: string; hoursPerDay: number; pointScale: number[] };
  S: Record<string, string>;
  users: Record<string, string>; // admin, pm, dev, outsider
};

async function membership(projectId: string, userKey: string): Promise<TaskContext> {
  const m = await getMembership(db, fx.users[userKey], false, projectId);
  expect(m).not.toBeNull();
  return ctxFromLoad(projectId === fx.A.id ? fx.A : fx.B, m!, fx.users[userKey]);
}

async function makeUser(key: string, isSuperAdmin = false): Promise<string> {
  const u = await db.user.create({
    data: {
      email: uniq(key) + "@t.local",
      username: uniq(key),
      name: `name-${key}`,
      passwordHash: await hashPassword("Demo1234!"),
      mustChangePassword: false,
      isSuperAdmin,
    },
  });
  return u.id;
}

beforeAll(async () => {
  await db.$connect();
  const roles: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const existing = await db.role.findUnique({ where: { name: `U-${name}` } });
    const r = existing ?? (await db.role.create({
      data: {
        name: `U-${name}`,
        description: def.description,
        permissions: JSON.stringify(def.permissions),
        fieldRules: JSON.stringify(def.fieldRules),
      },
    }));
    roles[name] = r.id;
  }

  const A = await db.project.create({ data: { key: uniq("UA"), name: "Users Alpha", hoursPerDay: 8 } });
  const B = await db.project.create({ data: { key: uniq("UB"), name: "Users Beta", hoursPerDay: 8 } });
  const todo = await db.status.create({ data: { projectId: A.id, name: "To Do", category: "todo", color: "#888", position: 0 } });
  const prog = await db.status.create({ data: { projectId: A.id, name: "In Progress", category: "inprogress", color: "#00f", position: 1 } });
  await db.statusTransition.create({ data: { projectId: A.id, fromId: todo.id, toId: prog.id, roleIds: "[]" } });
  await db.priority.create({ data: { projectId: A.id, name: "Medium", level: 3, color: "#888" } });
  await db.issueType.create({ data: { projectId: A.id, name: "Task", color: "#00f" } });

  const admin = await makeUser("admin", true);
  const pm = await makeUser("pm");
  const dev = await makeUser("dev");
  const outsider = await makeUser("outsider");

  // pm manages project A; dev is a member of A; outsider is only a member of B
  await db.projectMember.create({ data: { projectId: A.id, userId: pm, roles: { create: [{ roleId: roles["Project Manager"] }] } } });
  await db.projectMember.create({ data: { projectId: A.id, userId: dev, roles: { create: [{ roleId: roles["Developer"] }] } } });
  await db.projectMember.create({ data: { projectId: B.id, userId: outsider, roles: { create: [{ roleId: roles["Developer"] }] } } });

  fx = {
    A: { id: A.id, key: A.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] },
    B: { id: B.id, key: B.key, hoursPerDay: 8, pointScale: [1, 2, 3, 5, 8, 13, 21] },
    S: { todo: todo.id, prog: prog.id },
    users: { admin, pm, dev, outsider },
  };
});

describe("Users page access (Phase 4)", () => {
  it("Admins and PM-level users open the page, regular members do not", async () => {
    expect(await canUseUsersPage(db, { id: fx.users.admin, isSuperAdmin: true })).toBe(true);
    expect(await canUseUsersPage(db, { id: fx.users.pm, isSuperAdmin: false })).toBe(true);
    expect(await canUseUsersPage(db, { id: fx.users.dev, isSuperAdmin: false })).toBe(false);
  });

  it("an Admin edits anyone; a PM only users of a project they manage", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    expect(await canEditTargetUser(db, admin, fx.users.outsider)).toBe(true);
    expect(await canEditTargetUser(db, pm, fx.users.dev)).toBe(true);
    expect(await canEditTargetUser(db, pm, fx.users.outsider)).toBe(false);
    expect(await canEditTargetUser(db, { id: fx.users.dev, isSuperAdmin: false }, fx.users.dev)).toBe(false);
  });
});

describe("updateManagedUser rules (Phase 4)", () => {
  it("a PM may rename a member of a project they manage (and it is audited)", async () => {
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const res = await updateManagedUser(db, pm, fx.users.dev, { name: `renamed-by-pm-${n}` });
    expect(res.ok).toBe(true);
    const dev = await db.user.findUniqueOrThrow({ where: { id: fx.users.dev } });
    expect(dev.name).toBe(`renamed-by-pm-${n}`);
    const log = await db.auditLog.findFirst({ where: { action: "user.update", entityId: fx.users.dev }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(fx.users.pm);
  });

  it("a PM cannot touch users outside their projects, nor admin-only fields", async () => {
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const outside = await updateManagedUser(db, pm, fx.users.outsider, { name: "nope" });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.status).toBe(403);

    const email = await updateManagedUser(db, pm, fx.users.dev, { email: uniq("pm-sets") + "@t.local" });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.error).toMatch(/Only an Admin/);

    const flag = await updateManagedUser(db, pm, fx.users.dev, { isSuperAdmin: true });
    expect(flag.ok).toBe(false);

    const active = await updateManagedUser(db, pm, fx.users.dev, { active: false });
    expect(active.ok).toBe(false);
  });

  it("an Admin may change email and flags; self-destruction is blocked", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const newEmail = uniq("admin-mail") + "@t.local";
    const res = await updateManagedUser(db, admin, fx.users.dev, { email: newEmail });
    expect(res.ok).toBe(true);
    const dev = await db.user.findUniqueOrThrow({ where: { id: fx.users.dev } });
    expect(dev.email).toBe(newEmail);

    const selfDown = await updateManagedUser(db, admin, fx.users.admin, { active: false });
    expect(selfDown.ok).toBe(false);
    const selfDemote = await updateManagedUser(db, admin, fx.users.admin, { isSuperAdmin: false });
    expect(selfDemote.ok).toBe(false);
  });

  it("the last active Admin can neither be demoted nor deleted", async () => {
    const solo = await makeUser("solo-admin", true);
    // Test DBs persist between runs — park every other active Admin so `solo`
    // is the ONLY active Admin during this test, then restore them.
    const others = await db.user.findMany({
      where: { isSuperAdmin: true, active: true, deletedAt: null, id: { not: solo } },
      select: { id: true },
    });
    const otherIds = others.map((o) => o.id);
    await db.user.updateMany({ where: { id: { in: otherIds } }, data: { active: false } });
    try {
      const actor = { id: fx.users.admin, isSuperAdmin: true };
      const demote = await updateManagedUser(db, actor, solo, { isSuperAdmin: false });
      expect(demote.ok).toBe(false);
      if (!demote.ok) expect(demote.error).toMatch(/last active Admin/i);

      const del = await softDeleteUser(db, actor, solo);
      expect(del.ok).toBe(false);
      if (!del.ok) expect(del.error).toMatch(/last active Admin/i);
    } finally {
      await db.user.updateMany({ where: { id: { in: otherIds } }, data: { active: true } });
      await db.user.update({ where: { id: solo }, data: { deletedAt: new Date(), active: false, isSuperAdmin: false } });
    }
  });
});

describe("Designation = a role reference", () => {
  it("Admin and PM of a shared project may set it to an existing role id; empty clears", async () => {
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const role = await db.role.create({ data: { name: `UX-${Date.now()}`, permissions: "{}", fieldRules: "{}" } });
    const res = await updateManagedUser(db, pm, fx.users.dev, { designation: role.id });
    expect(res.ok).toBe(true);
    let dev = await db.user.findUniqueOrThrow({ where: { id: fx.users.dev } });
    expect(dev.designation).toBe(role.id);

    const res2 = await updateManagedUser(db, admin, fx.users.outsider, { designation: role.id });
    expect(res2.ok).toBe(true);
    const outside = await db.user.findUniqueOrThrow({ where: { id: fx.users.outsider } });
    expect(outside.designation).toBe(role.id);

    // empty clears it
    const cleared = await updateManagedUser(db, pm, fx.users.dev, { designation: "   " });
    expect(cleared.ok).toBe(true);
    dev = await db.user.findUniqueOrThrow({ where: { id: fx.users.dev } });
    expect(dev.designation).toBeNull();
    await db.role.delete({ where: { id: role.id } });
  });

  it("rejects a designation that is not an existing role id", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const res = await updateManagedUser(db, admin, fx.users.dev, { designation: "role-that-does-not-exist" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    // free text (the old behaviour) is rejected the same way
    const text = await updateManagedUser(db, admin, fx.users.dev, { designation: "Frontend Developer" });
    expect(text.ok).toBe(false);
  });

  it("PMs cannot set it for users outside their projects; regular users cannot at all", async () => {
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const role = await db.role.create({ data: { name: `TMP-${Date.now()}`, permissions: "{}", fieldRules: "{}" } });
    const outsider = await updateManagedUser(db, pm, fx.users.outsider, { designation: role.id });
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.status).toBe(403);

    const dev = { id: fx.users.dev, isSuperAdmin: false };
    const self = await updateManagedUser(db, dev, fx.users.dev, { designation: role.id });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.status).toBe(403);
    await db.role.delete({ where: { id: role.id } });
  });
});

describe("Step 2: userProjectsSummary (View projects modal)", () => {
  it("splits assigned/solved projects (a project can be both) and enforces permissions + scope", async () => {
    // Fresh users so earlier soft-deletes don't interfere.
    const owner = await makeUser("proj-owner");
    const other = await makeUser("proj-other");
    const doneStatus = await db.status.create({
      data: { projectId: fx.A.id, name: uniq("Done"), category: "done", color: "#0f0", position: 9 },
    });
    const bStatus = await db.status.create({
      data: { projectId: fx.B.id, name: uniq("ToDo"), category: "todo", color: "#888", position: 0 },
    });
    try {
      // Project A: one open + one done task assigned to `owner`.
      const devRoleA = await db.role.findUniqueOrThrow({ where: { name: "U-Developer" } });
      await db.projectMember.create({ data: { projectId: fx.A.id, userId: owner, roles: { create: [{ roleId: devRoleA.id }] } } });
      const pmA = await membership(fx.A.id, "pm");
      await createTask(db, pmA, { title: uniq("open"), assigneeId: owner, statusId: fx.S.todo });
      await createTask(db, pmA, { title: uniq("done"), assigneeId: owner, statusId: doneStatus.id });

      // Project B: one open task assigned to `other` (PM is not a member of B).
      const devRole = await db.role.findUniqueOrThrow({ where: { name: "U-Developer" } });
      await db.projectMember.create({ data: { projectId: fx.B.id, userId: other, roles: { create: [{ roleId: devRole.id }] } } });
      const bPriority = await db.priority.create({ data: { projectId: fx.B.id, name: uniq("Medium"), level: 3, color: "#888" } });
      const maxSerial = await db.task.aggregate({ where: { projectId: fx.B.id }, _max: { serial: true } });
      await db.task.create({
        data: {
          projectId: fx.B.id, serial: (maxSerial._max.serial ?? 0) + 1,
          title: uniq("b-open"), statusId: bStatus.id, priorityId: bPriority.id, assigneeId: other,
        },
      });

      // Admin sees everything for anyone.
      const admin = { id: fx.users.admin, isSuperAdmin: true };
      let res = await userProjectsSummary(db, admin, owner);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.assigned.map((p) => p.projectId)).toEqual([fx.A.id]);
        expect(res.assigned[0].openCount).toBe(1);
        expect(res.solved.map((p) => p.projectId)).toEqual([fx.A.id]);
        expect(res.solved[0].doneCount).toBe(1);
      }

      // PM of A may view anyone, scoped to their own projects.
      const pm = { id: fx.users.pm, isSuperAdmin: false };
      res = await userProjectsSummary(db, pm, owner);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.assigned.map((p) => p.projectId)).toEqual([fx.A.id]);
      const scoped = await userProjectsSummary(db, pm, other);
      expect(scoped.ok).toBe(true);
      if (scoped.ok) {
        expect(scoped.assigned).toHaveLength(0);
        expect(scoped.solved).toHaveLength(0);
      }

      // A normal user may view their own summary but not someone else's.
      const self = await userProjectsSummary(db, { id: other, isSuperAdmin: false }, other);
      expect(self.ok).toBe(true);
      if (self.ok) expect(self.assigned.map((p) => p.projectId)).toEqual([fx.B.id]);
      const denied = await userProjectsSummary(db, { id: other, isSuperAdmin: false }, owner);
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.status).toBe(403);

      // Deleted users are 404s.
      const missing = await userProjectsSummary(db, admin, "does-not-exist");
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.status).toBe(404);
    } finally {
      await db.status.delete({ where: { id: doneStatus.id } }).catch(() => {});
      await db.status.delete({ where: { id: bStatus.id } }).catch(() => {});
    }
  });
});

describe("softDeleteUser (Phase 4)", () => {
  it("unassigns tasks, drops memberships, revokes sessions and keeps history", async () => {
    // A task assigned to dev in project A + an active session.
    const pmCtx = await membership(fx.A.id, "pm");
    const task = await createTask(db, pmCtx, { title: `users-delete-${n}`, assigneeId: fx.users.dev, statusId: fx.S.todo });
    const session = await db.session.create({
      data: {
        tokenHash: uniq("tok"),
        userId: fx.users.dev,
        expiresAt: new Date(Date.now() + 3600_000),
        idleExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const res = await softDeleteUser(db, { id: fx.users.admin, isSuperAdmin: true }, fx.users.dev);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tasksUnassigned).toBeGreaterThanOrEqual(1);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeId).toBeNull();

    const dev = await db.user.findUniqueOrThrow({ where: { id: fx.users.dev } });
    expect(dev.deletedAt).not.toBeNull();
    expect(dev.active).toBe(false);
    expect(dev.isSuperAdmin).toBe(false);

    expect(await db.projectMember.count({ where: { userId: fx.users.dev } })).toBe(0);
    const sess = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sess.revokedAt).not.toBeNull();

    const log = await db.auditLog.findFirst({ where: { action: "user.delete", entityId: fx.users.dev } });
    expect(log).not.toBeNull();

    // Idempotence + edit protection for deleted accounts.
    const again = await softDeleteUser(db, { id: fx.users.admin, isSuperAdmin: true }, fx.users.dev);
    expect(again.ok).toBe(false);
    const edit = await updateManagedUser(db, { id: fx.users.admin, isSuperAdmin: true }, fx.users.dev, { name: "ghost" });
    expect(edit.ok).toBe(false);
  });

  it("nobody can delete their own account", async () => {
    const res = await softDeleteUser(db, { id: fx.users.admin, isSuperAdmin: true }, fx.users.admin);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/your own account/i);
  });
});

describe("avatar uploads (Phase 4)", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  it("accepts only .jpg/.jpeg with JPEG MIME and magic bytes, up to 2 MB", () => {
    const okUpload = { fileName: "me.jpg", mimeType: "image/jpeg", size: jpeg.length, buffer: jpeg };
    expect(validateAvatarUpload(okUpload)).toBeNull();
    expect(validateAvatarUpload({ ...okUpload, fileName: "me.jpeg" })).toBeNull();

    expect(validateAvatarUpload({ ...okUpload, fileName: "me.png" })).toMatch(/\.jpg or \.jpeg/);
    expect(validateAvatarUpload({ ...okUpload, mimeType: "image/png" })).toMatch(/JPEG/);
    expect(validateAvatarUpload({ ...okUpload, size: AVATAR_MAX_BYTES + 1 })).toMatch(/2 MB/);
    expect(validateAvatarUpload({ ...okUpload, buffer: Buffer.from("not a jpeg at all") })).toMatch(/valid JPEG/);
    expect(isJpegBuffer(jpeg)).toBe(true);
    expect(isJpegBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("generates safe filenames and stores/removes files under public/uploads/avatars", async () => {
    const name = avatarFileName();
    expect(name).toMatch(/^av-[a-z0-9]+-[0-9a-f]{12}\.jpg$/);

    const root = await mkdtemp(path.join(tmpdir(), "tt-avatar-"));
    try {
      const url = await saveAvatarFile(root, name, jpeg);
      expect(url).toBe(`/uploads/avatars/${name}`);
      expect(existsSync(path.join(root, "public", "uploads", "avatars", name))).toBe(true);

      await deleteAvatarFile(root, url);
      expect(existsSync(path.join(root, "public", "uploads", "avatars", name))).toBe(false);

      // Foreign URLs are ignored — the helper only ever touches our upload dir.
      await deleteAvatarFile(root, "https://example.com/evil.jpg");
      await deleteAvatarFile(root, null);
      expect(true).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
