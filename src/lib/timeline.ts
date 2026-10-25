/**
 * Pure helpers behind the project Timeline: the overall date range, the zoom
 * scale, axis ticks and bar geometry. All date maths happens on DAY KEYS
 * (YYYY-MM-DD) interpreted as UTC midnights, so a bar never shifts by a day
 * because of a timezone or DST boundary, and the page stays trivially
 * unit-testable (tests/timeline.test.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inclusive day range as day keys. */
export interface DayRange {
  start: string;
  end: string;
}

function isDayKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Day key → UTC midnight milliseconds. */
export function keyToMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
}

/** UTC midnight milliseconds → day key. */
export function msToKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: string, n: number): string {
  return msToKey(keyToMs(key) + n * DAY_MS);
}

/** Inclusive length in days (start === end → 1). */
export function spanDays(r: DayRange): number {
  return Math.max(1, Math.round((keyToMs(r.end) - keyToMs(r.start)) / DAY_MS) + 1);
}

/** Smallest range covering both (null-safe) — used to keep every task visible. */
export function unionRange(a: DayRange | null, b: DayRange | null): DayRange | null {
  if (!a) return b;
  if (!b) return a;
  return { start: a.start < b.start ? a.start : b.start, end: a.end > b.end ? a.end : b.end };
}

export function padRange(r: DayRange, before = 0, after = 0): DayRange {
  return { start: addDays(r.start, -before), end: addDays(r.end, after) };
}

export type TimelineZoom = "day" | "week" | "month" | "fit";

export const TIMELINE_ZOOMS: TimelineZoom[] = ["day", "week", "month", "fit"];

export const ZOOM_LABEL: Record<TimelineZoom, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  fit: "Fit entire project",
};

/** Pixels per day for a zoom level; "fit" squeezes the whole range into `fitWidth`. */
export function scaleFor(zoom: TimelineZoom, days: number, fitWidth: number): number {
  switch (zoom) {
    case "day": return 26;
    case "week": return 9;
    case "month": return 3;
    case "fit": return Math.max(0.4, Math.min(26, Math.max(1, fitWidth) / Math.max(1, days)));
  }
}

/** Days between axis labels at a given scale. */
export function tickEvery(pxPerDay: number): number {
  if (pxPerDay >= 20) return 1;
  if (pxPerDay >= 7) return 7;
  if (pxPerDay >= 2.5) return 14;
  return 30;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(key: string): string {
  const d = new Date(keyToMs(key));
  const day = d.getUTCDate();
  return day === 1 ? `1 ${MONTHS[d.getUTCMonth()]}` : String(day);
}

function dayMonthLabel(key: string): string {
  const d = new Date(keyToMs(key));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function monthLabel(key: string): string {
  const d = new Date(keyToMs(key));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface AxisTick {
  key: string;
  label: string;
}

/**
 * Axis labels for a visible range: day numbers on the Day zoom, day+month on
 * Week/Fortnight, month names on the Month zoom and on "Fit" for long ranges.
 */
export function axisTicks(range: DayRange, pxPerDay: number): AxisTick[] {
  const every = tickEvery(pxPerDay);
  const out: AxisTick[] = [];
  if (every >= 30) {
    // One label per calendar month, anchored on the first visible day of that
    // month (so a range starting mid-month is labelled too, exactly once).
    let cursor = `${range.start.slice(0, 7)}-01`;
    for (let guard = 0; cursor <= range.end && guard < 400; guard++) {
      out.push({ key: cursor < range.start ? range.start : cursor, label: monthLabel(cursor) });
      const d = new Date(keyToMs(cursor));
      cursor = msToKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    return out;
  }
  for (let i = 0; i < 4000; i += every) {
    const key = addDays(range.start, i);
    if (key > range.end) break;
    out.push({ key, label: every === 1 ? dayLabel(key) : dayMonthLabel(key) });
  }
  return out;
}

/** Horizontal offset (px) of a day key inside the visible range. */
export function offsetPx(key: string, range: DayRange, pxPerDay: number): number {
  return ((keyToMs(key) - keyToMs(range.start)) / DAY_MS) * pxPerDay;
}

export interface BarRect {
  left: number;
  width: number;
}

/** Pixel rect of an inclusive [start..end] day range inside the visible range. */
export function barRect(start: string, end: string, range: DayRange, pxPerDay: number): BarRect {
  const s = start < range.start ? range.start : start;
  const e = end < s ? s : end > range.end ? range.end : end;
  const left = Math.round(offsetPx(s, range, pxPerDay));
  const dayCount = (keyToMs(e) - keyToMs(s)) / DAY_MS + 1;
  // Never below 1px: at extreme zoom-out a single-day bar must stay visible.
  const width = Math.max(1, Math.round(dayCount * pxPerDay));
  return { left, width };
}

/** Width of the scrollable schedule area. */
export function scheduleWidth(range: DayRange, pxPerDay: number, min = 160): number {
  return Math.max(min, Math.round(spanDays(range) * pxPerDay));
}

/** Day key of an instant (timer fields: due/start/stop) in the viewer's local time. */
export function localDayKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("sv");
}

/** Day key of a date-only field (stored as UTC midnight). */
export function storedDayKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const key = v.slice(0, 10);
  return isDayKey(key) ? key : null;
}

/** Earliest start → latest end across the given inclusive ranges. */
export function taskRange(ranges: readonly DayRange[]): DayRange | null {
  let out: DayRange | null = null;
  for (const r of ranges) out = unionRange(out, r);
  return out;
}

/** Project-level dates when the project settings define a valid pair. */
export function configuredRange(settings: Record<string, unknown> | null | undefined): DayRange | null {
  if (!settings) return null;
  const { startDate, endDate } = settings;
  return isDayKey(startDate) && isDayKey(endDate) && startDate <= endDate ? { start: startDate, end: endDate } : null;
}

/**
 * The overall project range: configured project dates when present, otherwise
 * the earliest task start → latest task due date (null when there is neither).
 * Tasks that fall outside a configured project range still widen the VISIBLE
 * range (`unionRange(project, derived)`), so nothing is ever hidden.
 */
export function projectRange(
  settings: Record<string, unknown> | null | undefined,
  taskRanges: readonly DayRange[],
): { project: DayRange | null; visible: DayRange | null; derived: DayRange | null; outside: boolean } {
  const derived = taskRange(taskRanges);
  const project = configuredRange(settings);
  const base = project ?? derived;
  const visible = unionRange(project, derived) ?? base;
  const outside = Boolean(project && derived && (derived.start < project.start || derived.end > project.end));
  return { project: base, visible, derived, outside };
}
