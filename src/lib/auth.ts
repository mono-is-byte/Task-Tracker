import { createHash, randomBytes } from "crypto";
import type { PrismaClient, User } from "@prisma/client";
import { db } from "./db";
import { generateTempPassword, hashPassword, passwordProblems, verifyPassword } from "./password";

export const COOKIE_NAME = "tt_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
export const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MIN = 15;
export const LOCKOUT_MINUTES = 15;

export type Db = PrismaClient;

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function audit(
  client: Db,
  opts: {
    actorId?: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    meta?: unknown;
    ip?: string;
  },
) {
  await client.auditLog.create({
    data: {
      actorId: opts.actorId ?? null,
      action: opts.action,
      entity: opts.entity ?? null,
      entityId: opts.entityId ?? null,
      meta: JSON.stringify(opts.meta ?? {}),
      ip: opts.ip ?? null,
    },
  });
}

export function sessionCookieHeader(token: string, opts: { rememberMe: boolean; secure: boolean }): string {
  const maxAge = Math.floor((opts.rememberMe ? REMEMBER_TTL_MS : SESSION_TTL_MS) / 1000);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(
  client: Db,
  userId: string,
  opts: { rememberMe?: boolean; ip?: string; userAgent?: string } = {},
) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const ttl = opts.rememberMe ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const session = await client.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(now.getTime() + ttl),
      idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS),
      rememberMe: opts.rememberMe ?? false,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    },
  });
  await client.user.update({
    where: { id: userId },
    data: { lastActiveAt: now },
  });
  return { token, session };
}

export interface SessionUser {
  sessionId: string;
  user: User;
}

/** Validate a raw session token. Returns null when missing/expired/revoked/deactivated. */
export async function getSessionUser(client: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await client.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || !session.user.active) return null;
  const now = new Date();
  if (session.expiresAt <= now || session.idleExpiresAt <= now) {
    if (!session.revokedAt) {
      await client.session.update({ where: { id: session.id }, data: { revokedAt: now } }).catch(() => {});
    }
    return null;
  }
  // refresh idle window + activity (cheap write, throttled by only touching when < 90 min left is overkill; keep simple)
  await client.session
    .update({ where: { id: session.id }, data: { idleExpiresAt: new Date(now.getTime() + IDLE_TTL_MS) } })
    .catch(() => {});
  return { sessionId: session.id, user: session.user };
}

async function recentFailures(client: Db, identifier: string, ip?: string): Promise<number> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60 * 1000);
  return client.loginAttempt.count({
    where: {
      identifier,
      success: false,
      createdAt: { gte: since },
      ...(ip ? { ip } : {}),
    },
  });
}

export interface LoginInput {
  identifier: string;
  password: string;
  rememberMe?: boolean;
  ip?: string;
  userAgent?: string;
}

export async function login(client: Db, input: LoginInput) {
  const identifier = input.identifier.trim().toLowerCase();
  const fail = async (error: string, extra?: { code?: string }): Promise<{ ok: false; error: string; code?: string }> => {
    await client.loginAttempt.create({ data: { identifier, ip: input.ip ?? null, success: false } });
    return { ok: false as const, error, ...extra };
  };

  const user = await client.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });
  if (!user) {
    return fail("Invalid email/username or password.", { code: "invalid_credentials" });
  }
  if (!user.active) return fail("Account is deactivated. Contact an administrator.", { code: "deactivated" });
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return fail(`Account locked after repeated failures. Try again in ~${mins} min.`, { code: "locked" });
  }
  const failures = await recentFailures(client, identifier, input.ip);
  if (failures >= LOCKOUT_THRESHOLD) {
    await client.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000), failedLogins: 0 },
    });
    await audit(client, { actorId: user.id, action: "auth.lockout", entity: "user", entityId: user.id, ip: input.ip });
    return fail("Too many failed attempts. Account locked for 15 minutes.", { code: "locked" });
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    await client.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
    await audit(client, { actorId: user.id, action: "auth.login_failed", entity: "user", entityId: user.id, ip: input.ip });
    return fail("Invalid email/username or password.");
  }

  await client.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await client.loginAttempt.create({ data: { identifier, ip: input.ip ?? null, success: true } });
  const { token } = await createSession(client, user.id, {
    rememberMe: input.rememberMe,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await audit(client, { actorId: user.id, action: "auth.login", entity: "user", entityId: user.id, ip: input.ip });
  const fresh = (await client.user.findUnique({ where: { id: user.id } }))!;
  return { ok: true as const, token, user: fresh };
}

export async function logout(client: Db, token: string | undefined | null, actorId?: string, ip?: string) {
  if (!token) return;
  const s = await client.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (s && !s.revokedAt) {
    await client.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    await audit(client, { actorId: actorId ?? s.userId, action: "auth.logout", entity: "session", entityId: s.id, ip });
  }
}

export async function listActiveSessions(client: Db, userId: string) {
  return client.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeSession(client: Db, userId: string, sessionId: string, actorId?: string, ip?: string) {
  const s = await client.session.findFirst({ where: { id: sessionId, userId } });
  if (!s) return false;
  await client.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  await audit(client, { actorId: actorId ?? userId, action: "auth.session_revoke", entity: "session", entityId: s.id, ip });
  return true;
}

export async function changePassword(client: Db, userId: string, current: string, next: string, ip?: string) {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, error: "User not found." };
  const valid = await verifyPassword(current, user.passwordHash);
  if (!valid) return { ok: false as const, error: "Current password is incorrect." };
  const problems = passwordProblems(next);
  if (problems.length > 0) return { ok: false as const, error: `Password needs ${problems.join(", ")}.` };
  await client.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
  await audit(client, { actorId: userId, action: "auth.password_change", entity: "user", entityId: userId, ip });
  return { ok: true as const };
}

/** Admin-triggered reset: sets a temp password, forces change on next login. Returns the temp password. */
export async function adminResetPassword(client: Db, adminId: string, userId: string, ip?: string) {
  const temp = generateTempPassword();
  const target = await client.user.findUniqueOrThrow({ where: { id: userId } });
  await client.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(temp), mustChangePassword: true, lockedUntil: null, failedLogins: 0 },
  });
  // fresh slate: clear recent failure history so the lockout window does not re-trigger
  await client.loginAttempt.deleteMany({
    where: { identifier: { in: [target.email.toLowerCase(), target.username.toLowerCase()] } },
  });
  await client.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(client, { actorId: adminId, action: "auth.password_reset", entity: "user", entityId: userId, ip });
  return temp;
}

export async function createUser(
  client: Db,
  adminId: string,
  input: {
    email: string; username: string; name: string; isSuperAdmin?: boolean; locale?: string;
    /** Designation = a Role id (the route validates it exists before calling). */
    designation?: string | null;
  },
  ip?: string,
) {
  const temp = generateTempPassword();
  const designation = input.designation?.trim() || null;
  const user = await client.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      username: input.username.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(temp),
      mustChangePassword: true,
      isSuperAdmin: input.isSuperAdmin ?? false,
      locale: input.locale ?? "en",
      designation,
    },
  });
  await audit(client, { actorId: adminId, action: "user.create", entity: "user", entityId: user.id, ip });
  return { user, tempPassword: temp };
}

export { db };
