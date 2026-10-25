import type { Prisma, PrismaClient } from "@prisma/client";
import { publish } from "./events";
import { canDo } from "./permissions";
import type { TaskContext } from "./tasks";
import { isCountingRole } from "./timerState";

// Re-export the pure derivation (state machine, timerInfo) so existing server imports
// keep working; client-safe code should import from "./timerState" directly.
export * from "./timerState";

/**
 * Stage timer (round 2) — server-side bookkeeping.
 *
 * A TRACK column shows Start/Stop buttons; NONE shows nothing; FINAL (Done)
 * shows only the total. The client only ever sends "start" or "stop":
 *   - Start opens a TaskStageTime segment (allowed whenever the current column
 *     tracks time and no segment is open — including after a Stop or a move).
 *   - Stop closes the open segment and folds its seconds into totalSeconds.
 *   - Moving the task to another column auto-stops the open segment and never
 *     auto-starts one in the target column (the user presses Start there).
 *   - The clock never restarts or resets; startedAt is the first Start click.
 *   - The minutely sweep notifies the assignee once when a running segment
 *     passes dueAt (guarded by overdueNotifiedAt).
 */

/** Who may Start/Stop: the task's assignee, any PM (manage_workflow) or Admin. */
function canOperateTimer(task: { assigneeId: string | null }, ctx: TaskContext): boolean {
  if (task.assigneeId && task.assigneeId === ctx.userId) return true;
  return (
    ctx.membership.isSuperAdmin ||
    canDo(ctx.membership.perms, "manage_workflow") ||
    canDo(ctx.membership.perms, "manage_archive")
  );
}

const NOT_ALLOWED = "Only the task's assignee or a project manager can operate the timer.";

function taskLink(projectId: string, taskId: string): string {
  return `/p/${projectId}/board?task=${taskId}`;
}

/** Load a task of this project (or throw). */
async function loadTask(client: PrismaClient, ctx: TaskContext, taskId: string) {
  const task = await client.task.findFirst({
    where: { id: taskId, projectId: ctx.projectId },
    include: { status: true },
  });
  if (!task) throw new Error("Task not found.");
  return task;
}

/**
 * Press Start: opens a segment in the current TRACK column. Idempotent while
 * a segment is already open. Throws when the column does not track time.
 */
export async function startTimer(client: PrismaClient, ctx: TaskContext, taskId: string) {
  const task = await loadTask(client, ctx, taskId);
  if (!canOperateTimer(task, ctx)) throw new Error(NOT_ALLOWED);
  if (task.stageEnteredAt) return task; // already running — idempotent
  if (!isCountingRole(task.status.timerRole)) {
    throw new Error("This stage does not track time — there is nothing to start here.");
  }
  const now = new Date();
  await client.taskStageTime.create({
    data: { taskId: task.id, statusId: task.statusId, enteredAt: now },
  });
  const updated = await client.task.update({
    where: { id: task.id },
    data: { startedAt: task.startedAt ?? now, stageEnteredAt: now },
  });
  await client.activity.create({ data: { taskId: task.id, actorId: ctx.userId, action: "timer.started" } });
  publish(ctx.projectId, "task_updated", { id: task.id, changes: ["startedAt"] });
  return updated;
}

/** Press Stop: closes the open segment and folds its seconds into totalSeconds. */
export async function stopTimer(client: PrismaClient, ctx: TaskContext, taskId: string) {
  const task = await loadTask(client, ctx, taskId);
  if (!canOperateTimer(task, ctx)) throw new Error(NOT_ALLOWED);
  if (!task.stageEnteredAt) throw new Error("The timer is not running.");
  const now = new Date();
  const seconds = await closeOpenStage(client, task.id, now);
  const updated = await client.task.update({
    where: { id: task.id },
    data: { stageEnteredAt: null, totalSeconds: (task.totalSeconds ?? 0) + seconds },
  });
  await client.activity.create({ data: { taskId: task.id, actorId: ctx.userId, action: "timer.stopped" } });
  publish(ctx.projectId, "task_updated", { id: task.id, changes: ["timer"] });
  return updated;
}

/** Close the open stage segment (if any) and fold its seconds into totalSeconds. */
async function closeOpenStage(
  client: PrismaClient | Prisma.TransactionClient,
  taskId: string,
  now: Date,
): Promise<number> {
  const open = await client.taskStageTime.findFirst({ where: { taskId, leftAt: null } });
  if (!open) return 0;
  const seconds = Math.max(0, Math.round((now.getTime() - open.enteredAt.getTime()) / 1000));
  await client.taskStageTime.update({ where: { id: open.id }, data: { leftAt: now, seconds } });
  return seconds;
}

/**
 * Timer bookkeeping for a status change (called by updateTask). Returns the
 * Task columns to patch alongside the status change: closes the open segment
 * (auto-stop — never carry a running clock across columns), never opens one in
 * the target column (the user presses Start there), and keeps stoppedAt as the
 * Done time.
 */
export async function stageTransitionData(
  client: PrismaClient | Prisma.TransactionClient,
  task: {
    id: string;
    status: { timerRole: string };
    startedAt: Date | null;
    stageEnteredAt: Date | null;
    stoppedAt: Date | null;
    totalSeconds: number;
  },
  toStatus: { id: string; timerRole: string },
  now: Date,
): Promise<Record<string, unknown>> {
  let total = task.totalSeconds ?? 0;
  if (task.stageEnteredAt) total += await closeOpenStage(client, task.id, now);
  const data: Record<string, unknown> = { totalSeconds: total, stageEnteredAt: null };
  if (toStatus.timerRole === "FINAL") data.stoppedAt = now;
  else if (task.stoppedAt) data.stoppedAt = null; // re-opened: counting may resume
  return data;
}

/**
 * Server-side scheduler pass (called every minute by instrumentation):
 * a task whose segment is running past its dueAt notifies the assignee
 * exactly once, guarded by overdueNotifiedAt.
 */
export async function runTimerSweep(client: PrismaClient, now: Date = new Date()): Promise<{ notified: number }> {
  let notified = 0;
  const overDue = await client.task.findMany({
    where: {
      stageEnteredAt: { not: null },
      dueAt: { lte: now },
      overdueNotifiedAt: null,
      status: { timerRole: "TRACK" },
    },
    select: {
      id: true, projectId: true, serial: true, title: true, assigneeId: true,
      project: { select: { key: true } },
    },
  });
  for (const t of overDue) {
    try {
      if (t.assigneeId) {
        await client.notification.create({
          data: {
            userId: t.assigneeId, kind: "timer", title: "Task is overdue",
            body: `${t.project.key}-${t.serial}: ${t.title}`, link: taskLink(t.projectId, t.id),
          },
        });
        notified++;
      }
      await client.task.update({ where: { id: t.id }, data: { overdueNotifiedAt: now } });
      publish(t.projectId, "task_updated", { id: t.id, changes: ["timer"] });
    } catch {
      // one bad row must not stop the sweep
    }
  }
  return { notified };
}
