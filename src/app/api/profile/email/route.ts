import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { changeEmail } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Self-service email change. POST (not PATCH /api/profile) on purpose: this is
 * the only profile write that requires reauthentication (the current
 * password), so it deserves its own audited endpoint. The email is saved on
 * the SAME user row — no new account is ever created.
 */
const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) {
    return fail(400, "validation", "Enter a valid email address and your current password.");
  }
  const result = await changeEmail(db, auth.user.id, parsed.data, clientIp(req));
  if (!result.ok) {
    const status = result.code === "conflict" ? 409 : result.code === "reauth" ? 403 : 400;
    return fail(status, result.code, result.error);
  }
  return ok({ user: { id: result.user.id, email: result.user.email } });
}
