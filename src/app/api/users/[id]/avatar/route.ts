import { fail, ok, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { AVATAR_MAX_BYTES, avatarFileName, deleteAvatarFile, saveAvatarFile, validateAvatarUpload } from "@/lib/avatar";
import { canEditTargetUser } from "@/lib/users";

/**
 * Change request Phase 4: avatar upload (.jpg/.jpeg only, <= 2 MB, validated by
 * extension + MIME + JPEG magic bytes; stored with a generated filename under
 * public/uploads/avatars). Users upload their own; Admins/PMs (for users of a
 * project they manage) may upload for others. A DELETE clears the avatar.
 */

async function resolveTarget(req: Request, targetId: string) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth;
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target || target.deletedAt) {
    return { response: fail(404, "not_found", "User not found.") as Response };
  }
  const self = auth.user.id === targetId;
  const allowed = self || auth.user.isSuperAdmin ||
    (await canEditTargetUser(db, { id: auth.user.id, isSuperAdmin: auth.user.isSuperAdmin }, targetId));
  if (!allowed) {
    return { response: fail(403, "forbidden", "You cannot change this user's avatar.") as Response };
  }
  return { ...auth, target };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveTarget(req, id);
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "validation", "Avatar must be sent as multipart form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "validation", "No avatar file was uploaded.");
  if (file.size > AVATAR_MAX_BYTES) return fail(400, "validation", "Avatar must be 2 MB or smaller.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const invalid = validateAvatarUpload({
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    buffer,
  });
  if (invalid) return fail(400, "validation", invalid);

  await deleteAvatarFile(process.cwd(), auth.target.avatarUrl);
  const url = await saveAvatarFile(process.cwd(), avatarFileName(), buffer);
  await db.user.update({ where: { id }, data: { avatarUrl: url } });
  await audit(db, {
    actorId: auth.user.id, action: "user.avatar_set", entity: "user", entityId: id,
    meta: { fileName: file.name, size: file.size }, ip: clientIp(req),
  });
  return ok({ avatarUrl: url });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveTarget(req, id);
  if ("response" in auth) return auth.response;
  await deleteAvatarFile(process.cwd(), auth.target.avatarUrl);
  await db.user.update({ where: { id }, data: { avatarUrl: null } });
  await audit(db, {
    actorId: auth.user.id, action: "user.avatar_clear", entity: "user", entityId: id, ip: clientIp(req),
  });
  return ok({ avatarUrl: null });
}
