/** Est. Days is always calculated, never typed: hours / hoursPerDay, 2dp. */
export function estDays(estHours: number | null | undefined, hoursPerDay: number): number | null {
  if (estHours == null || !Number.isFinite(estHours) || hoursPerDay <= 0) return null;
  return Math.round((estHours / hoursPerDay) * 100) / 100;
}

export function normalizeSearch(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/** AND-matching across whitespace-separated tokens (Bangla-safe: NFC + case fold). */
export function matchesSearch(haystack: string, query: string): boolean {
  const hay = normalizeSearch(haystack);
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

export function taskSearchText(t: {
  title: string;
  description?: string | null;
  epicName?: string | null;
  gitBranch?: string | null;
  key?: string;
}): string {
  return [t.key ?? "", t.title, t.description ?? "", t.epicName ?? "", t.gitBranch ?? ""].join("\n");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Local YYYY-MM-DD (holiday day keys are local, matching `dayKey()` in lib/calendar). */
function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Count working days (inclusive) in [start, end] given the weekday set
 * (0=Sun..6=Sat), configured holiday day keys and working-day exceptions.
 * Precedence matches the calendar (lib/holidayDates): a working-day exception
 * counts as a working day even when it is a weekly holiday or a holiday.
 */
export function workingDaysBetween(
  start: Date,
  end: Date,
  workingDays: number[],
  holidays: string[] = [],
  exceptions: string[] = [],
): number {
  const s = startOfDay(new Date(start)).getTime();
  const e = startOfDay(new Date(end)).getTime();
  if (e < s) return 0;
  const hol = new Set(holidays);
  const extra = new Set(exceptions);
  let count = 0;
  for (let t = s; t <= e; t += DAY_MS) {
    const d = new Date(t);
    const key = localDay(d);
    if (extra.has(key)) {
      count++;
      continue;
    }
    if (!workingDays.includes(d.getDay())) continue;
    if (hol.has(key)) continue;
    count++;
  }
  return count;
}

/** Team capacity in hours for a date range. memberHoursPerDay: effective h/day per member. */
export function computeCapacity(
  memberHoursPerDay: number[],
  start: Date,
  end: Date,
  workingDays: number[],
  holidays: string[] = [],
  exceptions: string[] = [],
): number {
  const days = workingDaysBetween(start, end, workingDays, holidays, exceptions);
  return Math.round(memberHoursPerDay.reduce((a, b) => a + b, 0) * days * 100) / 100;
}

export interface CapacityReport {
  plannedHours: number;
  capacityHours: number;
  over: boolean;
  overflow: number;
}

export function capacityReport(
  tasks: { estHours?: number | null }[],
  capacityHours: number,
): CapacityReport {
  const plannedHours = Math.round(tasks.reduce((a, t) => a + (t.estHours ?? 0), 0) * 100) / 100;
  return {
    plannedHours,
    capacityHours,
    over: plannedHours > capacityHours,
    overflow: Math.round((plannedHours - capacityHours) * 100) / 100,
  };
}

/** CSV/XLSX columns matching the Excel sheet so the current sheet imports directly. */
export const TASK_CSV_COLUMNS = [
  "SL",
  "Epic",
  "Task title",
  "Est. Hours",
  "Est. Days",
  "Description",
  // PHASE 11.3: one numbered notes cell replaces the split Remarks/Feedback
  // columns. Import still accepts those legacy headers.
  "Comments & notes",
  "Priority",
  "Status",
  // PHASE 11.5: these three stay adjacent, in this exact order.
  "Assigned By",
  "Assignee",
  "Tested By",
  "Start Date",
  "End Date",
  "Git Branch",
  "Dependency",
] as const;

const BANNER = "Tasks time may change depending on meeting, emergency support";

export function defaultBannerNote(): string {
  return BANNER;
}
