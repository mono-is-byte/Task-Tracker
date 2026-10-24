import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { GENDERS, profileChanges } from "@/lib/accountRules";
import { db } from "@/lib/db";

const Body = z.object({
  name: z.string().min(1).max(100).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  hoursPerDay: z.number().min(1).max(24).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  /** Change request Phase 2: optional gender from the fixed option list. */
  gender: z.enum(GENDERS).nullable().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid profile fields.");
  const current = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });

  // PHASE 6b — only send fields that are actually DIFFERENT and only audit a
  // real change. An unchanged save (double submit, autosave, an effect loop)
  // previously wrote a `user.profile_update` row with an empty `{}` meta every
  // time, which is what flooded the Audit Log; now it is a silent no-op.
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.theme !== undefined) patch.theme = parsed.data.theme;
  if (parsed.data.hoursPerDay !== undefined) patch.hoursPerDay = parsed.data.hoursPerDay;
  if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl;
  if (parsed.data.gender !== undefined) patch.gender = parsed.data.gender;
  const { data, diff } = profileChanges(current as unknown as Record<string, unknown>, patch);

  // No change → no write and no audit row.
  if (Object.keys(data).length === 0) {
    return ok({
      user: { id: current.id, name: current.name, theme: current.theme, hoursPerDay: current.hoursPerDay, gender: current.gender },
    });
  }

  const user = await db.user.update({ where: { id: auth.user.id }, data });
  await audit(db, {
    actorId: auth.user.id, action: "user.profile_update", entity: "user", entityId: user.id,
    meta: diff, ip: clientIp(req),
  });
  return ok({ user: { id: user.id, name: user.name, theme: user.theme, hoursPerDay: user.hoursPerDay, gender: user.gender } });
}
