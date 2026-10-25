import type { PrismaClient } from "@prisma/client";

export const ACTIONS = [
  "view_project",
  "create_task",
  "edit_task_all",
  "edit_task_own",
  "delete_task",
  "change_status",
  "edit_estimates",
  "change_priority",
  "assign",
  "manage_epics",
  "manage_fields",
  "manage_workflow",
  "manage_automation",
  "view_reports",
  "export",
  "import",
  "manage_members",
  "manage_archive",
  "comment",
  /**
   * Phase 1: the ONLY workflow bypass flag. A role holding it may move a task
   * to any status, ignoring the project's StatusTransition matrix. Set true
   * only for Project Manager. Deliberately a separate permission from
   * `manage_workflow` / `manage_archive` so editing the workflow definition does
   * not silently grant the right to bypass it.
   */
  "bypass_transitions",
] as const;

export type Action = (typeof ACTIONS)[number];

export type FieldRule = "hidden" | "readonly" | "editable";

/** Canonical task field keys for field-level permissions. */
export const TASK_FIELDS = [
  "title",
  "description",
  "type",
  "estHours",
  "rdTime",
  "loggedHours",
  "priority",
  "status",
  "assignee",
  "testedBy",
  "startDate",
  "endDate",
  "gitBranch",
  "labels",
  "epic",
  "dependency",
  "remarks",
  "feedback",
] as const;

type TaskField = (typeof TASK_FIELDS)[number];

export interface RoleDef {
  description: string;
  permissions: Partial<Record<Action, boolean>>;
  fieldRules: Partial<Record<TaskField | `custom:${string}`, FieldRule>>;
}

function allFields(rule: FieldRule): Partial<Record<TaskField, FieldRule>> {
  return Object.fromEntries(TASK_FIELDS.map((f) => [f, rule])) as Partial<Record<TaskField, FieldRule>>;
}

export const DEFAULT_ROLES: Record<string, RoleDef> = {
  "Project Manager": {
    description: "Manages projects they belong to: epics, estimates, workflow, automation, reports.",
    permissions: {
      view_project: true, create_task: true, edit_task_all: true, edit_task_own: true,
      delete_task: true, change_status: true, edit_estimates: true, change_priority: true,
      assign: true, manage_epics: true, manage_fields: true,
      manage_workflow: true, manage_automation: true, view_reports: true, export: true,
      import: true, manage_members: true, manage_archive: true, comment: true,
      bypass_transitions: true,
    },
    fieldRules: { ...allFields("editable") },
  },
  Developer: {
    description: "Works on assigned tasks. Cannot create tasks or change others' estimates unless granted.",
    permissions: {
      view_project: true, edit_task_own: true,
      change_status: true, view_reports: true, export: true, comment: true,
    },
    fieldRules: {
      ...allFields("readonly"),
      title: "editable", description: "editable", status: "editable",
      startDate: "editable", endDate: "editable", gitBranch: "editable",
      remarks: "editable", loggedHours: "editable", rdTime: "editable",
      labels: "editable", assignee: "editable",
    },
  },
  "QA / Tester": {
    description: "Tests development-done work, moves it through testing, writes feedback.",
    permissions: { view_project: true, change_status: true, view_reports: true, export: true, comment: true },
    fieldRules: {
      ...allFields("readonly"),
      status: "editable", testedBy: "editable", feedback: "editable", remarks: "editable",
    },
  },
  "Viewer / Stakeholder": {
    description: "Read-only access to boards, tables, reports and timeline.",
    permissions: { view_project: true, view_reports: true, export: true },
    fieldRules: { ...allFields("readonly") },
  },
};

export type Perms = Record<string, boolean>;
export type FieldRuleMap = Record<string, FieldRule>;

export function parsePerms(json: string | null | undefined): Perms {
  try {
    return json ? (JSON.parse(json) as Perms) : {};
  } catch {
    return {};
  }
}

/**
 * Parse stored field rules defensively. Phase 11 removed the `story` field; old
 * rows (or old clients) may still contain it, so unknown keys are dropped here
 * instead of reaching the role editor or a mutation check. `custom:*` covers
 * both the wildcard and per-custom-field keys.
 */
