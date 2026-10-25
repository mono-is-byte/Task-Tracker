import { dayKey, isWeekendDay } from "./calendar";

/**
 * Calendar holiday helpers - pure functions (no server imports) shared by the
 * server (`lib/holidays.ts`, capacity, calendar feed) and the client (calendar
 * grid, Calendar Settings), so the display and the working-day calculations
 * always agree on one set of precedence rules:
 *
 *   1. an explicit WORKING-DAY EXCEPTION wins over everything,
 *   2. otherwise a configured HOLIDAY up to (and including) its end date,
 *   3. otherwise the default WEEKLY holiday (Friday/Saturday),
 *   4. otherwise a regular working day.
 *
 * Dates are local-midnight `YYYY-MM-DD` day keys (the same keys
 * `<input type="date">` produces), matching `dayKey()` in lib/calendar.
 */

export const HOLIDAY_TYPES = ["public", "festival", "office", "other"] as const;

export const HOLIDAY_TYPE_LABEL: Record<string, string> = {
  public: "Public holiday",
  festival: "Festival",
  office: "Office holiday",
  other: "Other",
};

/** A holiday span as the API/UI exchange it (inclusive on both ends). */
export interface HolidaySpan {
  id: string;
  /** First day, YYYY-MM-DD. */
  startDate: string;
  /** Last day, YYYY-MM-DD; equal to startDate for a single-day holiday. */
  endDate: string;
  name: string;
  description: string;
  type: string;
}

export interface ExceptionRow {
  id: string;
  date: string;
  note: string;
}

const HOLIDAY_MAX_DAYS = 366;

/** Malformed keys return null; otherwise local midnight of that day. */
export function parseDayKey(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Reject overflow like 2026-02-31 (JS would roll it into March).
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

/** Every day key in [start..end] inclusive; [] when malformed or end < start. */
export function dayKeysBetween(startKey: string, endKey: string, cap = HOLIDAY_MAX_DAYS): string[] {
  const start = parseDayKey(startKey);
  const end = parseDayKey(endKey);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime() && out.length < cap) {
    out.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** All day keys covered by a holiday span (single day when endDate == startDate). */
export function holidayDayKeys(h: Pick<HolidaySpan, "startDate" | "endDate">): string[] {
  return dayKeysBetween(h.startDate, h.endDate || h.startDate);
}

export function holidayCoversDay(h: Pick<HolidaySpan, "startDate" | "endDate">, day: string): boolean {
  const end = h.endDate || h.startDate;
  return day >= h.startDate && day <= end;
}

/** Normalised name used for duplicate detection (case/whitespace-insensitive). */
export function normalizeHolidayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

type DayKind = "working" | "weekly_holiday" | "holiday" | "exception";

export interface DayInfo {
  day: string;
  /** Friday/Saturday - the default weekly holiday, regardless of exception. */
  weekend: boolean;
  /** The configured holiday covering this day, if any. */
  holiday: HolidaySpan | null;
  /** The working-day exception for this day, if any. */
  exception: ExceptionRow | null;
  /** Final classification after applying precedence. */
  kind: DayKind;
  /** True when the day counts as a working day for capacity/timer maths. */
  working: boolean;
}

/**
 * One source of truth for "what is this day?" - used by the calendar grid, the
 * legend and the capacity calculation so an exception behaves identically in
 * every view.
 */
export function classifyDay(
  day: string,
  date: Date,
  holidays: Pick<HolidaySpan, "id" | "startDate" | "endDate" | "name" | "description" | "type">[],
  exceptions: Record<string, ExceptionRow>,
): DayInfo {
  const holiday = holidays.find((h) => holidayCoversDay(h, day)) ?? null;
  const exception = exceptions[day] ?? null;
  const weekend = isWeekendDay(date);
  const kind: DayKind = exception
    ? "exception"
    : holiday
      ? "holiday"
      : weekend
        ? "weekly_holiday"
        : "working";
  return { day, weekend, holiday, exception, kind, working: kind === "working" || kind === "exception" };
}
