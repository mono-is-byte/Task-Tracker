import type { PrismaClient } from "@prisma/client";
import { ACTIONS, type Action, type FieldRule } from "./permissions";

export function sanitizePerms(input: Record<string, boolean>): Record<Action, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of ACTIONS) out[a] = input[a] === true;
  return out as Record<Action, boolean>;
}

export function sanitizeFields(input: Record<string, string>): Record<string, FieldRule> {
  const out: Record<string, FieldRule> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === "hidden" || v === "readonly" || v === "editable") out[k] = v;
  }
  return out;
}

/**
 * Roles & Permissions shows, per role, how many users hold it as their
 * DESIGNATION — i.e. the number of unique, non-deleted users whose
 * `User.designation` points at that role. It is deliberately NOT the number of
 * project-membership role links (`ProjectMemberRole`): the same user in three
 * projects with the same project role is still one user, and a user's project
 * roles are unrelated to their designation. Counting by `User.designation`
 * (a single column per user) can never count the same person twice, and a
 * designation change moves the user from the old count to the new one.
 */
export async function designationCounts(client: PrismaClient): Promise<Record<string, number>> {
  const rows = await client.user.groupBy({
    by: ["designation"],
    where: { deletedAt: null, designation: { not: null } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.designation) counts[row.designation] = row._count._all;
  }
  return counts;
}
