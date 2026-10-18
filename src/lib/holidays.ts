import type { PrismaClient } from "@prisma/client";
import { audit } from "./auth";
import { dayKey } from "./calendar";
import {
  HOLIDAY_TYPES,
  dayKeysBetween,
  normalizeHolidayName,
  parseDayKey,
  type ExceptionRow,
  type HolidaySpan,
} from "./holidayDates";

/**
 * Holiday management for the Calendar's "Calendar Settings".
 *
 * Holidays are GLOBAL for everyone: there is no per-project scope anywhere -
 * the Calendar Settings UI, the API payload and the DB carry no project.
 * Managing (add/edit/delete) is Admin-only; everyone sees every holiday.
 *
 * A holiday is a date RANGE: `startDate`..`endDate`, inclusive on both ends.
 * A single day is simply `endDate == startDate`. The data model stays
 * backwards-compatible: every pre-existing single-day row keeps working
 * (endDate NULL = one day) - nothing is rewritten or deleted.
 *
 * Working-day exceptions live in their own table and never touch the holiday
 * rows, so removing an exception always restores the holiday status.
 *
 * Holiday dates are normalised to LOCAL midnight of the picked day, so the
 * calendar (which also builds local-midnight cells) always shows them on the
 * right day in every timezone.
 */

export interface HolidayActor {
  id: string;
  isSuperAdmin: boolean;
}

export interface Failure {
  ok: false;
  status: number;
  error: string;
}

export interface HolidayRow extends HolidaySpan {
  canManage: boolean;
}

export interface HolidayList {
  holidays: HolidayRow[];
  exceptions: ExceptionRow[];
  canManageGlobal: boolean;
}

/** Parse a `YYYY-MM-DD` day key into LOCAL midnight; null when malformed. */
export function parseHolidayDate(v: string): Date | null {
  return parseDayKey(v);
}

function toHolidayRow(
  h: { id: string; date: Date; endDate: Date | null; name: string; description: string; type: string },
  canManage: boolean,
): HolidayRow {
  const startDate = dayKey(h.date);
  return {
    id: h.id,
    startDate,
    endDate: h.endDate ? dayKey(h.endDate) : startDate,
    name: h.name,
    description: h.description ?? "",
    type: h.type || "public",
    canManage,
  };
}

function toExceptionRow(e: { id: string; date: Date; note: string }): ExceptionRow {
  return { id: e.id, date: dayKey(e.date), note: e.note ?? "" };
}

/** Holidays + working-day exceptions for the viewer. Only Admins may manage. */
export async function listHolidays(
  client: PrismaClient,
  actor: HolidayActor,
): Promise<HolidayList> {
  const [holidays, exceptions] = await Promise.all([
    client.holiday.findMany({ orderBy: [{ date: "asc" }, { name: "asc" }] }),
    client.workingDayException.findMany({ orderBy: { date: "asc" } }),
  ]);
  return {
    canManageGlobal: actor.isSuperAdmin,
    holidays: holidays.map((h) => toHolidayRow(h, actor.isSuperAdmin)),
    exceptions: exceptions.map(toExceptionRow),
  };
}

export interface HolidayInput {
  /** Start day; `date` is accepted as a legacy alias. */
  startDate?: string;
  date?: string;
  /** Last day, inclusive; omitted = single day at `startDate`. */
  endDate?: string | null;
  name?: string;
  description?: string;
  type?: string;
}

interface HolidayFields {
  start: Date;
  end: Date;
  name: string;
  description: string;
  type: string;
}

const MAX_NAME = 120;
const MAX_DESCRIPTION = 300;

/**
 * Validate + normalise the fields of a holiday. `existing` rows (their ids)
 * are skipped in duplicate detection when editing.
 */
