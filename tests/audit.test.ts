import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AUDIT_RETENTION, audit, pruneAuditLog } from "../src/lib/audit";
import { profileChanges } from "../src/lib/accountRules";
import { login } from "../src/lib/auth";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

/**
 * PHASE 6 regression tests — audit retention (newest 25), inline pruning
 * safety, "no change = no audit row", and the guarantee that retention never
 * touches the tables other features depend on (LoginAttempt lockout window,
 * Activity = task history).
 */

const TEST_FILE = "./tests/test-audit.db";
const TEST_URL = `file:${TEST_FILE}`;

/** Minimal surface of better-sqlite3 actually used to bootstrap the schema. */
type SqliteLike = {
  exec(sql: string): unknown;
  prepare(sql: string): { get(): unknown };
  transaction(fn: () => void): () => void;
  close(): void;
};

/**
 * Build the scratch DB from the committed migrations exactly like
 * `scripts/pretest.mjs` does — that script keeps a FIXED list of test
 * databases, so this file boots its own instead of editing it. Recreated on
 * every run, so a stale schema can never survive a migration.
 */
function freshSchema() {
  if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  const require_ = createRequire(import.meta.url);
  const Database = require_("better-sqlite3") as new (file: string) => SqliteLike;
  const db = new Database(TEST_FILE);
  const dir = "prisma/migrations";
  const sql = readdirSync(dir)
    .filter((d) => d !== "migration_lock.toml")
    .sort()
    .map((d) => readFileSync(join(dir, d, "migration.sql"), "utf8"))
    .join("\n");
  const statements = sql
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  db.transaction(() => {
    for (const stmt of statements) db.exec(stmt);
  })();
  db.close();
}

freshSchema();
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

beforeAll(async () => {
  await db.$connect();
});

/** Insert `n` audit rows with strictly increasing timestamps (1s apart). */
async function seedAuditRows(count: number, prefix: string): Promise<string[]> {
  const ids: string[] = [];
  const base = Date.now() - count * 1000;
  for (let i = 0; i < count; i++) {
    const row = await db.auditLog.create({
      data: { action: `${prefix}.${i}`, createdAt: new Date(base + i * 1000) },
    });
    ids.push(row.id);
  }
  return ids;
}

