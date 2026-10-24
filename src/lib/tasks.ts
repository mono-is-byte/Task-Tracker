import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { audit, pruneAuditLog } from "./audit";
import { runAutomation } from "./automation";
import { recomputeProjectCompletion } from "./completion";
import { estDays, matchesSearch, taskSearchText } from "./domain";
import { publish, publishGlobal } from "./events";
import { filterVisibleNotes } from "./notes";
import { canBypassTransitions, canDo, canEditTask, fieldRule, safeArr, type FieldRuleMap, type Membership } from "./permissions";
import { stageTransitionData, timerInfo, type TimerFields } from "./timer";
import { canTransition, type TransitionRule } from "./workflow";

export const TaskInput = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20000).nullable().optional(),
  typeId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
  estHours: z.number().min(0).max(10000).nullable().optional(),
  rdTime: z.number().min(0).max(10000).nullable().optional(),
  loggedHours: z.number().min(0).max(10000).nullable().optional(),
  priorityId: z.string().optional(),
  statusId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  testedById: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  gitBranch: z.string().max(300).nullable().optional(),
  labels: z.array(z.string().max(50)).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  position: z.number().optional(),
});

export type TaskPatch = z.infer<typeof TaskInput>;

export interface TaskContext {
  projectId: string;
  projectKey: string;
  hoursPerDay: number;
  membership: Membership;
  userId: string;
  /** PHASE 6b: request IP so audit rows written inside this context carry it. */
  ip?: string;
}

function parseDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  return d;
}

export function serializeTask<T extends Record<string, unknown>>(prefix: string, hoursPerDay: number, t: T) {
  const est = t.estHours as number | null | undefined;
  const statusRole = (t.status as { timerRole?: string } | undefined)?.timerRole;
  const timer = timerInfo({ ...(t as TimerFields), statusRole });
  return {
    ...t,
    key: `${prefix}-${t.serial}`,
    estDays: estDays(est, hoursPerDay),
    labels: safeArr(t.labels as string),
    customValues: (() => { try { return JSON.parse((t.customValues as string) ?? "{}"); } catch { return {}; } })(),
    timerState: timer.state,
    timerStartedAt: timer.startedAt,
    timerWorkedMs: timer.workedMs,
    timerRemainingMs: timer.remainingMs,
    timerOverdueMs: timer.overdueMs,
  };
}

/**
 * Relations every task row carries. Board cards, table rows, timeline, drawer
 * and the client task store all render from this shape, so create/update
 * responses must match `listTasks` exactly: the store replaces its row with the
 * server response, and a bare transaction row (no `status`/`priority`/`key`)
 * crashed the table's row renderer and left stale status names after edits.
 */
const TASK_ROW_INCLUDE = {
  status: true, priority: true, type: true,
  assignee: { select: { id: true, name: true, username: true, avatarUrl: true } },
  // PHASE 4: current "assigned by" snapshot. `deletedAt` lets the UI mark a
  // since-deleted user as "(removed)" instead of pretending they are active.
  assignedBy: { select: { id: true, name: true, username: true, avatarUrl: true, deletedAt: true } },
  testedBy: { select: { id: true, name: true, username: true, avatarUrl: true } },
  epic: { select: { id: true, name: true, color: true } },
  // PHASE 11.3: notes travel with every task row (Board cards + Table column);
  // the drawer's detail response carries the same list. No per-task N+1.
  comments: {
    include: { author: { select: { id: true, name: true, deletedAt: true } } },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { comments: true, linksFrom: true, linksTo: true } },
} satisfies Prisma.TaskInclude;

/**
 * Phase 1: server-side field-rule enforcement. Which serialized keys each
 * canonical task field maps to — used to NULL hidden fields out of API
 * responses (the client must never receive data it may not read).
 */
const FIELD_RESPONSE_KEYS: Record<string, string[]> = {
  title: ["title"],
  description: ["description"],
  type: ["type", "typeId"],
  estHours: ["estHours"],
  rdTime: ["rdTime"],
  loggedHours: ["loggedHours"],
  priority: ["priority", "priorityId"],
  // `status` is never stripped: every view renders the column from it.
  status: ["status", "statusId"],
  // PHASE 4: the "assigned by" snapshot is part of the assignee field — when a
  // role may not read the assignee, it may not read who assigned them either.
  assignee: ["assignee", "assigneeId", "assignedBy", "assignedById", "assignedAt"],
  testedBy: ["testedBy", "testedById"],
  startDate: ["startDate"],
  endDate: ["endDate"],
  gitBranch: ["gitBranch"],
  labels: ["labels"],
  epic: ["epic", "epicId"],
  dependency: ["dependency"],
  remarks: ["remarks"],
  feedback: ["feedback"],
};

