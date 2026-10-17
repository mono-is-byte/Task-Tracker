import { fail, ok, requireMember, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

/**
 * Change request Phase 2: project deletion. Admin/PM only — `manage_members`
 * in this project (superadmins pass automatically). The sidebar only shows the
 * menu to managers, and every delete goes through the shared ConfirmDialog;
 * the API re-checks here regardless. Cascades remove tasks, comments
 * and history (schema onDelete: Cascade).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_members");
  if ("response" in auth) return auth.response;
  const project = await db.project.findUnique({ where: { id }, select: { id: true, key: true, name: true } });
  if (!project) return fail(404, "not_found", "Project not found.");
  await audit(db, {
    actorId: auth.user.id,
    action: "project.delete",
    entity: "project",
    entityId: id,
    meta: JSON.stringify({ key: project.key, name: project.name }),
    ip: clientIp(req),
  });
  publish(id, "project_deleted", { id });
  await db.project.delete({ where: { id } });
  return ok({ deleted: true });
}
