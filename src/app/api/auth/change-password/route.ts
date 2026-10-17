import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { changePassword } from "@/lib/auth";
import { db } from "@/lib/db";

const Body = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Current and new password are required.");
  const result = await changePassword(db, auth.user.id, parsed.data.current, parsed.data.next, clientIp(req));
  if (!result.ok) return fail(400, "weak_password", result.error);
  return ok({ changed: true });
}
