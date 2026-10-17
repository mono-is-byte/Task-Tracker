import { ok, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const memberships = await db.projectMember.findMany({
    where: { userId: auth.user.id },
    include: {
      project: { select: { id: true, key: true, name: true } },
      roles: { include: { role: { select: { id: true, name: true } } }, orderBy: { role: { name: "asc" } } },
    },
  });
  const u = auth.user;
  return ok({
    user: {
      id: u.id, email: u.email, username: u.username, name: u.name,
      isSuperAdmin: u.isSuperAdmin, mustChangePassword: u.mustChangePassword,
      theme: u.theme, avatarUrl: u.avatarUrl, hoursPerDay: u.hoursPerDay,
    },
    memberships: memberships.map((m) => ({
      projectId: m.projectId, projectKey: m.project.key, projectName: m.project.name,
      roleIds: m.roles.map((l) => l.roleId), roleNames: m.roles.map((l) => l.role.name),
    })),
    isSuperAdmin: u.isSuperAdmin,
  });
}