/**
 * Remove every field the role may not READ (rule = "hidden") from a serialized
 * task row. `status`/`statusId` are intentionally kept — hiding the column
 * would break every board/table renderer — and a hidden `custom:*` rule empties
 * the whole customValues bag.
 */
export function stripHiddenFields<T extends Record<string, unknown>>(row: T, fieldRules: FieldRuleMap | undefined): T {
  const rules = fieldRules ?? {};
  const out = row as Record<string, unknown>;
  for (const [field, rule] of Object.entries(rules)) {
    if (rule !== "hidden") continue;
    if (field === "status") continue;
    const keys = FIELD_RESPONSE_KEYS[field];
    if (keys) for (const k of keys) if (k in out) out[k] = null;
  }
  if (rules["custom:*"] === "hidden" && "customValues" in out) out.customValues = {};
  // PHASE 11.3: remarks/feedback obey their field rules too. A hidden kind is
  // removed from the notes payload and from the count the UI displays.
  if (Array.isArray(out.comments)) {
    const visible = filterVisibleNotes(out.comments as { kind: string }[], rules);
    out.comments = visible;
    const count = out._count as { comments?: number } | undefined;
    if (count && typeof count === "object") count.comments = visible.length;
  }
  return row;
}

/** The serialized task row every view renders (identical to `listTasks` rows). */
function serializeFullTask<T extends Record<string, unknown>>(row: T, ctx: TaskContext) {
  return serializeTask(ctx.projectKey, ctx.hoursPerDay, row) as T & Record<string, unknown>;
}

/** The authoritative, serialized row for one task — same shape as `listTasks`. */
async function fullTaskRow(client: PrismaClient, ctx: TaskContext, taskId: string) {
  const row = await client.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_ROW_INCLUDE });
  return stripHiddenFields(serializeFullTask(row as unknown as typeof row & Record<string, unknown>, ctx), ctx.membership.fieldRules);
}

/** Manager level for timer scheduling (Admin/PM). NOTE: this is NOT the
 *  workflow bypass — see `canBypassTransitions` in permissions.ts. */
export function managerLevel(m: Membership): boolean {
  return m.isSuperAdmin || canDo(m.perms, "manage_workflow") || canDo(m.perms, "manage_archive");
}

export interface TaskFilters {
  epicId?: string;
  statusId?: string;
  priorityId?: string;
  assigneeId?: string;
  assignedById?: string;
  testedById?: string;
  typeId?: string;
  search?: string;
  archived?: boolean; // true = only Done, false = only not-Done, undefined = all
  label?: string;
  take?: number;
  skip?: number;
}

export async function listTasks(client: PrismaClient, ctx: TaskContext, filters: TaskFilters) {
  const where: Record<string, unknown> = { projectId: ctx.projectId };
  for (const k of ["epicId", "statusId", "priorityId", "assigneeId", "testedById", "typeId"] as const) {
    if (filters[k]) where[k] = filters[k];
  }
  // PHASE 4: filter by who assigned the task; "none" = never/unknown assigner.
  if (filters.assignedById === "none") where.assignedById = null;
  else if (filters.assignedById) where.assignedById = filters.assignedById;
  if (filters.archived === true) where.status = { category: "done" };
  if (filters.archived === false) where.status = { category: { not: "done" } };
  if (filters.label) where.labels = { contains: `"${filters.label}"` };

  const take = Math.min(filters.take ?? 200, 1000);
  const [total, rows] = await Promise.all([
    client.task.count({ where: where as never }),
    client.task.findMany({
      where: where as never,
      include: TASK_ROW_INCLUDE,
      orderBy: [{ status: { position: "asc" } }, { position: "asc" }, { serial: "asc" }],
      take: filters.search ? 5000 : take,
      skip: filters.search ? 0 : (filters.skip ?? 0),
    }),
  ]);

  let tasks = rows;
  if (filters.search) {
    const q = filters.search;
    tasks = rows.filter((r) =>
      matchesSearch(
        taskSearchText({
          title: r.title, description: r.description,
          epicName: r.epic?.name,
          gitBranch: r.gitBranch, key: `${ctx.projectKey}-${r.serial}`,
        }),
        q,
      ),
    );
  }
  return {
    total: filters.search ? tasks.length : total,
    tasks: tasks.slice(0, take).map((t) =>
      stripHiddenFields(
        serializeTask(ctx.projectKey, ctx.hoursPerDay, t as unknown as Record<string, unknown>),
        ctx.membership.fieldRules,
      ),
    ),
  };
}

