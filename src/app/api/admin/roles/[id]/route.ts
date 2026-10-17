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
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.permissions !== undefined) data.permissions = JSON.stringify(sanitizePerms(parsed.data.permissions));
  if (parsed.data.fieldRules !== undefined) data.fieldRules = JSON.stringify(sanitizeFields(parsed.data.fieldRules));
  let updated;
  try {
    updated = await db.role.update({ where: { id }, data });
  } catch {
    return fail(409, "conflict", "A role with this name already exists.");
  }
  await audit(db, {
    actorId: auth.user.id, action: "role.permission_change", entity: "role", entityId: id,
    meta: { after: parsed.data }, ip: clientIp(req),
  });
  return ok({ role: { id: updated.id, name: updated.name } });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const role = await db.role.findUnique({ where: { id } });
  if (!role) return fail(404, "not_found", "Role not found.");
  if (role.isSystem) return fail(400, "validation", "System roles cannot be deleted. Edit them instead.");
  const members = await db.projectMemberRole.count({ where: { roleId: id } });
  if (members > 0) return fail(400, "validation", `Role still has ${members} member(s). Reassign them first.`);
  // Designations reference roles by id — clear any that point here.
  await db.user.updateMany({ where: { designation: id }, data: { designation: null } });
  await db.role.delete({ where: { id } });
  await audit(db, { actorId: auth.user.id, action: "role.delete", entity: "role", entityId: id, ip: clientIp(req) });
  return ok({ deleted: true });
}
