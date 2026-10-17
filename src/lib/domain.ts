export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

export function isFibonacci(n: number): boolean {
  return FIBONACCI.includes(n);
}

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
  storyTitle?: string | null;
  epicName?: string | null;
  gitBranch?: string | null;
  key?: string;
}): string {
  return [t.key ?? "", t.title, t.description ?? "", t.storyTitle ?? "", t.epicName ?? "", t.gitBranch ?? ""].join("\n");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Count working days (inclusive) in [start, end] given weekday set (0=Sun..6=Sat) and holiday ISO dates. */
export function workingDaysBetween(start: Date, end: Date, workingDays: number[], holidays: string[] = []): number {
  const s = startOfDay(new Date(start)).getTime();
  const e = startOfDay(new Date(end)).getTime();
  if (e < s) return 0;
  const hol = new Set(holidays);
  let count = 0;
  for (let t = s; t <= e; t += DAY_MS) {
    const d = new Date(t);
    if (!workingDays.includes(d.getDay())) continue;
    if (hol.has(d.toISOString().slice(0, 10))) continue;
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
): number {
  const days = workingDaysBetween(start, end, workingDays, holidays);
  return Math.round(memberHoursPerDay.reduce((a, b) => a + b, 0) * days * 100) / 100;
}

export interface CapacityReport {
  plannedHours: number;
  plannedPoints: number;
  capacityHours: number;
  over: boolean;
  overflow: number;
}

export function capacityReport(
  tasks: { estHours?: number | null; storyPoints?: number | null }[],
  capacityHours: number,
): CapacityReport {
  const plannedHours = Math.round(tasks.reduce((a, t) => a + (t.estHours ?? 0), 0) * 100) / 100;
  const plannedPoints = tasks.reduce((a, t) => a + (t.storyPoints ?? 0), 0);
  return {
    plannedHours,
    plannedPoints,
    capacityHours,
    over: plannedHours > capacityHours,
    overflow: Math.round((plannedHours - capacityHours) * 100) / 100,
  };
}

/** CSV/XLSX columns matching the Excel sheet so the current sheet imports directly. */
export const TASK_CSV_COLUMNS = [
  "SL",
  "Epic",
  "User Story",
  "Task title",
  "Story Points",
  "Est. Hours",
  "Est. Days",
  "Description",
  "Priority",
  "Status",
  "Assignee",
  "Start Date",
  "End Date",
  "Remarks",
  "Git Branch",
  "Tested By",
  "Dependency",
  "Feedback",
] as const;

export type CsvRow = Record<string, string>;

const BANNER = "Tasks time may change depending on meeting, emergency support";

export function defaultBannerNote(): string {
  return BANNER;
}
