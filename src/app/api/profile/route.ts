import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";

const Body = z.object({
  name: z.string().min(1).max(100).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  hoursPerDay: z.number().min(1).max(24).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  notifyPrefs: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid profile fields.");
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.theme !== undefined) data.theme = parsed.data.theme;
  if (parsed.data.hoursPerDay !== undefined) data.hoursPerDay = parsed.data.hoursPerDay;
  if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl;
  if (parsed.data.notifyPrefs !== undefined) data.notifyPrefs = JSON.stringify(parsed.data.notifyPrefs);
  const user = await db.user.update({ where: { id: auth.user.id }, data });
  await audit(db, { actorId: auth.user.id, action: "user.profile_update", entity: "user", entityId: user.id, ip: clientIp(req) });
  return ok({ user: { id: user.id, name: user.name, theme: user.theme, hoursPerDay: user.hoursPerDay } });
}
