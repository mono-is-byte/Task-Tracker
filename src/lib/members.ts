import type { PrismaClient } from "@prisma/client";

export interface ProjectMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  username: string;
  active: boolean;
  /** Uploaded picture, shown in the members list (same avatar as Users). */
  avatarUrl: string | null;
  /**
   * The user's designation: the NAME of the role their `User.designation`
   * points at, resolved live (renames show up here immediately). Null when the
   * user has no designation or their designated role was deleted.
   */
  designation: string | null;
  roleIds: string[];
  roleNames: string[];
}

/**
 * Members list for the project Members page: each member with their project
 * roles plus their current designation (displayed as an extra role chip).
 */
export async function listProjectMembers(client: PrismaClient, projectId: string) {
  const [members, roles] = await Promise.all([
    client.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, username: true, active: true, designation: true, avatarUrl: true } },
        roles: { include: { role: true }, orderBy: { role: { name: "asc" } } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    client.role.findMany({ select: { id: true, name: true } }),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      username: m.user.username,
      active: m.user.active,
      avatarUrl: m.user.avatarUrl,
      designation: m.user.designation ? roleName.get(m.user.designation) ?? null : null,
      roleIds: m.roles.map((l) => l.roleId),
      roleNames: m.roles.map((l) => l.role.name),
    })),
  };
}
