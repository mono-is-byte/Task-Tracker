import type { PrismaClient } from "@prisma/client";
import { updateTask, type TaskContext } from "./tasks";

/**
 * Phase 3 (server-only): removing a Kanban column (status) that still holds tasks.
 * The caller must hold `manage_workflow` (Admin/PM) — enforced by the route.
 * Tasks are moved one by one via `updateTask`, so activity, notifications and
 * automations behave exactly like a normal status change. Phase 1: each move is
 * subject to the SAME transition rules as a manual move — only a user with the
 * `bypass_transitions` flag (Project Manager / Super Admin) can relocate tasks
 * through an otherwise-unconfigured pair.
 */

export interface RemoveStatusResult {
  deleted: boolean;
  moved: number;
}

export async function removeStatus(
  client: PrismaClient,
  ctx: TaskContext,
  statusId: string,
  moveToId: string | null,
): Promise<RemoveStatusResult> {
  const status = await client.status.findFirst({
    where: { id: statusId, projectId: ctx.projectId },
    select: { id: true },
  });
  if (!status) throw new Error("Status not found.");
  if (moveToId) {
    if (moveToId === statusId) throw new Error("Unknown target status.");
    const target = await client.status.findFirst({
      where: { id: moveToId, projectId: ctx.projectId },
      select: { id: true },
    });
    if (!target) throw new Error("Unknown target status.");
  }

  let moved = 0;
  const used = await client.task.count({ where: { statusId, projectId: ctx.projectId } });
  if (used > 0) {
    if (!moveToId) throw new Error(`Status still has ${used} task(s). Move them first.`);
    const tasks = await client.task.findMany({
      where: { statusId, projectId: ctx.projectId },
      select: { id: true },
    });
    for (const t of tasks) {
      await updateTask(client, ctx, t.id, { statusId: moveToId });
      moved += 1;
    }
    const remaining = await client.task.count({ where: { statusId, projectId: ctx.projectId } });
    if (remaining > 0) throw new Error(`Could not move ${remaining} task(s) to the target status.`);
  }

  await client.statusTransition.deleteMany({
    where: { projectId: ctx.projectId, OR: [{ fromId: statusId }, { toId: statusId }] },
  });
  // StatusDesignationTag rows cascade with the status (FK onDelete: Cascade).
  await client.status.deleteMany({ where: { id: statusId, projectId: ctx.projectId } });
  return { deleted: true, moved };
}
