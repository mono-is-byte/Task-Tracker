import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import {
  IDLE_TTL_MS,
  adminResetPassword,
  changeEmail,
  changePassword,
  createSession,
  getSessionUser,
  listActiveSessions,
  login,
  logout,
  revokeOtherSessions,
  revokeSession,
  sessionLastActiveAt,
} from "../src/lib/auth";
import { hashPassword } from "../src/lib/password";

const TEST_URL = "file:./tests/test-auth.db";

const db = makeTestClient(TEST_URL);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

beforeAll(async () => {
  await db.$connect();
});

describe("password hashing", () => {
  it("verifies correct password and rejects wrong one", async () => {
    const h = await hashPassword("Demo1234!");
    const { verifyPassword } = await import("../src/lib/password");
    expect(await verifyPassword("Demo1234!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("login / logout / lockout / sessions", () => {
  it("logs in with email or username and creates a session", async () => {
    const email = uniq("user") + "@t.local";
    const u = await db.user.create({
      data: { email, username: uniq("u"), name: "T", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const byEmail = await login(db, { identifier: email, password: "Demo1234!" });
    expect(byEmail.ok).toBe(true);
    if (byEmail.ok) {
      const su = await getSessionUser(db, byEmail.token);
      expect(su?.user.id).toBe(u.id);
      await logout(db, byEmail.token);
      expect(await getSessionUser(db, byEmail.token)).toBeNull();
    }
    const byName = await login(db, { identifier: u.username, password: "Demo1234!" });
    expect(byName.ok).toBe(true);
  });

  it("rejects bad passwords and deactivated accounts", async () => {
    const email = uniq("user") + "@t.local";
    await db.user.create({
      data: { email, username: uniq("u"), name: "T", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false, active: false },
    });
    const r = await login(db, { identifier: email, password: "Demo1234!" });
    expect(r.ok).toBe(false);
  });

  it("locks out after repeated failures and unlocks via admin reset", async () => {
    const email = uniq("lock") + "@t.local";
    const u = await db.user.create({
      data: { email, username: uniq("u"), name: "L", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    for (let i = 0; i < 5; i++) {
      await login(db, { identifier: email, password: "nope-nope-nope", ip: "10.0.0.9" });
    }
    const locked = await login(db, { identifier: email, password: "Demo1234!", ip: "10.0.0.9" });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.code).toBe("locked");

    const temp = await adminResetPassword(db, u.id, u.id);
    expect(temp.length).toBeGreaterThanOrEqual(8);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(after.lockedUntil).toBeNull();
    const okLogin = await login(db, { identifier: email, password: temp });
    expect(okLogin.ok).toBe(true);
    if (okLogin.ok) expect(okLogin.user.mustChangePassword).toBe(true);
  });

  it("expires sessions absolutely and on idle timeout", async () => {
    const u = await db.user.create({
      data: { email: uniq("s") + "@t.local", username: uniq("u"), name: "S", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const { token } = await createSession(db, u.id, {});
    expect((await getSessionUser(db, token))?.user.id).toBe(u.id);
    // force idle expiry
    await db.session.updateMany({ where: { userId: u.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect(await getSessionUser(db, token)).toBeNull();
    // force absolute expiry
    const s2 = await createSession(db, u.id, {});
    await db.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000), idleExpiresAt: new Date(Date.now() + 60000) } });
    expect(await getSessionUser(db, s2.token)).toBeNull();
  });

  it("lists and revokes sessions", async () => {
    const u = await db.user.create({
      data: { email: uniq("r") + "@t.local", username: uniq("u"), name: "R", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const { listActiveSessions } = await import("../src/lib/auth");
    await createSession(db, u.id, {});
    await createSession(db, u.id, {});
    const all = await listActiveSessions(db, u.id);
    expect(all.length).toBe(2);
    expect(await revokeSession(db, u.id, all[0].id)).toBe(true);
    expect((await listActiveSessions(db, u.id)).length).toBe(1);
    expect(await revokeSession(db, u.id, "missing")).toBe(false);
  });

  it("changes password with current-password check and strength rules", async () => {
    const u = await db.user.create({
      data: { email: uniq("c") + "@t.local", username: uniq("u"), name: "C", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: true },
    });
    expect((await changePassword(db, u.id, "wrong", "Newpass1!")).ok).toBe(false);
    expect((await changePassword(db, u.id, "Demo1234!", "weak")).ok).toBe(false);
    const ok = await changePassword(db, u.id, "Demo1234!", "Newpass1!");
    expect(ok.ok).toBe(true);
    expect((await login(db, { identifier: u.username, password: "Newpass1!" })).ok).toBe(true);
  });
});

describe("self-service email change", () => {
  it("reauthenticates, blocks duplicates and keeps the same account", async () => {
    const u = await db.user.create({
      data: { email: uniq("mail") + "@t.local", username: uniq("u"), name: "M", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const other = await db.user.create({
      data: { email: uniq("taken") + "@t.local", username: uniq("taken"), name: "O", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });

    // Wrong password = failed reauthentication; nothing is written.
    const bad = await changeEmail(db, u.id, { email: uniq("new") + "@t.local", password: "wrong" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("reauth");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(u.email);

    // An address already used by another account is rejected.
    const dup = await changeEmail(db, u.id, { email: other.email, password: "Demo1234!" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("conflict");

    // Another account's USERNAME is just as unsafe: login() matches either.
    const asUsername = await changeEmail(db, u.id, { email: other.username, password: "Demo1234!" });
    expect(asUsername.ok).toBe(false);
    if (!asUsername.ok) expect(asUsername.code).toBe("conflict");

    // Re-entering your own address changes nothing and is reported as such.
    const same = await changeEmail(db, u.id, { email: u.email.toUpperCase(), password: "Demo1234!" });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.code).toBe("unchanged");

    // Success: trimmed, lower-cased, same user row, both identifier paths updated.
    const next = uniq("next") + "@T.Local";
    const ok = await changeEmail(db, u.id, { email: `  ${next}  `, password: "Demo1234!" }, "10.0.0.7");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.user.id).toBe(u.id);
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.email).toBe(next.toLowerCase());
    expect((await login(db, { identifier: u.email, password: "Demo1234!" })).ok).toBe(false);
    const relogin = await login(db, { identifier: next.toLowerCase(), password: "Demo1234!" });
    expect(relogin.ok).toBe(true);
    if (relogin.ok) expect(relogin.user.id).toBe(u.id);

    // The change is audited with the before/after pair (never the password).
    const entry = await db.auditLog.findFirst({
      where: { actorId: u.id, action: "auth.email_change" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(String(entry?.meta)).toContain(next.toLowerCase());
    expect(String(entry?.meta)).toContain(u.email);
    expect(String(entry?.meta)).not.toContain("Demo1234!");
  });

  it("keeps the session and memberships intact after the change", async () => {
    const u = await db.user.create({
      data: { email: uniq("sess") + "@t.local", username: uniq("u"), name: "S", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const { token } = await createSession(db, u.id, {});
    const project = await db.project.create({ data: { key: uniq("K").slice(0, 12), name: "Keep" } });
    await db.projectMember.create({ data: { projectId: project.id, userId: u.id } });

    const ok = await changeEmail(db, u.id, { email: uniq("after") + "@t.local", password: "Demo1234!" });
    expect(ok.ok).toBe(true);

    // Same session token still resolves to the same user id…
    const session = await getSessionUser(db, token);
    expect(session?.user.id).toBe(u.id);
    expect(session?.user.email).toBe((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email);
    // …and the project membership followed the account, not the address.
    const member = await db.projectMember.findFirst({ where: { userId: u.id, projectId: project.id } });
    expect(member).not.toBeNull();
  });
});

describe("session activity & signing out other sessions", () => {
  it("derives last-active from the persisted idle deadline (idleExpiresAt − IDLE_TTL_MS)", async () => {
    const u = await db.user.create({
      data: { email: uniq("act") + "@t.local", username: uniq("u"), name: "A", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const { session } = await createSession(db, u.id, {});
    const touched = new Date(Date.now() - 5 * 60 * 1000);
    await db.session.update({ where: { id: session.id }, data: { idleExpiresAt: touched } });
    const fresh = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionLastActiveAt(fresh).getTime()).toBe(touched.getTime() - IDLE_TTL_MS);
  });

  it("a real request moves last-active to now, and revokeOtherSessions keeps only the current one", async () => {
    const u = await db.user.create({
      data: { email: uniq("ro") + "@t.local", username: uniq("u"), name: "R", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    const keep = await createSession(db, u.id, {});   // "current session"
    const second = await createSession(db, u.id, {});
    const third = await createSession(db, u.id, {});
    expect((await listActiveSessions(db, u.id)).length).toBe(3);

    // A request carrying `second`'s token refreshes its idle deadline…
    const before = Date.now();
    expect((await getSessionUser(db, second.token))?.user.id).toBe(u.id);
    const row = (await listActiveSessions(db, u.id)).find((s) => s.id === second.session.id);
    expect(row).toBeDefined();
    if (row) expect(sessionLastActiveAt(row).getTime()).toBeGreaterThanOrEqual(before);

    // …and "sign out other sessions" ends everyone except the named one.
    const count = await revokeOtherSessions(db, u.id, keep.session.id, u.id, "10.0.0.9");
    expect(count).toBe(2);
    const remaining = await listActiveSessions(db, u.id);
    expect(remaining.map((s) => s.id)).toEqual([keep.session.id]);
    expect(await getSessionUser(db, second.token)).toBeNull();
    expect(await getSessionUser(db, third.token)).toBeNull();
    expect((await getSessionUser(db, keep.token))?.user.id).toBe(u.id);

    // Revoking with no exceptions clears the rest too.
    await createSession(db, u.id, {});
    expect(await revokeOtherSessions(db, u.id, null, u.id)).toBe(2);
    expect((await listActiveSessions(db, u.id)).length).toBe(0);
  });
});
