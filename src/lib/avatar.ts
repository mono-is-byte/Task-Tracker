import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

/**
 * Change request Phase 4: avatar uploads.
 * Only .jpg/.jpeg files are accepted, and the upload is validated on three
 * independent levels — file extension, declared MIME type, and the actual
 * JPEG magic bytes (FF D8 FF) — with a hard 2 MB limit. Files are stored
 * under public/uploads/avatars with a generated name; the original filename
 * is never trusted or reused.
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_URL_PREFIX = "/uploads/avatars/";

/** JPEG files start with the SOI marker FF D8 FF. */
export function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export interface AvatarUpload {
  fileName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

/** Returns an error message, or null when the upload is a valid avatar image. */
export function validateAvatarUpload(input: AvatarUpload): string | null {
  const ext = path.extname(input.fileName ?? "").toLowerCase();
  if (ext !== ".jpg" && ext !== ".jpeg") return "Avatar must be a .jpg or .jpeg file.";
  if (input.mimeType !== "image/jpeg") return "Avatar must be a JPEG image.";
  if (input.size > AVATAR_MAX_BYTES) return "Avatar must be 2 MB or smaller.";
  if (!isJpegBuffer(input.buffer)) return "The file is not a valid JPEG image.";
  return null;
}

/** Generated, filesystem-safe avatar filename (never derived from user input). */
export function avatarFileName(): string {
  return `av-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.jpg`;
}

/**
 * Public URL of the database-backed avatar (serverless hosts): the picture is
 * served from GET /api/users/<id>/avatar. The ?v= stamp changes on every upload
 * so browsers fetch the new image instead of a cached one.
 */
export function avatarApiUrl(userId: string): string {
  return `/api/users/${userId}/avatar?v=${Date.now()}`;
}

/** Writes the avatar under <root>/public/uploads/avatars and returns its public URL. */
export async function saveAvatarFile(rootDir: string, fileName: string, buffer: Buffer): Promise<string> {
  const dir = avatarDir(rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buffer);
  return `${AVATAR_URL_PREFIX}${fileName}`;
}

/** Deletes a previously stored avatar file; ignores anything not under our upload dir. */
export async function deleteAvatarFile(rootDir: string, url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith(AVATAR_URL_PREFIX)) return;
  const name = path.basename(url);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return;
  await unlink(path.join(avatarDir(rootDir), name)).catch(() => {});
}

function avatarDir(rootDir: string): string {
  return path.join(rootDir, "public", "uploads", "avatars");
}
