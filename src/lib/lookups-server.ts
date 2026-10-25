import type { PrismaClient } from "@prisma/client";
import {
  CLEAR_ISSUE_TYPE,
  ISSUETYPE_COLOR_DEFAULT,
  LOOKUP_NAME_MAX,
  PRIORITY_COLOR_DEFAULT,
  PRIORITY_LEVEL_DEFAULT,
  isHexColor,
  lookupKindLabel,
  lookupNameKey,
  normalizeLookupName,
  validPriorityLevel,
  type LookupKind,
} from "./lookups";

/**
 * Server rules for the per-project Priorities & issue types lookups (managed
 * from project Settings; the caller holds `manage_workflow`, enforced by the
 * route).
 *
 * Tasks reference a priority (required) and optionally an issue type by id, so
 * a rename or recolour is a single-row update that every task picks up.
 * Deleting an option that tasks still use is refused (`in_use`) until the
 * caller names a replacement — tasks are then moved in one bulk update and get
 * an activity line each ("priority: Medium → High"), and an issue type can also
 * be cleared instead of replaced. Task records are never broken, never left
 * pointing at a deleted row.
 */

type LookupFailureCode = "invalid" | "duplicate" | "not_found" | "in_use" | "last_priority";

export interface LookupFailure {
  ok: false;
  code: LookupFailureCode;
  message: string;
  /** Set with code "in_use": how many tasks still reference the option. */
  used?: number;
}

interface PriorityRow {
  id: string;
  name: string;
  level: number;
  color: string;
}

interface IssueTypeRow {
  id: string;
  name: string;
  color: string;
}

export interface LookupInput {
  name?: string;
  level?: number;
  color?: string;
}

function invalid(message: string): LookupFailure {
  return { ok: false, code: "invalid", message };
}

function duplicate(kind: LookupKind): LookupFailure {
  return {
    ok: false,
    code: "duplicate",
    message: `A ${lookupKindLabel(kind).toLowerCase()} with that name already exists.`,
  };
}

/** Case-insensitive name check (SQLite `=` is case-sensitive; compare in JS). */
async function nameTaken(
  client: PrismaClient,
  projectId: string,
  kind: LookupKind,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows =
    kind === "priority"
      ? await client.priority.findMany({ where: { projectId }, select: { id: true, name: true } })
      : await client.issueType.findMany({ where: { projectId }, select: { id: true, name: true } });
  const key = lookupNameKey(name);
  return rows.some((r) => r.id !== exceptId && lookupNameKey(r.name) === key);
}

/** Validate + normalise the shared fields; returns the writable data or a failure. */
async function buildData(
  client: PrismaClient,
  projectId: string,
  kind: LookupKind,
  input: LookupInput,
  exceptId?: string,
): Promise<{ ok: true; data: Record<string, unknown> } | LookupFailure> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = normalizeLookupName(input.name);
    if (!name) return invalid(`${lookupKindLabel(kind)} name is required.`);
    if (name.length > LOOKUP_NAME_MAX) {
      return invalid(`${lookupKindLabel(kind)} names are limited to ${LOOKUP_NAME_MAX} characters.`);
    }
    if (await nameTaken(client, projectId, kind, name, exceptId)) return duplicate(kind);
    data.name = name;
  }
  if (input.color !== undefined) {
    if (!isHexColor(input.color)) return invalid("Pick a colour as a #rrggbb hex value.");
    data.color = input.color;
  }
  if (input.level !== undefined) {
    if (kind !== "priority") return invalid("Issue types have no level.");
    if (!validPriorityLevel(input.level)) return invalid("Priority level must be a whole number between 0 and 99.");
    data.level = input.level;
  }
  return { ok: true, data };
}

export type CreateLookupResult =
  | { ok: true; priority: PriorityRow; issueType?: never }
  | { ok: true; issueType: IssueTypeRow; priority?: never }
  | LookupFailure;

export async function createLookup(
  client: PrismaClient,
  projectId: string,
  kind: LookupKind,
  input: LookupInput,
): Promise<CreateLookupResult> {
  const built = await buildData(client, projectId, kind, input);
  if (!built.ok) return built;
  const data = built.data;
  try {
    if (kind === "priority") {
      const priority = await client.priority.create({
        data: {
          projectId,
          name: data.name as string,
          level: (data.level as number | undefined) ?? PRIORITY_LEVEL_DEFAULT,
          color: (data.color as string | undefined) ?? PRIORITY_COLOR_DEFAULT,
        },
      });
      return { ok: true, priority };
    }
    const issueType = await client.issueType.create({
      data: {
        projectId,
        name: data.name as string,
        color: (data.color as string | undefined) ?? ISSUETYPE_COLOR_DEFAULT,
      },
    });
    return { ok: true, issueType };
  } catch {
    // Unique constraint (projectId, name) lost a race with the check above.
    return duplicate(kind);
  }
}

