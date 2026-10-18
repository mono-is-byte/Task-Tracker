/**
 * The app-wide "wherever users are picked" label format:
 *
 *     "Name - Designation"      e.g. "Monowarul Islam - Project Manager"
 *
 * The designation is the live name of the role the user's `designation` field
 * points at (Roles & Permissions) — renames show up here automatically. Users
 * without a designation fall back to their project role names, so the label
 * never renders "undefined"/"null"; with neither, the bare name is used.
 *
 * Duplicate labels for one person are collapsed: whitespace is normalized and
 * the comparison is case-insensitive, so a project role that has the same name
 * as the designation ("Developer (Developer)") is shown only once, and the same
 * designation can never appear twice in one list entry.
 */
export interface MemberLabelInput {
  name: string;
  roleNames?: string[];
  roleName?: string;
  designationName?: string | null;
}

/** Case/whitespace-insensitive key used to detect duplicate labels. */
export function labelKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Display normalization: trim + collapse inner whitespace. */
function tidy(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * One display entry per distinct label part: the designation when the user has
 * one, otherwise their project role names (de-duplicated). Suffixes like
 * "(inactive)" are NOT added here — callers that render pickers should use
 * `userOptionLabel` so the canonical format stays "Name - Designation".
 */
export function memberLabel(m: MemberLabelInput): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    if (!raw) return;
    const text = tidy(raw);
    if (!text || seen.has(labelKey(text))) return;
    seen.add(labelKey(text));
    parts.push(text);
  };

  push(m.designationName);
  if (parts.length === 0) {
    for (const r of m.roleNames ?? []) push(r);
    if (parts.length === 0) push(m.roleName);
  }

  return parts.length > 0 ? `${m.name} - ${parts.join(", ")}` : m.name;
}

/**
 * Picker variant of `memberLabel`: appends "(inactive)" for deactivated (but
 * not deleted) accounts, so a selectable-but-disabled user is obvious.
 */
export function userOptionLabel(m: MemberLabelInput & { active?: boolean | null }): string {
  const base = memberLabel(m);
  return m.active === false ? `${base} (inactive)` : base;
}

/**
 * Drop role names that merely repeat the designation (case/whitespace
 * differences count) — used where designation and roles are rendered as
 * separate chips, so one person never shows the same label twice.
 */
export function rolesWithoutDesignation(roleNames: string[], designationName?: string | null): string[] {
  if (!designationName) return roleNames;
  const key = labelKey(designationName);
  return roleNames.filter((r) => labelKey(r) !== key);
}
