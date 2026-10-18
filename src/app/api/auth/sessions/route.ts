import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { listActiveSessions, revokeOtherSessions, revokeSession, sessionLastActiveAt } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const sessions = await listActiveSessions(db, auth.user.id);
  return ok({
    sessions: sessions.map((s) => ({
      id: s.id, current: s.id === auth.sessionId,
      createdAt: s.createdAt, expiresAt: s.expiresAt, idleExpiresAt: s.idleExpiresAt,
      // The last request that used the session (idle deadline − idle TTL, see
      // sessionLastActiveAt) — the profile page's "Last active" value.
      lastActiveAt: sessionLastActiveAt(s),
      rememberMe: s.rememberMe, ip: s.ip, userAgent: s.userAgent,
    })),
  });
}

const Body = z.union([
  z.object({ sessionId: z.string().min(1) }),
  // "Sign out other sessions" — keep the current one, revoke the rest.
  z.object({ others: z.literal(true) }),
]);

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "sessionId required (or { others: true }).");
  if ("others" in parsed.data) {
    const count = await revokeOtherSessions(db, auth.user.id, auth.sessionId, auth.user.id, clientIp(req));
    return ok({ revoked: true, count });
  }
  const revoked = await revokeSession(db, auth.user.id, parsed.data.sessionId, auth.user.id, clientIp(req));
  if (!revoked) return fail(404, "not_found", "Session not found.");
  return ok({ revoked: true });
}
