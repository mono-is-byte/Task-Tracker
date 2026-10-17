import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import {
  adminResetPassword,
  changePassword,
  createSession,
  getSessionUser,
  login,
  logout,
  revokeSession,
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
