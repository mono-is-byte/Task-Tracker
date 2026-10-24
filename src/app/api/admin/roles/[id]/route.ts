import { z } from "zod";
import { fail, ok, readJson, requireAdmin, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { sanitizeFields, sanitizePerms } from "@/lib/roles";

const UpdateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  fieldRules: z.record(z.string(), z.enum(["hidden", "readonly", "editable"])).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = UpdateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid role fields.");
  const role = await db.role.findUnique({ where: { id } });
  if (!role) return fail(404, "not_found", "Role not found.");
  const safeJson = (raw: string): unknown => {
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  };
  const next = {
    name: parsed.data.name !== undefined ? parsed.data.name.trim() : role.name,
    description: parsed.data.description !== undefined ? parsed.data.description : role.description,
    permissions: parsed.data.permissions !== undefined ? JSON.stringify(sanitizePerms(parsed.data.permissions)) : role.permissions,
    fieldRules: parsed.data.fieldRules !== undefined ? JSON.stringify(sanitizeFields(parsed.data.fieldRules)) : role.fieldRules,
  };
  const diff: Record<string, [unknown, unknown]> = {};
  if (next.name !== role.name) diff.name = [role.name, next.name];
  if (next.description !== role.description) diff.description = [role.description, next.description];
  if (next.permissions !== role.permissions) diff.permissions = [safeJson(role.permissions), safeJson(next.permissions)];
  if (next.fieldRules !== role.fieldRules) diff.fieldRules = [safeJson(role.fieldRules), safeJson(next.fieldRules)];
  if (Object.keys(diff).length === 0) {
    return ok({ role: { id: role.id, name: role.name } });
  }
  const data: Record<string, unknown> = {};
  if (diff.name) data.name = next.name;
  if ("description" in diff) data.description = next.description;
  if (diff.permissions) data.permissions = next.permissions;
  if (diff.fieldRules) data.fieldRules = next.fieldRules;
  let updated;
  try {
    updated = await db.role.update({ where: { id }, data });
  } catch {
    return fail(409, "conflict", "A role with this name already exists.");
  }
  await audit(db, {
    actorId: auth.user.id, action: "role.permission_change", entity: "role", entityId: id,
    meta: diff, ip: clientIp(req),
  });
  return ok({ role: { id: updated.id, name: updated.name } });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const role = await db.role.findUnique({ where: { id } });
  if (!role) return fail(404, "not_found", "Role not found.");

  let perms: Record<string, boolean> = {};
  try { perms = JSON.parse(role.permissions) as Record<string, boolean>; } catch { /* */ }
  if (perms.bypass_transitions === true || perms.manage_workflow === true) {
    return fail(400, "validation", "Project Manager / bypass roles cannot be deleted.");
  }

  const usersCount = await db.user.count({ where: { designation: id, deletedAt: null } });
  const membershipsCount = await db.projectMemberRole.count({ where: { roleId: id } });
  const designationTagsCount = await db.statusDesignationTag.count({ where: { roleId: id } });
  const allTransitions = await db.statusTransition.findMany();
  const transitionsCount = allTransitions.filter((t) => {
    try { return (JSON.parse(t.roleIds) as string[]).includes(id); } catch { return false; }
  }).length;

  // Only a direct user designation blocks deletion. Memberships, designation
  // tags and transitions are cascade-cleared / stale-id tolerant.
  if (usersCount > 0) {
    return fail(400, "in_use", `Role is assigned to ${usersCount} user(s). Remove the designation first.`, {
      counts: { users: usersCount, memberships: membershipsCount, designationTags: designationTagsCount, transitions: transitionsCount },
    });
  }

  // Drop the role from any transition's role list (never widen access).
  for (const t of allTransitions) {
    let ids: string[] = [];
    try { ids = JSON.parse(t.roleIds) as string[]; } catch { ids = []; }
    if (!ids.includes(id)) continue;
    const next = ids.filter((r) => r !== id);
    if (next.length === 0 && ids.length > 0) {
      await db.statusTransition.delete({ where: { id: t.id } });
    } else {
      await db.statusTransition.update({ where: { id: t.id }, data: { roleIds: JSON.stringify(next) } });
    }
  }
  await db.role.delete({ where: { id } });
  await audit(db, {
    actorId: auth.user.id, action: "role.delete", entity: "role", entityId: id,
    meta: { name: role.name, counts: { users: usersCount, memberships: membershipsCount, designationTags: designationTagsCount, transitions: transitionsCount } },
    ip: clientIp(req),
  });
  return ok({ deleted: true });
}
