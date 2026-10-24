import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { changeUsername } from "@/lib/auth";
import { USERNAME_MAX, USERNAME_MIN } from "@/lib/accountRules";
import { db } from "@/lib/db";

/**
 * Change request Phase 2: self-service USERNAME change.
 *
 * POST (not PATCH /api/profile), exactly like the email change: it is the only
 * other profile write that requires reauthentication (the current password), so
 * it gets its own audited endpoint. The username is the second accepted login
 * identifier, so it is stored lower-cased and checked case-insensitively —
 * including against soft-deleted accounts and against other users' emails.
 */
const Body = z.object({
  username: z.string().min(USERNAME_MIN).max(USERNAME_MAX),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) {
    return fail(400, "validation", "Enter a valid username and your current password.");
  }
  const result = await changeUsername(db, auth.user.id, parsed.data, clientIp(req));
  if (!result.ok) {
    const status =
      result.code === "conflict" ? 409
      : result.code === "reauth" ? 403
      : result.code === "rate_limit" ? 429
      : 400;
    return fail(status, result.code, result.error);
  }
  return ok({ user: { id: result.user.id, username: result.user.username } });
}