function normalizeFields(
  input: HolidayInput,
  existingIdsToIgnore: string[] = [],
  base?: { startDate: string; endDate: string; name: string; description: string; type: string },
): Failure | { ok: true; fields: HolidayFields } {
  const startKey = (input.startDate ?? input.date ?? base?.startDate ?? "").trim();
  const start = parseDayKey(startKey);
  if (!start) {
    return { ok: false, status: 400, error: "A valid start date (YYYY-MM-DD) is required." };
  }
  const endKey = (input.endDate === undefined ? base?.endDate : input.endDate) ?? startKey;
  const end = parseDayKey(String(endKey));
  if (!end) return { ok: false, status: 400, error: "A valid end date (YYYY-MM-DD) is required." };
  if (end.getTime() < start.getTime()) {
    return { ok: false, status: 400, error: "The end date cannot be earlier than the start date." };
  }
  if (dayKeysBetween(dayKey(start), dayKey(end)).length === 0) {
    return { ok: false, status: 400, error: "The holiday range is too long (maximum 366 days)." };
  }
  const name = (input.name === undefined ? base?.name ?? "" : input.name).trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, status: 400, error: "A holiday name is required." };
  if (name.length > MAX_NAME) {
    return { ok: false, status: 400, error: `The holiday name may be up to ${MAX_NAME} characters.` };
  }
  const description = (input.description === undefined ? base?.description ?? "" : input.description ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION);
  const type = (input.type === undefined ? base?.type ?? "public" : input.type ?? "public").trim() || "public";
  if (!HOLIDAY_TYPES.includes(type as (typeof HOLIDAY_TYPES)[number])) {
    return { ok: false, status: 400, error: `Holiday type must be one of: ${HOLIDAY_TYPES.join(", ")}.` };
  }
  void existingIdsToIgnore;
  return { ok: true, fields: { start, end, name, description, type } };
}

/**
 * Reject accidental duplicates: the same normalised name overlapping an
 * existing range (a single day counts as a 1-day range). Editing ignores the
 * row itself.
 */
async function findDuplicate(
  client: PrismaClient,
  fields: HolidayFields,
  ignoreId?: string,
): Promise<{ id: string; date: Date; endDate: Date | null; name: string } | null> {
  const startKey = dayKey(fields.start);
  const endKey = dayKey(fields.end);
  const name = normalizeHolidayName(fields.name);
  const candidates = await client.holiday.findMany({
    where: { date: { lte: fields.end } },
    orderBy: { date: "asc" },
  });
  for (const c of candidates) {
    if (ignoreId && c.id === ignoreId) continue;
    const cStart = dayKey(c.date);
    const cEnd = c.endDate ? dayKey(c.endDate) : cStart;
    if (cEnd < startKey || cStart > endKey) continue; // no overlap
    if (normalizeHolidayName(c.name) !== name) continue; // different holiday
    return c;
  }
  return null;
}

export async function createHoliday(
  client: PrismaClient,
  actor: HolidayActor,
  input: HolidayInput,
  ip?: string,
): Promise<Failure | { ok: true; holiday: HolidayRow }> {
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage holidays." };
  }
  const normalized = normalizeFields(input);
  if (!normalized.ok) return normalized;
  const { fields } = normalized;

  const duplicate = await findDuplicate(client, fields);
  if (duplicate) {
    const cStart = dayKey(duplicate.date);
    const cEnd = duplicate.endDate ? dayKey(duplicate.endDate) : cStart;
    const span = cStart === cEnd ? cStart : `${cStart} to ${cEnd}`;
    return {
      ok: false,
      status: 409,
      error: `“${duplicate.name || "Holiday"}” already covers ${span}.`,
    };
  }

  const holiday = await client.holiday.create({
    data: { date: fields.start, endDate: fields.end, name: fields.name, description: fields.description, type: fields.type },
  });
  await audit(client, {
    actorId: actor.id, action: "holiday.create", entity: "holiday", entityId: holiday.id,
    meta: { startDate: dayKey(fields.start), endDate: dayKey(fields.end), name: fields.name, type: fields.type }, ip,
  });
  return { ok: true, holiday: toHolidayRow(holiday, true) };
}

export async function updateHoliday(
  client: PrismaClient,
  actor: HolidayActor,
  holidayId: string,
  patch: HolidayInput,
  ip?: string,
): Promise<Failure | { ok: true; holiday: HolidayRow }> {
  const target = await client.holiday.findUnique({ where: { id: holidayId } });
  if (!target) return { ok: false, status: 404, error: "Holiday not found." };
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage holidays." };
  }
  const base = {
    startDate: dayKey(target.date),
    endDate: target.endDate ? dayKey(target.endDate) : dayKey(target.date),
    name: target.name,
    description: target.description ?? "",
    type: target.type || "public",
  };
  const touched = patch.startDate !== undefined || patch.date !== undefined || patch.endDate !== undefined ||
    patch.name !== undefined || patch.description !== undefined || patch.type !== undefined;
  if (!touched) return { ok: false, status: 400, error: "Nothing to update." };

  const normalized = normalizeFields(patch, [holidayId], base);
  if (!normalized.ok) return normalized;
  const { fields } = normalized;

  const duplicate = await findDuplicate(client, fields, holidayId);
  if (duplicate) {
    const cStart = dayKey(duplicate.date);
    const cEnd = duplicate.endDate ? dayKey(duplicate.endDate) : cStart;
    const span = cStart === cEnd ? cStart : `${cStart} to ${cEnd}`;
    return { ok: false, status: 409, error: `“${duplicate.name || "Holiday"}” already covers ${span}.` };
  }

  const holiday = await client.holiday.update({
    where: { id: holidayId },
    data: { date: fields.start, endDate: fields.end, name: fields.name, description: fields.description, type: fields.type },
  });
  await audit(client, {
    actorId: actor.id, action: "holiday.update", entity: "holiday", entityId: holidayId,
    meta: {
      before: base,
      after: { startDate: dayKey(fields.start), endDate: dayKey(fields.end), name: fields.name, type: fields.type },
    }, ip,
  });
  return { ok: true, holiday: toHolidayRow(holiday, true) };
}

