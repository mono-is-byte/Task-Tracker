import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { adminResetPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { softDeleteUser, updateManagedUser } from "@/lib/users";

/** edit (Admin anywhere; PM for users of a managed project — name and
 *  designation (a role reference) only) and soft-delete (Admin only). */

const PatchBody = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  active: z.boolean().optional(),
  isSuperAdmin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  /** Designation = a Role id; "" / null clears it. Validated in updateManagedUser. */
  designation: z.string().max(60).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = PatchBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid fields.");
  const result = await updateManagedUser(
    db,
    { id: auth.user.id, isSuperAdmin: auth.user.isSuperAdmin },
    id,
    parsed.data,
    clientIp(req),
  );
  if (!result.ok) return fail(result.status, "rejected", result.error);
  return ok({ user: result.user });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  if (!auth.user.isSuperAdmin) return fail(403, "forbidden", "Super Admin only.");
  const { id } = await params;
  const result = await softDeleteUser(db, { id: auth.user.id, isSuperAdmin: true }, id, clientIp(req));
  if (!result.ok) return fail(result.status, "rejected", result.error);
  return ok({ deleted: true, tasksUnassigned: result.tasksUnassigned });
}

/** Admin-triggered password reset: temp password + forced change on next login. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  if (!auth.user.isSuperAdmin) return fail(403, "forbidden", "Super Admin only.");
  const { id } = await params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.deletedAt) return fail(404, "not_found", "User not found.");
  const tempPassword = await adminResetPassword(db, auth.user.id, id, clientIp(req));
  return ok({ tempPassword });
}