export type UpdateLookupResult =
  | { ok: true; priority: PriorityRow; issueType?: never }
  | { ok: true; issueType: IssueTypeRow; priority?: never }
  | LookupFailure;

export async function updateLookup(
  client: PrismaClient,
  projectId: string,
  kind: LookupKind,
  id: string,
  patch: LookupInput,
): Promise<UpdateLookupResult> {
  const built = await buildData(client, projectId, kind, patch, id);
  if (!built.ok) return built;
  try {
    if (kind === "priority") {
      const existing = await client.priority.findFirst({ where: { id, projectId } });
      if (!existing) return { ok: false, code: "not_found", message: "Priority not found." };
      const priority = Object.keys(built.data).length
        ? await client.priority.update({ where: { id }, data: built.data })
        : existing;
      return { ok: true, priority };
    }
    const existing = await client.issueType.findFirst({ where: { id, projectId } });
    if (!existing) return { ok: false, code: "not_found", message: "Issue type not found." };
    const issueType = Object.keys(built.data).length
      ? await client.issueType.update({ where: { id }, data: built.data })
      : existing;
    return { ok: true, issueType };
  } catch {
    return duplicate(kind);
  }
}

export interface RemoveLookupResult {
  deleted: boolean;
  moved: number;
}

/**
 * Delete a priority / issue type.
 *
 * `moveToId`:
 *  - priority: the priority that receives the tasks (required when tasks exist;
 *    the only priority of a project can never be deleted — tasks need one);
 *  - issue type: another type id, or CLEAR_ISSUE_TYPE to empty Task.typeId.
 *
 * Without `moveToId` a used option is refused with code "in_use" so the UI can
 * ask where the tasks should go before anything is written.
 */
export async function removeLookup(
  client: PrismaClient,
  projectId: string,
  kind: LookupKind,
  id: string,
  moveToId: string | null,
  actorId: string | null,
): Promise<{ ok: true; result: RemoveLookupResult } | LookupFailure> {
  const row =
    kind === "priority"
      ? await client.priority.findFirst({ where: { id, projectId }, select: { id: true, name: true } })
      : await client.issueType.findFirst({ where: { id, projectId }, select: { id: true, name: true } });
  if (!row) return { ok: false, code: "not_found", message: `${lookupKindLabel(kind)} not found.` };

  if (kind === "priority") {
    const total = await client.priority.count({ where: { projectId } });
    if (total <= 1) {
      return {
        ok: false,
        code: "last_priority",
        message: "This is the project's only priority — tasks always need one, so it cannot be deleted.",
      };
    }
  }

  const field = kind === "priority" ? "priorityId" : "typeId";
  const used = await client.task.count({ where: { projectId, [field]: id } });
  let moved = 0;

  if (used > 0) {
    let data: Record<string, unknown>;
    let afterName: string;
    if (kind === "priority") {
      if (!moveToId) {
        return {
          ok: false,
          code: "in_use",
          message: `Priority still has ${used} task(s). Move them first.`,
          used,
        };
      }
      const target = await client.priority.findFirst({
        where: { id: moveToId, projectId },
        select: { id: true, name: true },
      });
      if (!target || target.id === id) return invalid("Pick a different priority to move the tasks to.");
      data = { priorityId: target.id };
      afterName = target.name;
    } else if (moveToId === CLEAR_ISSUE_TYPE) {
      data = { typeId: null };
      afterName = "No issue type";
    } else {
      if (!moveToId) {
        return {
          ok: false,
          code: "in_use",
          message: `Issue type still has ${used} task(s). Move them first.`,
          used,
        };
      }
      const target = await client.issueType.findFirst({
        where: { id: moveToId, projectId },
        select: { id: true, name: true },
      });
      if (!target || target.id === id) return invalid("Pick a different issue type to move the tasks to.");
      data = { typeId: target.id };
      afterName = target.name;
    }

    const tasks = await client.task.findMany({ where: { projectId, [field]: id }, select: { id: true } });
    await client.task.updateMany({ where: { projectId, [field]: id }, data });
    moved = tasks.length;
    // Keep each task's history truthful: the field really changed because the
    // option was deleted (same shape the drawer renders for manual edits).
    if (actorId && tasks.length > 0) {
      const fieldName = kind === "priority" ? "priority" : "type";
      await client.activity.createMany({
        data: tasks.map((t) => ({
          taskId: t.id,
          actorId,
          action: "task.updated",
          field: fieldName,
          before: row.name,
          after: afterName,
        })),
      });
    }
  }

  if (kind === "priority") await client.priority.delete({ where: { id } });
  else await client.issueType.delete({ where: { id } });
  return { ok: true, result: { deleted: true, moved } };
}
