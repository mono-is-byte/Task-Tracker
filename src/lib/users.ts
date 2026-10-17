import type { PrismaClient } from "@prisma/client";
import { audit } from "./auth";
import { mergeRoles, userHasGlobalAction } from "./permissions";

/**
 * Change request Phase 4: user account management rules.
 *
 * - The Users page is visible to Admins (superadmin) and PMs (a user holding
 *   `manage_members` in at least one project).
 * - Only an Admin can create/delete users, reset passwords, or change the
 *   active / super-admin flags and e-mail addresses.
 * - An Admin or a PM may rename a user and set their designation — a REFERENCE
 *   to a role in Roles & Permissions (the stored value is the Role id; the
 *   name is resolved live on display, so renaming a role updates every user's
 *   designation at once) — when the PM manages at least one project the target
 *   user is a member of.
 * - Deleting is a SOFT delete: the account can no longer log in, is unassigned
 *   from every task, loses all project memberships and active sessions, but
 *   comments/activity keep their name (history is never lost).
 * - A user can never delete themselves, and the last active Admin can never be
 *   deleted or demoted.
 */

export interface Actor {
  id: string;
  isSuperAdmin: boolean;
}

export interface Failure {
  ok: false;
  status: number;
  error: string;
}

export const OK = { ok: true } as const;

/** Can this user open the dedicated Users page? Admin or PM-level (manage_members). */
export async function canUseUsersPage(client: PrismaClient, actor: Actor): Promise<boolean> {
  if (actor.isSuperAdmin) return true;
  return userHasGlobalAction(client, actor.id, false, "manage_members");
}

/** True when an Admin/PM may edit `targetUserId`: Admin anywhere, PM only for
 *  users that share at least one project the actor manages (`manage_members`). */
export async function canEditTargetUser(
  client: PrismaClient,
  actor: Actor,
  targetUserId: string,
): Promise<boolean> {
  if (actor.isSuperAdmin) return true;
  const memberships = await client.projectMember.findMany({
    where: { userId: actor.id },
    include: { roles: { include: { role: true } } },
  });
  const managedProjectIds = memberships
    .filter((m) => mergeRoles(m.roles.map((l) => l.role)).perms.manage_members === true)
    .map((m) => m.projectId);
  if (managedProjectIds.length === 0) return false;
  const shared = await client.projectMember.count({
    where: { userId: targetUserId, projectId: { in: managedProjectIds } },
  });
  return shared > 0;
}

/** Active (non-deleted) super admins other than `excludeUserId`. */
export async function otherActiveAdmins(client: PrismaClient, excludeUserId: string): Promise<number> {
  return client.user.count({
    where: { isSuperAdmin: true, active: true, deletedAt: null, id: { not: excludeUserId } },
  });
}

export interface ManagedUserPatch {
  name?: string;
  email?: string;
  active?: boolean;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
  /** Designation = the id of a role from Roles & Permissions ("" / null clears). */
  designation?: string | null;
}

/**
 * Validate a designation payload: it must be empty ("" / null → no
 * designation) or the id of an existing role. The stored value is the Role
 * id — never a copied string — so a renamed role updates every user's
 * designation automatically.
 */
export async function resolveDesignationRole(
  client: PrismaClient,
  v: string | null | undefined,
): Promise<string | null | Failure> {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  const role = await client.role.findUnique({ where: { id: trimmed }, select: { id: true } });
  if (!role) {
    return { ok: false, status: 400, error: "That designation role no longer exists — pick one from the list." };
  }
  return role.id;
}

/** Phase 4 update rules (see file header). Admin-only fields are rejected for PMs. */
export async function updateManagedUser(
  client: PrismaClient,
  actor: Actor,
  targetUserId: string,
  patch: ManagedUserPatch,
  ip?: string,
): Promise<Failure | { ok: true; user: { id: string; name: string; email: string; active: boolean; isSuperAdmin: boolean } }> {
  const target = await client.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, status: 404, error: "User not found." };
  if (target.deletedAt) return { ok: false, status: 400, error: "This user has been deleted." };

  const adminOnlyFields = (["email", "active", "isSuperAdmin", "mustChangePassword"] as const).filter(
    (k) => patch[k] !== undefined,
  );
  if (!actor.isSuperAdmin) {
    if (adminOnlyFields.length > 0) {
      return { ok: false, status: 403, error: "Only an Admin can change this." };
    }
    if (patch.name === undefined && patch.designation === undefined) {
      return { ok: false, status: 400, error: "Nothing to update." };
    }
    if (!(await canEditTargetUser(client, actor, targetUserId))) {
      return { ok: false, status: 403, error: "Only Admins, and Project Managers of a shared project, can edit this user." };
    }
  }

  // Designation = a role reference — validate it exists before touching the row.
  const designation = patch.designation !== undefined
    ? await resolveDesignationRole(client, patch.designation)
    : undefined;
  if (designation && typeof designation === "object") return designation;

  // Last-admin protections: never demote or deactivate the final active Admin.
  if (target.isSuperAdmin && target.active) {
    if (patch.isSuperAdmin === false || patch.active === false) {
      if ((await otherActiveAdmins(client, targetUserId)) === 0) {
        return { ok: false, status: 400, error: "The last active Admin cannot be demoted or deactivated." };
      }
    }
  }
  if (targetUserId === actor.id) {
    if (patch.active === false) return { ok: false, status: 400, error: "You cannot deactivate yourself." };
    if (patch.isSuperAdmin === false) return { ok: false, status: 400, error: "You cannot remove your own Admin flag." };
  }

  const before = { name: target.name, email: target.email, active: target.active, isSuperAdmin: target.isSuperAdmin, designation: target.designation };
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.email !== undefined) data.email = patch.email.trim().toLowerCase();
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.isSuperAdmin !== undefined) data.isSuperAdmin = patch.isSuperAdmin;
  if (patch.mustChangePassword !== undefined) data.mustChangePassword = patch.mustChangePassword;
  if (designation !== undefined) data.designation = designation;

  let user;
  try {
    user = await client.user.update({ where: { id: targetUserId }, data });
  } catch {
    return { ok: false, status: 409, error: "E-mail or username already exists." };
  }
  await audit(client, {
    actorId: actor.id, action: "user.update", entity: "user", entityId: targetUserId,
    meta: { before, after: { name: user.name, email: user.email, active: user.active, isSuperAdmin: user.isSuperAdmin, designation: user.designation } }, ip,
  });
  if (before.isSuperAdmin !== user.isSuperAdmin || before.active !== user.active) {
    await audit(client, {
      actorId: actor.id, action: "user.role_change", entity: "user", entityId: targetUserId,
      meta: { before, after: { active: user.active, isSuperAdmin: user.isSuperAdmin } }, ip,
    });
  }
  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, active: user.active, isSuperAdmin: user.isSuperAdmin },
  };
}

