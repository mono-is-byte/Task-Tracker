import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { listProjectMembers } from "@/lib/members";
import { getMembership } from "@/lib/permissions";

async function canManageMembers(req: Request, projectId: string) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth;
  if (auth.user.isSuperAdmin) return { ...auth, membership: null as never };
  const membership = await getMembership(db, auth.user.id, false, projectId);
  if (!membership || !membership.perms.manage_members) {
    return { response: fail(403, "forbidden", "Requires manage_members permission.") as Response };
  }
  return { ...auth, membership };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await canManageMembers(req, id);
  if ("response" in auth) return auth.response;
  // Members + their live designation (set/updated on the Users page) — the
  // designation is read straight from the user record, never a stored copy.
  return ok(await listProjectMembers(db, id));
}

const AddBody = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1, "Pick at least one role."),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await canManageMembers(req, id);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = AddBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "userId and roleIds are required.");
  // all roleIds must exist
  const roleCount = await db.role.count({ where: { id: { in: parsed.data.roleIds } } });
  if (roleCount !== new Set(parsed.data.roleIds).size) return fail(400, "validation", "Unknown role id.");
  try {
    const m = await db.projectMember.create({
      data: {
        projectId: id,
        userId: parsed.data.userId,
        roles: { create: parsed.data.roleIds.map((roleId) => ({ roleId })) },
      },
    });
    await audit(db, { actorId: auth.user.id, action: "project.member_add", entity: "project", entityId: id, meta: parsed.data, ip: clientIp(req) });
    return ok({ member: { id: m.id } }, 201);
  } catch {
    return fail(409, "conflict", "User is already a member of this project.");
  }
}

const PatchBody = z.object({ roleIds: z.array(z.string().min(1)).min(1, "Pick at least one role.") });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await canManageMembers(req, id);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return fail(400, "validation", "userId query param required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = PatchBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "roleIds required.");
  const unique = [...new Set(parsed.data.roleIds)];
  const roleCount = await db.role.count({ where: { id: { in: unique } } });
  if (roleCount !== unique.length) return fail(400, "validation", "Unknown role id.");
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId } } });
  if (!member) return fail(404, "not_found", "Member not found in this project.");
  await db.$transaction([
    db.projectMemberRole.deleteMany({ where: { memberId: member.id } }),
    db.projectMemberRole.createMany({ data: unique.map((roleId) => ({ memberId: member.id, roleId })) }),
  ]);
  await audit(db, { actorId: auth.user.id, action: "project.member_roles_change", entity: "project", entityId: id, meta: { userId, roleIds: unique }, ip: clientIp(req) });
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await canManageMembers(req, id);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return fail(400, "validation", "userId query param required.");
  await db.projectMember.delete({ where: { projectId_userId: { projectId: id, userId } } });
  await audit(db, { actorId: auth.user.id, action: "project.member_remove", entity: "project", entityId: id, meta: { userId }, ip: clientIp(req) });
  return ok({ removed: true });
}
