import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { listActiveSessions, revokeSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const sessions = await listActiveSessions(db, auth.user.id);
  return ok({
    sessions: sessions.map((s) => ({
      id: s.id, current: s.id === auth.sessionId,
      createdAt: s.createdAt, expiresAt: s.expiresAt,
      rememberMe: s.rememberMe, ip: s.ip, userAgent: s.userAgent,
    })),
  });
}

const Body = z.object({ sessionId: z.string().min(1) });

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "sessionId required.");
  const revoked = await revokeSession(db, auth.user.id, parsed.data.sessionId, auth.user.id, clientIp(req));
  if (!revoked) return fail(404, "not_found", "Session not found.");
  return ok({ revoked: true });
}
