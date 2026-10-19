import { fail, ok, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db, usesRemoteSqlite } from "@/lib/db";
import { AVATAR_MAX_BYTES, avatarApiUrl, avatarFileName, deleteAvatarFile, saveAvatarFile, validateAvatarUpload } from "@/lib/avatar";
import { canEditTargetUser } from "@/lib/users";

/**
 * Change request Phase 4: avatar upload (.jpg/.jpeg only, <= 2 MB, validated by
 * extension + MIME + JPEG magic bytes). Users upload their own; Admins/PMs (for
 * users of a project they manage) may upload for others. A DELETE clears the
 * avatar.
 *
 * Storage follows the environment: local/self-hosted runs write a file under
 * public/uploads/avatars (served statically), while serverless hosts with a
 * read-only filesystem (e.g. Vercel) keep the JPEG in the UserAvatar table and
 * serve it from GET /api/users/<id>/avatar.
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

  let url: string;
  if (usesRemoteSqlite) {
    // Serverless: the filesystem is read-only, so the bytes go into the database.
    await db.userAvatar.upsert({
      where: { userId: id },
      create: { userId: id, mimeType: "image/jpeg", bytes: buffer },
      update: { mimeType: "image/jpeg", bytes: buffer },
    });
    url = avatarApiUrl(id);
  } else {
    await deleteAvatarFile(process.cwd(), auth.target.avatarUrl);
    url = await saveAvatarFile(process.cwd(), avatarFileName(), buffer);
  }
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
  if (usesRemoteSqlite) {
    await db.userAvatar.deleteMany({ where: { userId: id } });
  } else {
    await deleteAvatarFile(process.cwd(), auth.target.avatarUrl);
  }
  await db.user.update({ where: { id }, data: { avatarUrl: null } });
  await audit(db, {
    actorId: auth.user.id, action: "user.avatar_clear", entity: "user", entityId: id, ip: clientIp(req),
  });
  return ok({ avatarUrl: null });
}

/** Serves the database-backed avatar (serverless storage). Unknown → 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const avatar = await db.userAvatar.findUnique({
    where: { userId: id },
    select: { mimeType: true, bytes: true },
  });
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.mimeType,
      // The stored URL carries a ?v= stamp that changes on every upload.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
