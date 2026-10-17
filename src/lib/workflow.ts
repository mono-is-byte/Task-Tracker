import type { PrismaClient } from "@prisma/client";

/**
 * Step 1: free-text status → designation suggestion mapping.
 *
 * A designation is a plain job-title label typed by Admin/PM (no catalog).
 * The mapping is a SUGGESTION list only: it grants no permissions. Matching is
 * case-insensitive on trimmed text (internal whitespace collapsed), so
 * "QA Engineer", "qa engineer" and " QA  Engineer " all match.
 */

export const DESIGNATION_MAX = 60;

/** Trim + collapse whitespace + cap at 60 chars. */
export function normalizeDesignation(v: string): string {
  return v.trim().replace(/\s+/g, " ").slice(0, DESIGNATION_MAX);
}

/** Comparison key for case/space-insensitive matching. */
export function designationKey(v: string): string {
  return normalizeDesignation(v).toLowerCase();
}

/**
 * Replace the free-text designations suggested by a status (used by
 * Settings > Workflow, Admin/PM only — the route enforces `manage_workflow`).
 * Texts are normalized and case-insensitively deduplicated.
 */
export async function replaceStatusDesignations(
  client: PrismaClient,
  statusId: string,
  texts: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of texts) {
    const text = normalizeDesignation(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  await client.statusDesignationTag.deleteMany({ where: { statusId } });
  if (unique.length > 0) {
    await client.statusDesignationTag.createMany({
      data: unique.map((text) => ({ statusId, text })),
    });
  }
  return unique;
}

export interface AssignCandidate {
  userId: string;
  name: string;
  designationName?: string | null;
}

/**
 * Split project members for the status-change "Assign to" step:
 * members whose free-text designation matches the new status's tags come first
 * (suggested), everyone else follows as selectable alternatives.
 */
export function suggestedForStatus<T extends AssignCandidate>(
  members: T[],
  statusDesignationTexts: string[],
): { suggested: T[]; others: T[] } {
  const wanted = new Set(statusDesignationTexts.map(designationKey).filter(Boolean));
  const suggested: T[] = [];
  const others: T[] = [];
  for (const m of members) {
    if (m.designationName && wanted.has(designationKey(m.designationName))) suggested.push(m);
    else others.push(m);
  }
  return { suggested, others };
}