async function assertRefs(client: PrismaClient, projectId: string, patch: TaskPatch) {
  if (patch.statusId) {
    const s = await client.status.findFirst({ where: { id: patch.statusId, projectId } });
    if (!s) throw new Error("Unknown status for this project.");
  }
  if (patch.priorityId) {
    const p = await client.priority.findFirst({ where: { id: patch.priorityId, projectId } });
    if (!p) throw new Error("Unknown priority for this project.");
  }
  if (patch.typeId) {
    const t = await client.issueType.findFirst({ where: { id: patch.typeId!, projectId } });
    if (!t) throw new Error("Unknown issue type for this project.");
  }
  if (patch.epicId) {
    const epic = await client.epic.findFirst({ where: { id: patch.epicId, projectId } });
    if (!epic) throw new Error("Unknown epic for this project.");
  }
  for (const [field, label] of [["assigneeId", "Assignee"], ["testedById", "Tester"]] as const) {
    const id = patch[field];
    if (id) {
      // Any registered (non-deleted) user is assignable — project membership is
      // not required: the Users section is the source of truth for pickers, and
      // deactivated accounts stay usable so existing work keeps its owner.
      const u = await client.user.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
      if (!u || u.deletedAt) throw new Error(`${label} must be a registered user.`);
    }
  }
}

/**
 * Change request: interactive task creation is To Do-only. The POST
 * /api/projects/[id]/tasks endpoint (Board "+ Add Task", Table quick-add, and
 * any other client) resolves the initial status here, so a new task always
 * lands in the project's To Do status — category "todo", first by position —
 * even when a client sends a different statusId. Falls back to the first
 * status when a project has no To Do category. Bulk import keeps the file's
 * statuses and calls createTask directly, so it is unaffected.
 */
export async function defaultCreationStatusId(client: PrismaClient, projectId: string): Promise<string> {
  const status =
    (await client.status.findFirst({ where: { projectId, category: "todo" }, orderBy: { position: "asc" } })) ??
    (await client.status.findFirst({ where: { projectId }, orderBy: { position: "asc" } }));
  if (!status) throw new Error("Project has no statuses.");
  return status.id;
}

