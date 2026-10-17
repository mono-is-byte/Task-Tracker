/**
 * Change request Phase 3: the app-wide "wherever users are picked" label format
 * "Name - Role1, Role2 (Designation)". Roles come from the member's project
 * membership (multiple roles joined); the designation is a plain job-title
 * label. Both parts are optional — missing pieces are simply omitted, and the
 * full string is also used as the tooltip where the row truncates.
 */
export interface MemberLabelInput {
  name: string;
  roleNames?: string[];
  roleName?: string;
  designationName?: string | null;
}

export function memberLabel(m: MemberLabelInput): string {
  const roles =
    m.roleNames && m.roleNames.length > 0
      ? m.roleNames.join(", ")
      : (m.roleName ?? "");
  const base = roles ? `${m.name} - ${roles}` : m.name;
  return m.designationName ? `${base} (${m.designationName})` : base;
}
