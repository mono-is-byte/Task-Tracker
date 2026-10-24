import { beforeAll, describe, expect, it } from "vitest";
import { makeTestClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import {
  addWorkingDayException,
  createHoliday,
  deleteHoliday,
  holidayKeysInRange,
  listHolidays,
  parseHolidayDate,
  removeWorkingDayException,
  updateHoliday,
} from "../src/lib/holidays";

const TEST_URL = "file:./tests/test-holidays.db";
const db = makeTestClient(TEST_URL);

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

let fx: {
  users: { admin: string; pm: string; dev: string };
  holidays: { first: string; firstName: string };
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
  const firstName = uniq("H Global Day");
  const first = await db.holiday.create({ data: { date: new Date(2026, 0, 1), name: firstName } });
  fx = { users: { admin, pm, dev }, holidays: { first: first.id, firstName } };
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
    // overflow (2026-02-31) must not silently roll into March
    expect(parseHolidayDate("2026-02-31")).toBeNull();
  });
});

describe("holiday permissions (global, Admin-managed)", () => {
  it("only an Admin may create/update/delete; everyone may list", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const pm = { id: fx.users.pm, isSuperAdmin: false };
    const dev = { id: fx.users.dev, isSuperAdmin: false };

    const pmCreate = await createHoliday(db, pm, { startDate: "2026-12-25", name: "x" });
    expect(pmCreate.ok).toBe(false);
    if (!pmCreate.ok) expect(pmCreate.status).toBe(403);

    const pmUpdate = await updateHoliday(db, pm, fx.holidays.first, { name: "hacked" });
    expect(pmUpdate.ok).toBe(false);
    if (!pmUpdate.ok) expect(pmUpdate.status).toBe(403);

    const pmDelete = await deleteHoliday(db, pm, fx.holidays.first);
    expect(pmDelete.ok).toBe(false);
    if (!pmDelete.ok) expect(pmDelete.status).toBe(403);

    const pmException = await addWorkingDayException(db, pm, { date: "2026-05-01" });
    expect(pmException.ok).toBe(false);
    if (!pmException.ok) expect(pmException.status).toBe(403);

    // Listing is open to every member, but only the Admin gets the manage flag.
    const devList = await listHolidays(db, dev);
    expect(devList.canManageGlobal).toBe(false);
    expect(devList.holidays.every((h) => h.canManage === false)).toBe(true);
    const adminList = await listHolidays(db, admin);
    expect(adminList.canManageGlobal).toBe(true);
    expect(adminList.holidays.every((h) => h.canManage === true)).toBe(true);
  });
});

describe("createHoliday (date ranges)", () => {
  it("a single day keeps start == end, including the legacy `date` alias", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H Christmas");
    const res = await createHoliday(db, admin, { date: "2026-12-25", name });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.holiday.startDate).toBe("2026-12-25");
      expect(res.holiday.endDate).toBe("2026-12-25");
      const row = await db.holiday.findUnique({ where: { id: res.holiday.id } });
      expect(row?.name).toBe(name);
      const log = await db.auditLog.findFirst({ where: { action: "holiday.create", entityId: res.holiday.id } });
      expect(log?.actorId).toBe(fx.users.admin);
    }
  });

  it("stores a multi-day range (inclusive) with description and type", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H Range");
    const res = await createHoliday(db, admin, {
      startDate: "2026-03-01",
      endDate: "2026-03-05",
      name,
      description: "Spring break",
      type: "festival",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.holiday.startDate).toBe("2026-03-01");
    expect(res.holiday.endDate).toBe("2026-03-05");
    expect(res.holiday.description).toBe("Spring break");
    expect(res.holiday.type).toBe("festival");

    const keys = await holidayKeysInRange(db, "2026-03-01", "2026-03-31");
    expect(keys.holidays).toContain("2026-03-01");
    expect(keys.holidays).toContain("2026-03-05");
    expect(keys.holidays).not.toContain("2026-03-06");

    const widened = await holidayKeysInRange(db, "2026-03-03", "2026-03-04");
    expect(widened.holidays).toEqual(["2026-03-03", "2026-03-04"]);
  });

  it("validates name, order of the dates and the type", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const badDate = await createHoliday(db, admin, { startDate: "soon", name: "x" });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.status).toBe(400);

    const noName = await createHoliday(db, admin, { startDate: "2026-06-01", name: "   " });
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.status).toBe(400);

    const reversed = await createHoliday(db, admin, { startDate: "2026-06-10", endDate: "2026-06-01", name: "x" });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) {
      expect(reversed.status).toBe(400);
      expect(reversed.error).toMatch(/end date/i);
    }

    const badType = await createHoliday(db, admin, { startDate: "2026-06-01", name: "x", type: "nope" });
    expect(badType.ok).toBe(false);
    if (!badType.ok) expect(badType.status).toBe(400);

    const sameDay = await createHoliday(db, admin, { startDate: "2026-06-01", endDate: "2026-06-01", name: uniq("H Same") });
    expect(sameDay.ok).toBe(true);
  });

  it("rejects an accidental duplicate (same name overlapping the existing range)", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H Dup");
    const first = await createHoliday(db, admin, { startDate: "2026-07-01", endDate: "2026-07-03", name });
    expect(first.ok).toBe(true);

    // exact same range → conflict
    const again = await createHoliday(db, admin, { startDate: "2026-07-01", endDate: "2026-07-03", name: name.toUpperCase() });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.status).toBe(409);
      expect(again.error).toMatch(/already covers/);
    }

    // partial overlap with the same (normalised) name → conflict
    const overlap = await createHoliday(db, admin, { startDate: "2026-07-03", endDate: "2026-07-06", name: `  ${name}  ` });
    expect(overlap.ok).toBe(false);

    // a different holiday on the same days is allowed
    const other = await createHoliday(db, admin, { startDate: "2026-07-02", endDate: "2026-07-02", name: uniq("H Other") });
    expect(other.ok).toBe(true);

    // touching but not overlapping (starts the day after) is allowed
    const adjacent = await createHoliday(db, admin, { startDate: "2026-07-04", endDate: "2026-07-05", name });
    expect(adjacent.ok).toBe(true);
  });
});