export async function createTask(client: PrismaClient, ctx: TaskContext, input: TaskPatch) {
  const { membership, userId, projectId } = ctx;
  if (!canDo(membership.perms, "create_task")) throw new Error("Role cannot create tasks.");
  if (!input.title?.trim()) throw new Error("Title is required.");
  const title = input.title.trim();
  if (input.dueAt !== undefined && !managerLevel(membership)) {
    throw new Error("Only managers can set the timer schedule.");
  }
  await assertRefs(client, projectId, input);

  const [defaultStatus, defaultPriority, defaultType] = await Promise.all([
    client.status.findFirst({ where: { projectId }, orderBy: { position: "asc" } }),
    client.priority.findFirst({ where: { projectId, name: "Medium" } }),
    client.issueType.findFirst({ where: { projectId, name: "Task" } }),
  ]);
  if (!defaultStatus || !defaultPriority) throw new Error("Project has no statuses/priorities.");

  // Phase 1: field-level rules are enforced on the SERVER for creation too.
  // Every provided field must be `editable` for the role; `hidden` and
  // `readonly` writes are rejected. `statusId`/`position` are exempt: the API
  // resolves the mandatory initial column (To Do) and the importer places rows
  // explicitly — a new task's starting column is not a "status change".
  for (const [patchKey, ruleKey] of Object.entries(FIELD_TO_RULE)) {
    if (patchKey === "statusId" || patchKey === "position") continue;
    const provided = (input as Record<string, unknown>)[patchKey];
    if (provided === undefined) continue;
    const rule = ruleKey === "custom" ? fieldRule(membership.fieldRules, "custom:*") : fieldRule(membership.fieldRules, ruleKey);
    if (rule !== "editable" && !membership.isSuperAdmin) {
      throw new Error(`Field "${ruleKey}" is ${rule} for role ${membership.roleName}.`);
    }
  }
  // estimates on create: need edit_estimates, or task lands with self (or unassigned)
  const setsEstimates = input.estHours !== undefined;
  const ownerId = input.assigneeId ?? null;
  if (setsEstimates && !canDo(membership.perms, "edit_estimates")) {
    if (!(canDo(membership.perms, "edit_task_own") && (ownerId === null || ownerId === userId))) {
      throw new Error("Role cannot set estimates on this task.");
    }
  }
  if (input.priorityId && !canDo(membership.perms, "change_priority")) {
    if (!(canDo(membership.perms, "edit_task_own") && (ownerId === null || ownerId === userId))) {
      throw new Error("Role cannot set priority on this task.");
    }
  }

  const count = await client.task.count({ where: { projectId } });
  // Step 5: the insert and the project-completion recompute share ONE
  // transaction; the realtime events fire only after the commit.
  const { task, completion } = await client.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId,
        serial: count + 1,
        typeId: input.typeId ?? defaultType?.id ?? null,
        title,
        description: input.description ?? null,
        epicId: input.epicId ?? null,
        estHours: input.estHours ?? null,
        rdTime: input.rdTime ?? 0,
        loggedHours: input.loggedHours ?? 0,
        priorityId: input.priorityId ?? defaultPriority.id,
        statusId: input.statusId ?? defaultStatus.id,
        assigneeId: input.assigneeId ?? null,
        // PHASE 4: derived, server-owned snapshot. `TaskInput` has no such keys,
        // so a client-supplied assignedById/assignedAt is stripped by zod and
        // can never be trusted from the request body.
        assignedById: input.assigneeId ? userId : null,
        assignedAt: input.assigneeId ? new Date() : null,
        testedById: input.testedById ?? null,
        startDate: parseDate(input.startDate) ?? null,
        endDate: parseDate(input.endDate) ?? null,
        dueAt: parseDate(input.dueAt) ?? null,
        gitBranch: input.gitBranch ?? null,
        labels: JSON.stringify(input.labels ?? []),
        customValues: JSON.stringify(input.customValues ?? {}),
        position: count,
      },
    });
    const completion = await recomputeProjectCompletion(tx, projectId);
    return { task: created, completion };
  });
  await client.activity.create({
    data: { taskId: task.id, actorId: userId, action: "task.created" },
  });
  if (task.assigneeId) {
    // PHASE 4: an assignment at creation time is part of the task's assignment
    // history too (before=null = "was unassigned").
    await client.activity.create({
      data: {
        taskId: task.id, actorId: userId, action: "task.assigned", field: "assigneeId",
        before: null, after: task.assigneeId,
      },
    });
  }
  const full = await client.task.findUniqueOrThrow({
    where: { id: task.id },
    include: TASK_ROW_INCLUDE,
  });
  await runAutomation(client, {
    projectId, taskId: task.id, trigger: "task_created", actorId: userId,
    task: { id: task.id, statusCategory: full.status.category, statusName: full.status.name, assigneeId: task.assigneeId, testedById: task.testedById },
  });
  if (task.assigneeId && task.assigneeId !== userId) {
    await client.notification.create({
      data: {
        userId: task.assigneeId, kind: "task_assigned", title: "Task assigned to you",
        body: task.title, link: `/p/${projectId}/board?task=${task.id}`,
      },
    });
  }
  publish(projectId, "task_created", { id: task.id });
  // Step 5: adding a task to a completed project moves it back to active —
  // recomputed inside the transaction above, announced (sidebar) after commit.
  if (completion.flipped) publishGlobal("projects_changed", { projectId, isCompleted: completion.isCompleted });
  // Board/table insert this row as-is (the store uses the response as the
  // authoritative row), so return the full serialized shape, not the bare tx row.
  return stripHiddenFields(
    serializeFullTask(full as unknown as typeof full & Record<string, unknown>, ctx),
    membership.fieldRules,
  );
}

