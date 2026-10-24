import type { PrismaClient } from "@prisma/client";

/**
 * Phase 1: workflow rules and "suggest designations" helpers.
 *
 * Role and designation are the SAME concept: both are rows in `Role`, and a
 * status suggests role IDS (never free text). Renaming a role therefore updates
 * every suggestion, and deleting a role removes its suggestions.
 */

/** One configured `StatusTransition` row, as stored in the database. */
export interface TransitionRule {
  fromId: string;
  toId: string;
  /** Empty = any project role may use this transition. */
  roleIds: string[];
  /** Empty = any issue type. */
  issueTypeIds: string[];
}

export interface TransitionContext {
  /** Every transition row of the project (already loaded once per request). */
  transitions: TransitionRule[];
  fromStatusId: string;
  toStatusId: string;
  /** Role ids the user holds IN THIS PROJECT. */
  roleIds: string[];
  /** Super Admin or a role flagged `bypass_transitions`. */
  bypass: boolean;
  issueTypeId?: string | null;
}

export interface TransitionDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * THE status-change rule. Used by the server (source of truth) and by the
 * client only to improve the drag-and-drop UX — the API re-checks it.
 *
 * - Same status: always allowed (no-op / reorder).
 * - Bypass (Super Admin, or a role with `bypass_transitions`): always allowed.
 * - Otherwise a transition row A→B must exist AND (its role list is empty OR
 *   the user holds at least one listed role in this project) AND its issue-type
 *   list is empty OR matches the task's type.
 * - No row = DENIED. There is no "forward-only" default and no implicit allow.
 */
export function canTransition(ctx: TransitionContext): TransitionDecision {
  if (ctx.fromStatusId === ctx.toStatusId) return { allowed: true };
  if (ctx.bypass) return { allowed: true };

  const rows = ctx.transitions.filter(
    (t) => t.fromId === ctx.fromStatusId && t.toId === ctx.toStatusId,
  );
  if (rows.length === 0) {
    return {
      allowed: false,
      reason: "This status transition is not configured for this project.",
    };
  }

  const roleRows = rows.filter(
    (t) => t.roleIds.length === 0 || t.roleIds.some((r) => ctx.roleIds.includes(r)),
  );
  if (roleRows.length === 0) {
    return {
      allowed: false,
      reason: "This status transition is not allowed for your role.",
    };
  }

  const typeRows = roleRows.filter(
    (t) =>
      t.issueTypeIds.length === 0 ||
      !ctx.issueTypeId ||
      t.issueTypeIds.includes(ctx.issueTypeId),
  );
  if (typeRows.length === 0) {
    return {
      allowed: false,
      reason: "This status transition is not allowed for this issue type.",
    };
  }

  return { allowed: true };
}

/**
 * Replace the roles a status SUGGESTS (Settings > Statuses, Admin/PM only — the
 * route enforces `manage_workflow`). Ids are de-duplicated and validated
 * against the Role table; unknown ids are ignored. Returns the saved role ids.
 */
export async function replaceStatusDesignations(
  client: PrismaClient,
  statusId: string,
  roleIds: string[],
): Promise<string[]> {
  const unique = [...new Set(roleIds.map((r) => r.trim()).filter(Boolean))];
  const existing = unique.length
    ? await client.role.findMany({ where: { id: { in: unique } }, select: { id: true } })
    : [];
  const valid = existing.map((r) => r.id);
  await client.statusDesignationTag.deleteMany({ where: { statusId } });
  if (valid.length > 0) {
    await client.statusDesignationTag.createMany({
      data: valid.map((roleId) => ({ statusId, roleId })),
    });
  }
  return valid;
}

export interface AssignCandidate {
  userId: string;
  name: string;
  /** Role ids the member holds in this project. */
  roleIds?: string[];
}

/**
 * Split project members for the status-change "Assign to" step: members holding
 * one of the roles the status suggests come first, everyone else follows as a
 * selectable alternative. Comparison is by role id, never by label text.
 */
export function suggestedForStatus<T extends AssignCandidate>(
  members: T[],
  suggestedRoleIds: string[],
): { suggested: T[]; others: T[] } {
  const wanted = new Set(suggestedRoleIds.filter(Boolean));
  const suggested: T[] = [];
  const others: T[] = [];
  for (const m of members) {
    const held = m.roleIds ?? [];
    if (wanted.size > 0 && held.some((r) => wanted.has(r))) suggested.push(m);
    else others.push(m);
  }
  return { suggested, others };
}
