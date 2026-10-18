import type { PrismaClient } from "@prisma/client";

/**
 * The app-wide assignable-user directory — "wherever users are picked".
 *
 * Every VALID user (i.e. every account that is not soft-deleted) is returned
 * exactly once, keyed by `userId`: the Users section is the source of truth, so
 * a registered user is never hidden just because they are not a member of the
 * project being viewed. Deleted accounts are the only exclusion — they cannot
 * log in, are unassigned from tasks and keep their history only as text.
 *
 * `isMember` marks the project's own members; for those, `roleIds`/`roleNames`
 * carry their project roles (empty arrays for everybody else). `active` is
 * false for deactivated accounts: they stay selectable (existing work keeps its
 * owner) and pickers label them "(inactive)".
 */
export interface DirectoryUser {
  userId: string;
  name: string;
  username: string;
  /** Live name of the role the user's designation points at (null = none). */
  designationName: string | null;
  avatarUrl: string | null;
  active: boolean;
  isMember: boolean;
  roleIds: string[];
  roleNames: string[];
  roleName: string;
  hoursPerDay: number | null;
}

export async function listAssignableUsers(client: PrismaClient, projectId: string): Promise<DirectoryUser[]> {
  const [users, projectMembers, roles] = await Promise.all([
    client.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, username: true, designation: true, avatarUrl: true, active: true, hoursPerDay: true },
      orderBy: { name: "asc" },
    }),
    client.projectMember.findMany({
      where: { projectId },
      include: { roles: { include: { role: true }, orderBy: { role: { name: "asc" } } } },
    }),
    client.role.findMany({ select: { id: true, name: true } }),
  ]);

  // Designation = role id → live role name (renames are picked up automatically).
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const memberByUser = new Map(projectMembers.map((m) => [m.userId, m]));

  return users.map((u) => {
    const pm = memberByUser.get(u.id);
    const names = pm ? pm.roles.map((l) => l.role.name) : [];
    return {
      userId: u.id,
      name: u.name,
      username: u.username,
      designationName: u.designation ? roleName.get(u.designation) ?? null : null,
      avatarUrl: u.avatarUrl,
      active: u.active,
      isMember: Boolean(pm),
      roleIds: pm ? pm.roles.map((l) => l.roleId) : [],
      roleNames: names,
      roleName: names.join(", "),
      hoursPerDay: u.hoursPerDay,
    };
  });
}
