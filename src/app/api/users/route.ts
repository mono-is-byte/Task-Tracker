import { z } from "zod";
import { fail, ok, readJson, requireAdmin, requireUser, clientIp } from "@/lib/api";
import { audit, createUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mergeRoles } from "@/lib/permissions";
import { canUseUsersPage, resolveDesignationRole } from "@/lib/users";

/**
 * The dedicated Users page feed.
 * Admin (superadmin) — and PM-level users (`manage_members` in >= 1 project) —
 * may open the page. Only an Admin creates accounts (temp password, forced
 * change on first login). The designation is a REFERENCE to a role (the payload
 * carries the role list for the dropdown, plus each row's `designationName`
 * resolved live so renames show up everywhere) and the payload carries
 * `canEdit` per row so the page only offers editing where the server would
 * accept the PATCH (Admin anywhere, PM for members of a managed project).
 * Project membership management lives in the project settings; per-user project
 * lists come from GET /api/users/:id/projects.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  if (!(await canUseUsersPage(db, { id: auth.user.id, isSuperAdmin: auth.user.isSuperAdmin }))) {
    return fail(403, "forbidden", "Only Admins and Project Managers can open the Users page.");
  }

  // Projects this viewer manages (superadmin: every project).
  const memberships = auth.user.isSuperAdmin
    ? []
    : await db.projectMember.findMany({
        where: { userId: auth.user.id },
        include: { roles: { include: { role: true } } },
      });
  const managedProjectIds = memberships
    .filter((m) => mergeRoles(m.roles.map((l) => l.role)).perms.manage_members === true)
    .map((m) => m.projectId);

  // null = everyone (Admin); otherwise the ids the PM may edit.
  let editableUserIds: Set<string> | null = null;
  if (!auth.user.isSuperAdmin) {
    const rows = await db.projectMember.findMany({
      where: { projectId: { in: managedProjectIds } },
      select: { userId: true },
    });
    editableUserIds = new Set(rows.map((r) => r.userId));
  }

  const users = await db.user.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  // Designations are role references — resolve live names + expose the role
  // list that powers the designation dropdown on the Users page.
  const roles = await db.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return ok({
    viewer: { isSuperAdmin: auth.user.isSuperAdmin },
    roles,
    users: users.map((u) => ({
      id: u.id, email: u.email, username: u.username, name: u.name,
      active: u.active, isSuperAdmin: u.isSuperAdmin, mustChangePassword: u.mustChangePassword,
      lockedUntil: u.lockedUntil, lastActiveAt: u.lastActiveAt, createdAt: u.createdAt,
      avatarUrl: u.avatarUrl,
      /** Role id ("" when the role was deleted / never set). */
      designation: u.designation && roleName.has(u.designation) ? u.designation : null,
      /** Live role name for display (follows renames automatically). */
      designationName: u.designation ? roleName.get(u.designation) ?? null : null,
      canEdit: editableUserIds === null ? true : editableUserIds.has(u.id),
    })),
  });
}

const CreateBody = z.object({
  email: z.string().email().max(200),
  username: z.string().min(2).max(50),
  name: z.string().min(1).max(100),
  isSuperAdmin: z.boolean().optional(),
  /** Designation = the id of a role from Roles & Permissions (validated below). */
  designation: z.string().max(60).nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Valid email, username and name are required.");
  // Designation must reference an existing role ("" clears it).
  const designation = await resolveDesignationRole(db, parsed.data.designation ?? null);
  if (designation && typeof designation === "object") return fail(designation.status, "validation", designation.error);
  try {
    const { user, tempPassword } = await createUser(
      db, auth.user.id, { ...parsed.data, designation }, clientIp(req),
    );
    return ok({ user: { id: user.id, email: user.email }, tempPassword }, 201);
  } catch {
    return fail(409, "conflict", "Email or username already exists.");
  }
}
