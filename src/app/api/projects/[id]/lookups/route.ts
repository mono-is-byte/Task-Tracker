import { fail, ok, requireMember } from "@/lib/api";
import { loadProject } from "@/lib/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const { membership, ...rest } = loaded;
  return ok({ ...rest, membership: { roleIds: membership.roleIds, roleNames: membership.roleNames, roleName: membership.roleName, perms: membership.perms, fieldRules: membership.fieldRules, isSuperAdmin: membership.isSuperAdmin } });
}