describe("audit retention (PHASE 6a)", () => {
  it("pruneAuditLog keeps exactly the newest 25 rows", async () => {
    await db.auditLog.deleteMany();
    const ids = await seedAuditRows(30, "seed");
    await pruneAuditLog(db);
    const left = await db.auditLog.findMany({ orderBy: { createdAt: "desc" } });
    expect(left.length).toBe(AUDIT_RETENTION);
    // The newest 25 survive, in newest-first order — the oldest 5 are gone.
    expect(left.map((r) => r.id)).toEqual(ids.slice(-AUDIT_RETENTION).reverse());
  });

  it("audit() writes the row and prunes inline; the page query returns max 25", async () => {
    await db.auditLog.deleteMany();
    for (let i = 0; i < AUDIT_RETENTION + 5; i++) {
      await audit(db, { action: `inline.${i}` });
      // Distinct created-at per row keeps "newest" deterministic in this test.
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await db.auditLog.count()).toBe(AUDIT_RETENTION);
    // The exact query the /admin/audit route runs never returns more than 25.
    const page = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: AUDIT_RETENTION });
    expect(page.length).toBe(AUDIT_RETENTION);
    expect(page[0].action).toBe(`inline.${AUDIT_RETENTION + 4}`);
  });

  it("does not crash under concurrent inserts and never exceeds the cap", async () => {
    await db.auditLog.deleteMany();
    await seedAuditRows(AUDIT_RETENTION + 1, "race");
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => audit(db, { action: `conc.${i}` })),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const count = await db.auditLog.count();
    expect(count).toBeLessThanOrEqual(AUDIT_RETENTION);
    expect(count).toBeGreaterThan(0);
  });

  it("a failing prune never fails the audited action", async () => {
    await db.auditLog.deleteMany();
    // A client whose ONLY broken part is the prune lookup: the insert must
    // still succeed (pruning is best-effort housekeeping).
    const broken = new Proxy(db as unknown as object, {
      get(target, prop, receiver) {
        if (prop === "auditLog") {
          const real = (target as { auditLog: object }).auditLog;
          return new Proxy(real, {
            get(t, p) {
              if (p === "findMany") return () => { throw new Error("prune lookup failed"); };
              const value = Reflect.get(t, p) as unknown;
              return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
            },
          });
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as unknown as typeof db;
    await expect(audit(broken, { action: "still.written" })).resolves.toBeUndefined();
    expect(await db.auditLog.count()).toBe(1);
  });

  it("never prunes the LoginAttempt window — lockout keeps working", async () => {
    const email = `${uniq("lock")}@t.local`;
    const user = await db.user.create({
      data: { email, username: uniq("lu"), name: "L", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    for (let i = 0; i < 5; i++) {
      await login(db, { identifier: email, password: "nope-nope-nope", ip: "10.9.9.9" });
    }
    // Bursts of audited actions (each one prunes) must not touch LoginAttempt.
    await db.auditLog.deleteMany();
    for (let i = 0; i < AUDIT_RETENTION + 5; i++) await audit(db, { action: `lockn.${i}` });
    expect(await db.loginAttempt.count()).toBeGreaterThanOrEqual(5);
    const locked = await login(db, { identifier: email, password: "Demo1234!", ip: "10.9.9.9" });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.code).toBe("locked");
    expect(user.id).toBeTruthy();
  });

  it("prunes LoginAttempt rows older than 24h but keeps the active window", async () => {
    await db.loginAttempt.deleteMany();
    const user = await db.user.create({
      data: { email: `${uniq("ttl")}@t.local`, username: uniq("tu"), name: "T", passwordHash: await hashPassword("Demo1234!"), mustChangePassword: false },
    });
    await db.loginAttempt.create({
      data: { identifier: "stale@t.local", success: false, createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    await db.loginAttempt.create({ data: { identifier: "fresh@t.local", success: false } });
    const okLogin = await login(db, { identifier: user.email, password: "Demo1234!" });
    expect(okLogin.ok).toBe(true);
    const left = await db.loginAttempt.findMany();
    expect(left.some((a) => a.identifier === "stale@t.local")).toBe(false);
    expect(left.some((a) => a.identifier === "fresh@t.local")).toBe(true);
  });

  it("never prunes Activity — that table is task history, not a display feed", async () => {
    await db.activity.deleteMany();
    const project = await db.project.create({ data: { key: uniq("K").slice(0, 12), name: "History" } });
    const priority = await db.priority.create({ data: { projectId: project.id, name: "Normal" } });
    const status = await db.status.create({ data: { projectId: project.id, name: "To Do" } });
    const task = await db.task.create({
      data: { projectId: project.id, serial: 1, title: "History task", priorityId: priority.id, statusId: status.id },
    });
    for (let i = 0; i < 30; i++) {
      await db.activity.create({ data: { taskId: task.id, action: "task.status", field: "status", before: `s${i}`, after: `s${i + 1}` } });
    }
    await db.auditLog.deleteMany();
    for (let i = 0; i < AUDIT_RETENTION + 5; i++) await audit(db, { action: `actn.${i}` });
    expect(await db.activity.count({ where: { taskId: task.id } })).toBe(30);
  });
});

describe("profile change diff (PHASE 6b)", () => {
  const before = { id: "u1", name: "Rahim", theme: "system", hoursPerDay: 8, avatarUrl: null, gender: "Male" };

  it("an unchanged save produces an empty patch — no write, no audit row", async () => {
    const { data, diff } = profileChanges(before, {
      name: "Rahim", theme: "system", hoursPerDay: 8, avatarUrl: null, gender: "Male",
    });
    expect(data).toEqual({});
    expect(diff).toEqual({});

    // Simulate the route: nothing to write → no audit row is created.
    await db.auditLog.deleteMany();
    if (Object.keys(data).length > 0) {
      await audit(db, { action: "user.profile_update", entity: "user", entityId: "u1", meta: diff });
    }
    expect(await db.auditLog.count()).toBe(0);

    // And saving the SAME row again stays a no-op (repeat-save noise is gone).
    const again = profileChanges(before, { name: "Rahim" });
    expect(Object.keys(again.data).length).toBe(0);
  });

  it("a changed field produces exactly one row with an [old, new] diff", async () => {
    const { data, diff } = profileChanges(before, { name: "Rahim Uddin", gender: "Other" });
    expect(data).toEqual({ name: "Rahim Uddin", gender: "Other" });
    expect(diff).toEqual({ name: ["Rahim", "Rahim Uddin"], gender: ["Male", "Other"] });

    await db.auditLog.deleteMany();
    if (Object.keys(data).length > 0) {
      await audit(db, { action: "user.profile_update", entity: "user", entityId: "u1", meta: diff, ip: "10.0.0.1" });
    }
    const rows = await db.auditLog.findMany({ where: { action: "user.profile_update" } });
    expect(rows.length).toBe(1);
    const meta = JSON.parse(rows[0].meta) as Record<string, [unknown, unknown]>;
    expect(meta.name).toEqual(["Rahim", "Rahim Uddin"]);
    expect(rows[0].ip).toBe("10.0.0.1");
  });

  it("the avatar diff is set/none — the image itself is never stored", () => {
    const image = "data:image/png;base64,AAAA";
    const { data, diff } = profileChanges(before, { avatarUrl: image });
    expect(data.avatarUrl).toBe(image);
    expect(diff.avatarUrl).toEqual(["none", "set"]);
    expect(JSON.stringify(diff)).not.toContain("base64");

    const cleared = profileChanges({ ...before, avatarUrl: image }, { avatarUrl: null });
    expect(cleared.diff.avatarUrl).toEqual(["set", "none"]);
  });

  it("fields that were not sent are ignored", () => {
    const { data, diff } = profileChanges(before, {});
    expect(data).toEqual({});
    expect(diff).toEqual({});
    // null is a real value (clearing gender/hours), undefined means "absent".
    const { data: d2 } = profileChanges(before, { gender: null });
    expect(d2).toEqual({ gender: null });
  });
});
