import type { PrismaClient } from "@prisma/client";
import { publish } from "./events";
import { safeObj } from "./permissions";

/**
 * Automation engine. Triggers: status_changed | task_created | task_assigned | task_reopened.
 * Condition: { field?, equals?, in?, hasAssignee?... } (empty = always).
 * Action: { set?: {field: value|"today"|"null"}, notify?: {user: "assignee"|"testedBy", title, body} }
 */
export interface AutomationContext {
  projectId: string;
  taskId: string;
  trigger: string;
  actorId?: string;
  task: Record<string, unknown>;
  prev?: Record<string, unknown>;
}

function condMatches(condition: Record<string, unknown>, ctx: AutomationContext): boolean {
  if (!condition || Object.keys(condition).length === 0) return true;
  const task = ctx.task;
  for (const [key, expected] of Object.entries(condition)) {
    if (key === "toCategory") {
      if ((task as Record<string, unknown>).statusCategory !== expected) return false;
      continue;
    }
    if (key === "toStatus") {
      if (task.statusName !== expected) return false;
      continue;
    }
    if (key === "hasAssignee") {
      if (Boolean(task.assigneeId) !== Boolean(expected)) return false;
      continue;
    }
    if (key === "fromCategory") {
      if ((ctx.prev as Record<string, unknown> | undefined)?.statusCategory !== expected) return false;
      continue;
    }
    if (task[key] !== expected) return false;
  }
  return true;
}

export async function runAutomation(client: PrismaClient, ctx: AutomationContext): Promise<string[]> {
  const rules = await client.automationRule.findMany({
    where: { projectId: ctx.projectId, enabled: true, trigger: ctx.trigger },
    orderBy: { position: "asc" },
  });
  const fired: string[] = [];
  for (const rule of rules) {
    const condition = safeObj(rule.condition);
    const action = safeObj(rule.action);
    if (!condMatches(condition, ctx)) continue;
    const set = (action.set ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(set)) {
      if (value === "today") updates[field] = new Date();
      else if (value === "null") updates[field] = null;
      else updates[field] = value;
    }
    if (Object.keys(updates).length > 0) {
      await client.task.update({ where: { id: ctx.taskId }, data: updates as never });
    }
    const notify = action.notify as { user?: string; title?: string; body?: string } | undefined;
    if (notify?.user) {
      const targetId =
        notify.user === "assignee" ? (ctx.task.assigneeId as string | null) :
        notify.user === "testedBy" ? (ctx.task.testedById as string | null) : null;
      if (targetId) {
        await client.notification.create({
          data: {
            userId: targetId, kind: ctx.trigger,
            title: notify.title ?? rule.name,
            body: notify.body ?? null,
            link: `/p/${ctx.projectId}/board?task=${ctx.taskId}`,
          },
        });
      }
    }
    fired.push(rule.name);
  }
  if (fired.length > 0) publish(ctx.projectId, "automation", { taskId: ctx.taskId, fired });
  return fired;
}

/** Built-in default rules shipped per project (stored as automation rules so Admins can edit/disable). */
export function defaultAutomationRules() {
  return [
    {
      name: "Done sets End Date = today",
      trigger: "status_changed",
      condition: { toCategory: "done" },
      action: { set: { endDate: "today" } },
    },
    {
      name: "In Progress sets Start Date = today when empty",
      trigger: "status_changed",
      condition: { toCategory: "inprogress", startDate: null },
      action: { set: { startDate: "today" } },
    },
    {
      name: "In Testing notifies Tested By",
      trigger: "status_changed",
      condition: { toStatus: "In Testing" },
      action: { notify: { user: "testedBy", title: "Ready for testing", body: "A task was moved to In Testing." } },
    },
    {
      name: "Re-open notifies Assignee and clears End Date",
      trigger: "status_changed",
      condition: { toStatus: "Re-open" },
      action: {
        set: { endDate: "null" },
        notify: { user: "assignee", title: "Task re-opened", body: "A task was re-opened." },
      },
    },
  ];
}