describe("updateHoliday / deleteHoliday", () => {
  it("an Admin edits and deletes; edits are audited and empty patches rejected", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const target = uniq("H Renamed");
    const rename = await updateHoliday(db, admin, fx.holidays.first, { name: target });
    expect(rename.ok).toBe(true);
    if (rename.ok) expect(rename.holiday.name).toBe(target);
    expect(fx.holidays.firstName).not.toBe(target); // the fixture started under its own name

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

  it("a no-op save writes no audit row (PHASE 6b)", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H NoChange");
    const created = await createHoliday(db, admin, { startDate: "2026-09-01", name });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const same = await updateHoliday(db, admin, created.holiday.id, {
      startDate: created.holiday.startDate,
      endDate: created.holiday.endDate,
      name: created.holiday.name,
      description: created.holiday.description,
      type: created.holiday.type,
    });
    expect(same.ok).toBe(true);
    // A fresh holiday id can have no prior holiday.update rows: zero means the
    // no-op save skipped both the write and the audit entry.
    expect(await db.auditLog.count({ where: { action: "holiday.update", entityId: created.holiday.id } })).toBe(0);
  });

  it("can extend a single day into a range and reject an invalid one", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H Extend");
    const created = await createHoliday(db, admin, { startDate: "2026-08-10", name });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const extended = await updateHoliday(db, admin, created.holiday.id, { endDate: "2026-08-13" });
    expect(extended.ok).toBe(true);
    if (extended.ok) expect(extended.holiday.endDate).toBe("2026-08-13");

    const reversed = await updateHoliday(db, admin, created.holiday.id, { startDate: "2026-08-20" });
    expect(reversed.ok).toBe(false);

    // re-saving the same values must not trip over its own duplicate check
    const same = await updateHoliday(db, admin, created.holiday.id, { endDate: "2026-08-13", name });
    expect(same.ok).toBe(true);
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

describe("working-day exceptions", () => {
  it("an Admin marks a holiday as a working day and removes it again (holiday intact)", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    const name = uniq("H Exception");
    const hol = await createHoliday(db, admin, { startDate: "2026-09-01", endDate: "2026-09-03", name });
    expect(hol.ok).toBe(true);
    if (!hol.ok) return;

    const add = await addWorkingDayException(db, admin, { date: "2026-09-02", note: "Month-end closing" });
    expect(add.ok).toBe(true);
    if (add.ok) {
      expect(add.exception.date).toBe("2026-09-02");
      expect(add.exception.note).toBe("Month-end closing");
      const log = await db.auditLog.findFirst({ where: { action: "holiday.exception.add", entityId: add.exception.id } });
      expect(log?.actorId).toBe(fx.users.admin);
    }

    // idempotent: re-posting updates the note instead of failing on the unique date
    const again = await addWorkingDayException(db, admin, { date: "2026-09-02", note: "Updated note" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.exception.note).toBe("Updated note");
    expect(await db.workingDayException.count({ where: { date: new Date(2026, 8, 2) } })).toBe(1);

    // the exception overrides the holiday for capacity, but the holiday row stays
    const keys = await holidayKeysInRange(db, "2026-09-01", "2026-09-03");
    expect(keys.holidays).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(keys.exceptions).toEqual(["2026-09-02"]);

    const remove = await removeWorkingDayException(db, admin, "2026-09-02");
    expect(remove.ok).toBe(true);
    expect(await db.workingDayException.count({ where: { date: new Date(2026, 8, 2) } })).toBe(0);
    const row = await db.holiday.findUnique({ where: { id: hol.holiday.id } });
    expect(row?.name).toBe(name);
    expect(row?.endDate).toEqual(new Date(2026, 8, 3));

    const removeAgain = await removeWorkingDayException(db, admin, "2026-09-02");
    expect(removeAgain.ok).toBe(false);
    if (!removeAgain.ok) expect(removeAgain.status).toBe(404);

    const badDate = await addWorkingDayException(db, admin, { date: "nope" });
    expect(badDate.ok).toBe(false);
  });

  it("lists exceptions next to the holidays for the viewer", async () => {
    const admin = { id: fx.users.admin, isSuperAdmin: true };
    await addWorkingDayException(db, admin, { date: "2026-04-17" });
    const list = await listHolidays(db, admin);
    expect(list.exceptions.map((e) => e.date)).toContain("2026-04-17");
  });
});