export async function deleteHoliday(
  client: PrismaClient,
  actor: HolidayActor,
  holidayId: string,
  ip?: string,
): Promise<Failure | { ok: true }> {
  const target = await client.holiday.findUnique({ where: { id: holidayId } });
  if (!target) return { ok: false, status: 404, error: "Holiday not found." };
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage holidays." };
  }
  await client.holiday.delete({ where: { id: holidayId } });
  await audit(client, {
    actorId: actor.id, action: "holiday.delete", entity: "holiday", entityId: holidayId,
    meta: {
      startDate: dayKey(target.date),
      endDate: target.endDate ? dayKey(target.endDate) : dayKey(target.date),
      name: target.name,
    }, ip,
  });
  return { ok: true };
}

/* ── Working-day exceptions ──────────────────────────────────────────────── */

export interface ExceptionInput {
  date: string;
  note?: string;
}

/**
 * Mark a date as a working day (office open) even if it is a weekly holiday or
 * a configured holiday. Idempotent: re-posting the same date updates the note.
 * The Holiday rows are untouched - removing the exception restores them.
 */
export async function addWorkingDayException(
  client: PrismaClient,
  actor: HolidayActor,
  input: ExceptionInput,
  ip?: string,
): Promise<Failure | { ok: true; exception: ExceptionRow }> {
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage working-day exceptions." };
  }
  const date = parseDayKey(input.date);
  if (!date) return { ok: false, status: 400, error: "A valid date (YYYY-MM-DD) is required." };
  const note = (input.note ?? "").trim().slice(0, MAX_DESCRIPTION);

  const exception = await client.workingDayException.upsert({
    where: { date },
    create: { date, note },
    update: { note },
  });
  await audit(client, {
    actorId: actor.id, action: "holiday.exception.add", entity: "workingDayException", entityId: exception.id,
    meta: { date: dayKey(date), note }, ip,
  });
  return { ok: true, exception: toExceptionRow(exception) };
}

export async function removeWorkingDayException(
  client: PrismaClient,
  actor: HolidayActor,
  dateKey: string,
  ip?: string,
): Promise<Failure | { ok: true }> {
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage working-day exceptions." };
  }
  const date = parseDayKey(dateKey);
  if (!date) return { ok: false, status: 400, error: "A valid date (YYYY-MM-DD) is required." };
  const target = await client.workingDayException.findUnique({ where: { date } });
  if (!target) return { ok: false, status: 404, error: "That date is not marked as a working day." };
  await client.workingDayException.delete({ where: { date } });
  await audit(client, {
    actorId: actor.id, action: "holiday.exception.remove", entity: "workingDayException", entityId: target.id,
    meta: { date: dayKey(date) }, ip,
  });
  return { ok: true };
}

/** Expanded per-day holiday keys inside [from..to] - used by capacity maths. */
export async function holidayKeysInRange(
  client: PrismaClient,
  from: string,
  to: string,
): Promise<{ holidays: string[]; exceptions: string[] }> {
  const [holidays, exceptions] = await Promise.all([
    client.holiday.findMany({ orderBy: { date: "asc" } }),
    client.workingDayException.findMany({ orderBy: { date: "asc" } }),
  ]);
  const keys = new Set<string>();
  for (const h of holidays) {
    const start = dayKey(h.date);
    const end = h.endDate ? dayKey(h.endDate) : start;
    for (const k of dayKeysBetween(start < from ? from : start, end > to ? to : end)) keys.add(k);
  }
  return {
    holidays: [...keys].sort(),
    exceptions: exceptions.map((e) => dayKey(e.date)).filter((k) => k >= from && k <= to).sort(),
  };
}
