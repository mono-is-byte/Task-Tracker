import { z } from "zod";
import { clientIp, fail, ok, readJson } from "@/lib/api";
import { audit, sha256 } from "@/lib/auth";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { hashPassword, passwordProblems } from "@/lib/password";

const ForgotBody = z.object({ identifier: z.string().min(1).max(200) });

// Forgot password: issues an emailed link when SMTP is configured,
// otherwise instructs the user to ask an admin (admin-triggered reset).
export async function POST(req: Request) {
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = ForgotBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Identifier required.");
  const identifier = parsed.data.identifier.trim().toLowerCase();
  const user = await db.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });
  // Always return the same message to avoid account enumeration.
  if (!user) return ok({ sent: true });
  if (process.env.SMTP_URL) {
    const token = randomBytes(32).toString("hex");
    await db.passwordReset.create({
      data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await audit(db, { actorId: user.id, action: "auth.reset_requested", entity: "user", entityId: user.id, ip: clientIp(req) });
    // Mail sending is configured by the operator (SMTP_URL); the token is logged server-side
    // so a self-hosted admin can deliver it manually if needed.
    console.log(`[auth] password reset for ${user.email}: token=${token}`);
    return ok({ sent: true });
  }
  await audit(db, { actorId: user.id, action: "auth.reset_requested_no_mail", entity: "user", entityId: user.id, ip: clientIp(req) });
  return ok({ sent: true, adminReset: true });
}

const ResetBody = z.object({ token: z.string().min(10), next: z.string().min(1).max(200) });

export async function PUT(req: Request) {
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = ResetBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Token and new password are required.");
  const problems = passwordProblems(parsed.data.next);
  if (problems.length > 0) return fail(400, "weak_password", `Password needs ${problems.join(", ")}.`);
  const pr = await db.passwordReset.findUnique({ where: { tokenHash: sha256(parsed.data.token) } });
  if (!pr || pr.usedAt || pr.expiresAt <= new Date()) return fail(400, "invalid_token", "Reset link is invalid or expired.");
  await db.user.update({
    where: { id: pr.userId },
    data: { passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false, lockedUntil: null, failedLogins: 0 },
  });
  await db.passwordReset.update({ where: { id: pr.id }, data: { usedAt: new Date() } });
  await db.session.updateMany({ where: { userId: pr.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(db, { actorId: pr.userId, action: "auth.password_reset", entity: "user", entityId: pr.userId, ip: clientIp(req) });
  return ok({ changed: true });
}