const FIELD_TO_RULE: Record<string, string> = {
  title: "title", description: "description", typeId: "type",
  epicId: "epic",
  estHours: "estHours", rdTime: "rdTime", loggedHours: "loggedHours",
  priorityId: "priority", statusId: "status", assigneeId: "assignee", testedById: "testedBy",
  startDate: "startDate", endDate: "endDate", gitBranch: "gitBranch", labels: "labels",
  customValues: "custom", position: "status",
};

export async function updateTask(client: PrismaClient, ctx: TaskContext, taskId: string, input: TaskPatch) {
  const { membership, userId, projectId } = ctx;
  const task = await client.task.findFirst({
    where: { id: taskId, projectId },
    include: { status: true },
  });
  if (!task) throw new Error("Task not found.");

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const data: Record<string, unknown> = {};

  const newAssignee = input.assigneeId !== undefined ? input.assigneeId : task.assigneeId;
  const ownTask = task.assigneeId === userId || task.assigneeId === null || newAssignee === userId;

  // Status-only moves (incl. board reorder position) need change_status, not edit rights —
  // this is how QA advances testing without being able to edit task content.
  const patchKeys = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  // Phase 2: a status change may be bundled with an assignee pick (the "Assign to" step).
  const statusChanging = input.statusId !== undefined && input.statusId !== task.statusId;
  // Target status drives (a) the transition matrix and (b) the timer auto-stop on final statuses.
  const targetStatus = statusChanging
    ? await client.status.findFirst({ where: { id: input.statusId!, projectId } })
    : null;
  const isAssignStep = statusChanging && canDo(membership.perms, "change_status");
  const statusOnly =
    patchKeys.length > 0 &&
    patchKeys.every((k) => k === "statusId" || k === "position" || (k === "assigneeId" && isAssignStep));
  if (statusOnly && !canEditTask(membership, task.assigneeId, userId) && !canDo(membership.perms, "change_status")) {
    throw new Error("Role cannot edit this task.");
  }
  if (!statusOnly && !canEditTask(membership, task.assigneeId, userId)) {
    throw new Error("Role cannot edit this task.");
  }
  await assertRefs(client, projectId, input);

  // Timer due time is Admin/PM-only; startedAt/stoppedAt are never accepted here —
  // they change only through /tasks/[taskId]/timer and status changes.
  const isManager = managerLevel(membership);
  if (input.dueAt !== undefined && !isManager) {
    throw new Error("Only managers can set the timer schedule.");
  }

  // per-field authorization
  for (const [patchKey, ruleKey] of Object.entries(FIELD_TO_RULE)) {
    const v = (input as Record<string, unknown>)[patchKey];
    if (v === undefined) continue;
    const rule = ruleKey === "custom" ? fieldRule(membership.fieldRules, "custom:*") : fieldRule(membership.fieldRules, ruleKey);
    // The assign step may set the assignee even when that field is readonly for the role.
    const assignStepField = patchKey === "assigneeId" && isAssignStep;
    if (rule !== "editable" && !(membership.isSuperAdmin) && !assignStepField) {
      throw new Error(`Field "${ruleKey}" is ${rule} for role ${membership.roleName}.`);
    }
    if (patchKey === "statusId") {
      if (!canDo(membership.perms, "change_status")) throw new Error("Role cannot change status.");
      if (v !== task.statusId && !canBypassTransitions(membership)) {
        // Phase 1: the project's StatusTransition matrix is the ONLY way a
        // non-bypass user may change status. No forward-only rule and no
        // implicit allow: a missing A→B row means DENIED. Backward moves are
        // allowed only when an explicit transition row exists (e.g. Done→Re-open).
        const rows = await client.statusTransition.findMany({
          where: { projectId, fromId: task.statusId },
          select: { fromId: true, toId: true, roleIds: true, issueTypeIds: true },
        });
        const transitions: TransitionRule[] = rows.map((t) => ({
          fromId: t.fromId,
          toId: t.toId,
          roleIds: safeArr(t.roleIds),
          issueTypeIds: safeArr(t.issueTypeIds),
        }));
        const decision = canTransition({
          transitions,
          fromStatusId: task.statusId,
          toStatusId: String(v),
          roleIds: membership.roleIds,
          bypass: false,
          issueTypeId: task.typeId,
        });
        if (!decision.allowed) {
          throw new Error(
            `Moving "${task.status.name}" → "${targetStatus?.name ?? "that status"}" is not an allowed transition for your role.`,
          );
        }
      }
    }
    if (patchKey === "estHours" && v !== (task as Record<string, unknown>)[patchKey]) {
      if (!canDo(membership.perms, "edit_estimates") && !(canDo(membership.perms, "edit_task_own") && ownTask)) {
        throw new Error("Role cannot change estimates on this task.");
      }
    }
    if (patchKey === "priorityId" && v !== task.priorityId) {
      if (!canDo(membership.perms, "change_priority") && !(canDo(membership.perms, "edit_task_own") && ownTask)) {
        throw new Error("Role cannot change priority on this task.");
      }
    }
    if (patchKey === "assigneeId" && v !== task.assigneeId) {
      const claiming = task.assigneeId === null && v === userId;
      const releasing = v === null && task.assigneeId === userId;
      // Phase 2: reassignment outside a status change needs `assign` (Admin/PM);
      // everyone else may only assign as part of the status-change "Assign to" step.
      if (!canDo(membership.perms, "assign") && !(claiming || releasing) && !isAssignStep) {
        throw new Error("Role cannot assign/reassign tasks.");
      }
    }
  }

  // build update
  const scalars: Record<string, keyof TaskPatch> = {
    title: "title", description: "description", typeId: "typeId",
    epicId: "epicId", estHours: "estHours",
    rdTime: "rdTime", loggedHours: "loggedHours", priorityId: "priorityId", statusId: "statusId",
    assigneeId: "assigneeId", testedById: "testedById", gitBranch: "gitBranch", position: "position",
  };
  for (const [column, patchKey] of Object.entries(scalars)) {
    const v = input[patchKey];
    if (v === undefined) continue;
    const before = (task as unknown as Record<string, unknown>)[column];
    let after: unknown = v;
    if (typeof v === "string" && column === "title") after = v.trim();
    if (before !== after) {
      changes[column] = { before, after };
      data[column] = after;
    }
  }
  if (input.startDate !== undefined) {
    const after = parseDate(input.startDate);
    if (String(task.startDate ?? null) !== String(after ?? null)) {
      changes.startDate = { before: task.startDate, after };
      data.startDate = after;
    }
  }
  if (input.endDate !== undefined) {
    const after = parseDate(input.endDate);
    if (String(task.endDate ?? null) !== String(after ?? null)) {
      changes.endDate = { before: task.endDate, after };
      data.endDate = after;
    }
  }
  // Timer due time (Admin/PM-only — checked above).
  if (input.dueAt !== undefined) {
    const field = "dueAt" as const;
    const v = input[field];
    const after = parseDate(v);
    const before = (task as unknown as Record<string, unknown>)[field];
    if (String(before ?? null) !== String(after ?? null)) {
      changes[field] = { before, after };
      data[field] = after;
    }
  }
  if (input.labels !== undefined) {
    const after = JSON.stringify(input.labels);
    if (task.labels !== after) {
      changes.labels = { before: safeArr(task.labels), after: input.labels };
      data.labels = after;
    }
  }
  if (input.customValues !== undefined) {
    const after = JSON.stringify(input.customValues);
    if (task.customValues !== after) {
      changes.customValues = { before: task.customValues, after };
      data.customValues = after;
    }
  }

  // Step 4 + 5: the task update, the cumulative stage-timer bookkeeping (close
  // the open segment, fold in its seconds, auto-resume on START/TRACK, pause on
  // NONE, record the Done time on FINAL) and the project-completion recompute
  // all run in ONE transaction; realtime events fire only after the commit.
  const now = new Date();
  // PHASE 4: keep the "assigned by" snapshot in step with the assignee.
  // Reassigning stores the CURRENT user + timestamp; unassigning clears the
  // snapshot (the UI shows "—") while the full history stays in Activity rows.
  if (changes.assigneeId) {
    const toId = (changes.assigneeId.after as string | null) ?? null;
    data.assignedById = toId ? userId : null;
    data.assignedAt = toId ? now : null;
  }
  const result = await client.$transaction(async (tx) => {
    if (targetStatus) {
      const timerData = await stageTransitionData(tx, task, targetStatus, now);
      Object.assign(data, timerData);
    }
    if (Object.keys(data).length === 0) return null;
    const u = await tx.task.update({ where: { id: task.id }, data: data as never });
    const completion = changes.statusId ? await recomputeProjectCompletion(tx, projectId) : null;
    return { updated: u, completion };
  });
  if (!result) return fullTaskRow(client, ctx, task.id);
  const { updated, completion } = result;
  for (const [field, diff] of Object.entries(changes)) {
    // PHASE 4: an assignee change is its own history event ("assigned"/
    // "unassigned"), not a generic field edit — feeds render it with names.
    const assignEvent = field === "assigneeId";
    await client.activity.create({
      data: {
        taskId: task.id, actorId: userId,
        action: assignEvent ? "task.assigned" : "task.updated", field,
        before: diff.before == null ? null : String(diff.before)?.slice(0, 500),
        after: diff.after == null ? null : String(diff.after)?.slice(0, 500),
      },
    });
  }
  if (changes.assigneeId) {
    // PHASE 4: assigning is manager-relevant enough for the Audit Log (the
    // audit page's entity label already resolves task keys).
    await audit(client, {
      actorId: userId, action: "task.assign", entity: "task", entityId: task.id,
      meta: { from: changes.assigneeId.before ?? null, to: changes.assigneeId.after ?? null },
      ip: ctx.ip,
    });
  }

  if (changes.statusId) {
    const [from, to] = await Promise.all([
      client.status.findUnique({ where: { id: task.statusId } }),
      client.status.findUnique({ where: { id: updated.statusId } }),
    ]);
    const full = await client.task.findUniqueOrThrow({ where: { id: task.id } });
    await runAutomation(client, {
      projectId, taskId: task.id, trigger: "status_changed", actorId: userId,
      task: {
        id: task.id, statusCategory: to?.category, statusName: to?.name,
        assigneeId: full.assigneeId, testedById: full.testedById, startDate: full.startDate,
      },
      prev: { statusCategory: from?.category, statusName: from?.name },
    });
    await client.activity.create({
      data: {
        taskId: task.id, actorId: userId, action: "task.status",
        field: "status", before: from?.name ?? null, after: to?.name ?? null,
      },
    });
  }
  if (changes.assigneeId && updated.assigneeId && updated.assigneeId !== userId) {
    await client.notification.create({
      data: {
        userId: updated.assigneeId, kind: "task_assigned", title: "Task assigned to you",
        body: updated.title, link: `/p/${projectId}/board?task=${task.id}`,
      },
    });
  }

  publish(projectId, "task_updated", { id: task.id, changes: Object.keys(changes) });
  // Step 5: a status change may complete the project or move it back — the
  // recompute ran in the transaction above; announce the flip after commit.
  if (completion?.flipped) publishGlobal("projects_changed", { projectId, isCompleted: completion.isCompleted });
  // The store replaces the optimistic row with this response, so it must carry
  // the full serialized shape (status/priority/assignee/... refreshed) — not the
  // bare update result, which would leave a stale status chip on the board.
  return fullTaskRow(client, ctx, task.id);
}

