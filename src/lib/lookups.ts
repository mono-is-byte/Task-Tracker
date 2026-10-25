/**
 * Priorities & issue types are per-project lookups that tasks reference by id
 * (Task.priorityId is required, Task.typeId is optional). The naming and
 * validation rules live here so create / edit / delete (API routes + the
 * Settings page + the tests) all share one definition instead of drifting.
 */

export type LookupKind = "priority" | "issuetype";

export const LOOKUP_NAME_MAX = 40;
const PRIORITY_LEVEL_MIN = 0;
const PRIORITY_LEVEL_MAX = 99;
export const PRIORITY_LEVEL_DEFAULT = 3;
export const PRIORITY_COLOR_DEFAULT = "#94a3b8";
export const ISSUETYPE_COLOR_DEFAULT = "#6366f1";

/**
 * Sentinel sent as `moveToId` when deleting an issue type: the tasks that used
 * it get an empty issue type (Task.typeId is nullable) instead of another type.
 */
export const CLEAR_ISSUE_TYPE = "__none__";

/** Human label used in messages ("Priority name is required."). */
export function lookupKindLabel(kind: LookupKind): string {
  return kind === "priority" ? "Priority" : "Issue type";
}

/** Trim + collapse inner whitespace (a name is never stored with stray spaces). */
export function normalizeLookupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Case/whitespace-insensitive key used for duplicate detection. */
export function lookupNameKey(name: string): string {
  return normalizeLookupName(name).toLowerCase();
}

/** Only #rrggbb hex values are accepted (the colour picker emits exactly that). */
export function isHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

/** Priority "level" orders the list (higher level sorts first) — whole 0..99. */
export function validPriorityLevel(level: unknown): level is number {
  return (
    typeof level === "number" &&
    Number.isInteger(level) &&
    level >= PRIORITY_LEVEL_MIN &&
    level <= PRIORITY_LEVEL_MAX
  );
}
