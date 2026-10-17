import type { PrismaClient } from "@prisma/client";
import { audit } from "./auth";
import { dayKey } from "./calendar";

/**
 * Holiday management for the Calendar's "Calendar Settings".
 *
 * Holidays are GLOBAL for everyone (item 1): there is no per-project scope
 * anywhere — the Calendar Settings UI, the API payload and the DB no longer
 * carry a project. Managing (add/edit/delete) is Admin-only; everyone sees
 * every holiday.
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

export interface HolidayRow {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  canManage: boolean;
}

/** Parse a `YYYY-MM-DD` day key into LOCAL midnight; null when malformed. */
export function parseHolidayDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toRow(h: { id: string; date: Date; name: string }, canManage: boolean): HolidayRow {
  return { id: h.id, date: dayKey(h.date), name: h.name, canManage };
}

/** Holidays for the viewer, oldest first. Only Admins may manage them. */
export async function listHolidays(
  client: PrismaClient,
  actor: HolidayActor,
): Promise<{ holidays: HolidayRow[]; canManageGlobal: boolean }> {
  const holidays = await client.holiday.findMany({ orderBy: [{ date: "asc" }, { name: "asc" }] });
  return {
    canManageGlobal: actor.isSuperAdmin,
    holidays: holidays.map((h) => toRow(h, actor.isSuperAdmin)),
  };
}

export interface HolidayInput {
  date: string;
  name?: string;
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
  const date = parseHolidayDate(input.date);
  if (!date) return { ok: false, status: 400, error: "A valid date (YYYY-MM-DD) is required." };
  const name = (input.name ?? "").trim().slice(0, 120);

  const holiday = await client.holiday.create({ data: { date, name } });
  await audit(client, {
    actorId: actor.id, action: "holiday.create", entity: "holiday", entityId: holiday.id,
    meta: { date: input.date, name }, ip,
  });
  return { ok: true, holiday: toRow(holiday, true) };
}

export async function updateHoliday(
  client: PrismaClient,
  actor: HolidayActor,
  holidayId: string,
  patch: { date?: string; name?: string },
  ip?: string,
): Promise<Failure | { ok: true; holiday: HolidayRow }> {
  const target = await client.holiday.findUnique({ where: { id: holidayId } });
  if (!target) return { ok: false, status: 404, error: "Holiday not found." };
  if (!actor.isSuperAdmin) {
    return { ok: false, status: 403, error: "Only an Admin can manage holidays." };
  }
  const data: Record<string, unknown> = {};
  if (patch.date !== undefined) {
    const d = parseHolidayDate(patch.date);
    if (!d) return { ok: false, status: 400, error: "A valid date (YYYY-MM-DD) is required." };
    data.date = d;
  }
  if (patch.name !== undefined) data.name = patch.name.trim().slice(0, 120);
  if (Object.keys(data).length === 0) return { ok: false, status: 400, error: "Nothing to update." };

  const holiday = await client.holiday.update({ where: { id: holidayId }, data });
  await audit(client, {
    actorId: actor.id, action: "holiday.update", entity: "holiday", entityId: holidayId,
    meta: { before: { date: dayKey(target.date), name: target.name }, after: { date: dayKey(holiday.date), name: holiday.name } }, ip,
  });
  return { ok: true, holiday: toRow(holiday, true) };
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
    meta: { date: dayKey(target.date), name: target.name }, ip,
  });
  return { ok: true };
}