export async function deleteTask(client: PrismaClient, ctx: TaskContext, taskId: string) {
  const { membership, userId, projectId } = ctx;
  if (!canDo(membership.perms, "delete_task")) throw new Error("Role cannot delete tasks.");
  const task = await client.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw new Error("Task not found.");
  // Step 5: delete + audit + completion recompute in ONE transaction.
  const completion = await client.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: taskId } });
    await tx.auditLog.create({
      data: {
        actorId: userId, action: "task.delete", entity: "task", entityId: taskId,
        meta: JSON.stringify({ title: task.title }), ip: ctx.ip ?? null,
      },
    });
    return recomputeProjectCompletion(tx, projectId);
  });
  // PHASE 6a: this row is written through the raw transaction client, so the
  // inline prune of `audit()` never runs — do it here, after commit (best-effort).
  await pruneAuditLog(client);
  publish(projectId, "task_deleted", { id: taskId });
  // Deleting the last open task may complete the project; deleting all tasks
  // keeps it active (0 tasks never counts as completed).
  if (completion.flipped) publishGlobal("projects_changed", { projectId, isCompleted: completion.isCompleted });
}

export function ctxFromLoad(
  project: { id: string; key: string; hoursPerDay: number },
  membership: Membership,
  userId: string,
  ip?: string,
): TaskContext {
  return { projectId: project.id, projectKey: project.key, hoursPerDay: project.hoursPerDay, membership, userId, ip };
}