export function parseFieldRules(json: string | null | undefined): FieldRuleMap {
  try {
    const parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
    const known = new Set<string>([...TASK_FIELDS, "custom:*"]);
    const out: FieldRuleMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!known.has(key) && !key.startsWith("custom:")) continue;
      if (value === "hidden" || value === "readonly" || value === "editable") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function canDo(perms: Perms, action: Action): boolean {
  return perms[action] === true;
}

/**
 * Phase 1 (role = designation): the single, explicit workflow-bypass check.
 *
 * Only a Super Admin, or a user whose project role carries the
 * `bypass_transitions` permission flag, may move a task to ANY status. This is
 * intentionally NOT derived from `manage_workflow`, `manage_archive`, a role
 * NAME ("Project Manager"), or the user's designation text — those must never
 * grant a bypass (a Developer with `manage_workflow` is still bound by the
 * transition matrix, and renaming a role must not change permissions).
 */
export function canBypassTransitions(m: Pick<Membership, "isSuperAdmin" | "perms">): boolean {
  return m.isSuperAdmin || m.perms.bypass_transitions === true;
}

export function fieldRule(rules: FieldRuleMap, field: string): FieldRule {
  return rules[field] ?? "readonly";
}

export interface Membership {
  id: string;
  projectId: string;
  userId: string;
  /** All role ids held by this member in this project. */
  roleIds: string[];
  /** All role names held by this member in this project. */
  roleNames: string[];
  /** Convenience: comma-joined roleNames for display / legacy single-role checks. */
  roleName: string;
  isSuperAdmin: boolean;
  /** Union of every assigned role's permissions. */
  perms: Perms;
  /** Per field, the MOST permissive rule across all assigned roles. */
  fieldRules: FieldRuleMap;
}

/** Field-rule precedence: higher index wins. */
const RULE_RANK: Record<FieldRule, number> = { hidden: 0, readonly: 1, editable: 2 };

/** Union multiple roles into one permission + field-rule view. */
export function mergeRoles(roles: { id: string; name: string; permissions: string; fieldRules: string }[]): {
  roleIds: string[];
  roleNames: string[];
  roleName: string;
  perms: Perms;
  fieldRules: FieldRuleMap;
} {
  const perms: Perms = {};
  const fieldRules: FieldRuleMap = {};
  for (const r of roles) {
    for (const [a, v] of Object.entries(parsePerms(r.permissions))) if (v) perms[a] = true;
    for (const [f, rule] of Object.entries(parseFieldRules(r.fieldRules))) {
      const prev = fieldRules[f];
      if (prev === undefined || RULE_RANK[rule] > RULE_RANK[prev]) fieldRules[f] = rule;
    }
  }
  const roleIds = roles.map((r) => r.id);
  const roleNames = roles.map((r) => r.name);
  return { roleIds, roleNames, roleName: roleNames.join(", "), perms, fieldRules };
}

export async function getMembership(
  client: PrismaClient,
  userId: string,
  isSuperAdmin: boolean,
  projectId: string,
): Promise<Membership | null> {
  if (isSuperAdmin) {
    const all = Object.fromEntries(ACTIONS.map((a) => [a, true])) as Perms;
    const fields = Object.fromEntries(TASK_FIELDS.map((f) => [f, "editable"])) as FieldRuleMap;
    return { id: "superadmin", projectId, userId, roleIds: ["superadmin"], roleNames: ["Super Admin"], roleName: "Super Admin", isSuperAdmin: true, perms: all, fieldRules: fields };
  }
  const m = await client.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { roles: { include: { role: true }, orderBy: { role: { name: "asc" } } } },
  });
  if (!m) return null;
  const merged = mergeRoles(m.roles.map((l) => l.role));
  return {
    id: m.id, projectId, userId,
    roleIds: merged.roleIds, roleNames: merged.roleNames, roleName: merged.roleName,
    isSuperAdmin: false, perms: merged.perms, fieldRules: merged.fieldRules,
  };
}

/** Can this membership edit this task at all (before field checks)? */
export function canEditTask(m: Membership, assigneeId: string | null, userId: string): boolean {
  if (m.isSuperAdmin || canDo(m.perms, "edit_task_all")) return true;
  if (canDo(m.perms, "edit_task_own") && (assigneeId === userId || assigneeId === null)) return true;
  return false;
}

export interface TransitionCheck {
  fromId: string;
  toId: string;
  roleIds: string[];
  issueTypeIds: string[];
}

/** Pure check used by API + tests. Empty roleIds = any project role may use it.
 *  A member passes if ANY of their held roles is in the allowed list. */
export function isTransitionAllowed(
  t: TransitionCheck,
  roleIdOrIds: string | string[],
  isSuperAdmin: boolean,
  issueTypeId?: string | null,
): boolean {
  if (isSuperAdmin) return true;
  const held = Array.isArray(roleIdOrIds) ? roleIdOrIds : [roleIdOrIds];
  if (t.roleIds.length > 0 && !t.roleIds.some((r) => held.includes(r))) return false;
  if (t.issueTypeIds.length > 0 && issueTypeId && !t.issueTypeIds.includes(issueTypeId)) return false;
  return true;
}

/** True when the user holds `action` in at least one project (union of that project's roles).
 *  Used for global gates like "can create projects" (PM-level). */
export async function userHasGlobalAction(
  client: PrismaClient,
  userId: string,
  isSuperAdmin: boolean,
  action: Action,
): Promise<boolean> {
  if (isSuperAdmin) return true;
  const memberships = await client.projectMember.findMany({
    where: { userId },
    include: { roles: { include: { role: true } } },
  });
  return memberships.some((m) => mergeRoles(m.roles.map((l) => l.role)).perms[action] === true);
}

export function safeArr(json: string | null | undefined): string[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function safeObj(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = json ? JSON.parse(json) : {};
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
