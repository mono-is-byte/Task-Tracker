import { z } from "zod";
import { fail, ok, readJson, requireAdmin, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACTIONS, TASK_FIELDS } from "@/lib/permissions";
import { sanitizeFields, sanitizePerms } from "@/lib/roles";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const roles = await db.role.findMany({ orderBy: { name: "asc" } });
  const memberCounts = await db.projectMemberRole.groupBy({ by: ["roleId"], _count: { roleId: true } });
  const counts = Object.fromEntries(memberCounts.map((m) => [m.roleId, m._count.roleId]));
  return ok({
    actions: ACTIONS,
    fields: [...TASK_FIELDS, "custom:*"],
    roles: roles.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      permissions: JSON.parse(r.permissions), fieldRules: JSON.parse(r.fieldRules),
      isSystem: r.isSystem, members: counts[r.id] ?? 0,
    })),
  });
}

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  fieldRules: z.record(z.string(), z.enum(["hidden", "readonly", "editable"])).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Role name is required.");
  try {
    const role = await db.role.create({
      data: {
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? null,
        permissions: JSON.stringify(sanitizePerms(parsed.data.permissions ?? {})),
        fieldRules: JSON.stringify(sanitizeFields(parsed.data.fieldRules ?? {})),
      },
    });
    await audit(db, { actorId: auth.user.id, action: "role.create", entity: "role", entityId: role.id, ip: clientIp(req) });
    return ok({ role: { id: role.id, name: role.name } }, 201);
  } catch {
    return fail(409, "conflict", "Role name already exists.");
  }
}
