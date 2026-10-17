import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  parseHolidayDate,
  updateHoliday,
} from "../src/lib/holidays";

const TEST_URL = "file:./tests/test-holidays.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

let fx: {
  users: { admin: string; pm: string; dev: string };
  holidays: { first: string };
};

async function makeUser(key: string, isSuperAdmin = false): Promise<string> {
  const u = await db.user.create({
    data: {
      email: uniq(key) + "@t.local",
      username: uniq(key),
      name: `name-${key}`,
      passwordHash: await hashPassword("Demo1234!"),
      mustChangePassword: false,
      isSuperAdmin,
    },
  });
  return u.id;
}

beforeAll(async () => {
  await db.$connect();
  const admin = await makeUser("admin", true);
  const pm = await makeUser("pm");
  const dev = await makeUser("dev");
  const first = await db.holiday.create({ data: { date: new Date(2026, 0, 1), name: "H Global Day" } });
  fx = { users: { admin, pm, dev }, holidays: { first: first.id } };
});

describe("holiday date parsing", () => {
  it("accepts YYYY-MM-DD as local midnight and rejects malformed input", () => {
    const d = parseHolidayDate("2026-10-15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(15);
    expect(parseHolidayDate("15/10/2026")).toBeNull();
    expect(parseHolidayDate("nope")).toBeNull();
  });
});

describe("holiday permissions (global, Admin-managed)", () => {
  it("only an Admin may create/update/delete; everyone may list", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const dev = { id: fx.users.dev, isSuperAdmin: false };

    const pmCreate = await createHoliday(db, pm, { date: "2026-12-25", name: "x" });
    expect(pmCreate.ok).toBe(false);
    if (!pmCreate.ok) expect(pmCreate.status).toBe(403);

    const pmUpdate = await updateHoliday(db, pm, fx.holidays.first, { name: "hacked" });
    expect(pmUpdate.ok).toBe(false);
    if (!pmUpdate.ok) expect(pmUpdate.status).toBe(403);

    const pmDelete = await deleteHoliday(db, pm, fx.holidays.first);
    expect(pmDelete.ok).toBe(false);
    if (!pmDelete.ok) expect(pmDelete.status).toBe(403);

    // Listing is open to every member, but only the Admin gets the manage flag.
    const devList = await listHolidays(db, dev);
    expect(devList.canManageGlobal).toBe(false);
    expect(devList.holidays.every((h) => h.canManage === false)).toBe(true);
    const adminList = await listHolidays(db, admin);
    expect(adminList.canManageGlobal).toBe(true);
    expect(adminList.holidays.every((h) => h.canManage === true)).toBe(true);
  });
});

describe("createHoliday", () => {
  it("an Admin adds a global holiday (audited) and bad dates are rejected", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const res = await createHoliday(db, admin, { date: "2026-12-25", name: "H Christmas" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.holiday.date).toBe("2026-12-25");
      const row = await db.holiday.findUnique({ where: { id: res.holiday.id } });
      expect(row?.name).toBe("H Christmas");
      const log = await db.auditLog.findFirst({ where: { action: "holiday.create", entityId: res.holiday.id } });
      expect(log?.actorId).toBe(fx.users.admin);
    }

    const bad = await createHoliday(db, admin, { date: "soon", name: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(400);
  });
});

describe("updateHoliday / deleteHoliday", () => {
  it("an Admin edits and deletes; edits are audited and empty patches rejected", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const rename = await updateHoliday(db, admin, fx.holidays.first, { name: "H Global Day (renamed)" });
    expect(rename.ok).toBe(true);
    if (rename.ok) expect(rename.holiday.name).toBe("H Global Day (renamed)");

    const empty = await updateHoliday(db, admin, fx.holidays.first, {});
    expect(empty.ok).toBe(false);

    const created = await createHoliday(db, admin, { date: "2026-11-11", name: "H To Delete" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const del = await deleteHoliday(db, admin, created.holiday.id);
    expect(del.ok).toBe(true);
    expect(await db.holiday.findUnique({ where: { id: created.holiday.id } })).toBeNull();
    const log = await db.auditLog.findFirst({ where: { action: "holiday.delete", entityId: created.holiday.id } });
    expect(log?.actorId).toBe(fx.users.admin);
  });

  it("missing holidays return 404", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const upd = await updateHoliday(db, admin, "nope", { name: "x" });
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.status).toBe(404);
    const del = await deleteHoliday(db, admin, "nope");
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.status).toBe(404);
  });
});