/**
 * Step 2: per-user "View projects" summary for the Users page modal.
 *
 * - `assigned` = projects where the user has at least one task NOT in a final
 *   status (plus the open task count).
 * - `solved` = projects where the user has at least one task in a final status
 *   (plus the completed task count). A project can appear in both lists.
 * - Permissions: Admin sees everything; a PM-level user may look at any user
 *   but results stay scoped to the PM's own projects; a normal user only their
 *   own (self) summary.
 */
export interface UserProjectRow {
  projectId: string;
  key: string;
  name: string;
  openCount?: number;
  doneCount?: number;
}

export async function userProjectsSummary(
  client: PrismaClient,
  viewer: Actor,
  targetUserId: string,
): Promise<Failure | { ok: true; assigned: UserProjectRow[]; solved: UserProjectRow[] }> {
  const target = await client.user.findUnique({ where: { id: targetUserId }, select: { id: true, deletedAt: true } });
  if (!target || target.deletedAt) return { ok: false, status: 404, error: "User not found." };

  const isSelf = viewer.id === targetUserId;
  if (!viewer.isSuperAdmin && !isSelf) {
    const allowed = await userHasGlobalAction(client, viewer.id, false, "manage_members");
    if (!allowed) return { ok: false, status: 403, error: "Only Admins and Project Managers can view another user's projects." };
  }

  // Scope: Admin → every project; everyone else → the projects they belong to,
  // so a PM never learns about projects they have no access to.
  let scopeIds: string[] | null = null;
  if (!viewer.isSuperAdmin) {
    const memberships = await client.projectMember.findMany({
      where: { userId: viewer.id },
      select: { projectId: true },
    });
    scopeIds = memberships.map((m) => m.projectId);
  }

  const tasks = await client.task.findMany({
    where: {
      assigneeId: targetUserId,
      ...(scopeIds ? { projectId: { in: scopeIds } } : {}),
    },
    select: {
      projectId: true,
      status: { select: { category: true } },
      project: { select: { key: true, name: true } },
    },
  });

  const byProject = new Map<string, { projectId: string; key: string; name: string; openCount: number; doneCount: number }>();
  for (const t of tasks) {
    const rec = byProject.get(t.projectId) ?? {
      projectId: t.projectId, key: t.project.key, name: t.project.name, openCount: 0, doneCount: 0,
    };
    if (t.status.category === "done") rec.doneCount += 1;
    else rec.openCount += 1;
    byProject.set(t.projectId, rec);
  }
  const all = [...byProject.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    ok: true,
    assigned: all
      .filter((p) => p.openCount > 0)
      .map((p) => ({ projectId: p.projectId, key: p.key, name: p.name, openCount: p.openCount })),
    solved: all
      .filter((p) => p.doneCount > 0)
      .map((p) => ({ projectId: p.projectId, key: p.key, name: p.name, doneCount: p.doneCount })),
  };
}

/** Soft-delete a user (Admin only — the route enforces the flag). */
export async function softDeleteUser(
  client: PrismaClient,
  actor: Actor,
  targetUserId: string,
  ip?: string,
): Promise<Failure | { ok: true; tasksUnassigned: number }> {
  if (targetUserId === actor.id) return { ok: false, status: 400, error: "You cannot delete your own account." };
  const target = await client.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, status: 404, error: "User not found." };
  if (target.deletedAt) return { ok: false, status: 400, error: "This user has already been deleted." };
  if (target.isSuperAdmin && target.active) {
    if ((await otherActiveAdmins(client, targetUserId)) === 0) {
      return { ok: false, status: 400, error: "The last active Admin cannot be deleted." };
    }
  }

  const now = new Date();
  const [unassigned] = await client.$transaction([
    client.task.updateMany({ where: { assigneeId: targetUserId }, data: { assigneeId: null } }),
    client.projectMember.deleteMany({ where: { userId: targetUserId } }),
    client.session.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now } }),
    client.user.update({
      where: { id: targetUserId },
      data: { deletedAt: now, active: false, isSuperAdmin: false },
    }),
  ]);

  await audit(client, {
    actorId: actor.id, action: "user.delete", entity: "user", entityId: targetUserId,
    meta: { name: target.name, email: target.email, unassignedTasks: unassigned.count }, ip,
  });
  return { ok: true, tasksUnassigned: unassigned.count };
}
