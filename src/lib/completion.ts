import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Change request Phase 2 + Step 5: a project counts as "completed" when it has
 * at least one task and every task sits in a final (category "done") status.
 * Moving a task back out of done, adding a task, or deleting all tasks flips it
 * back — 0 tasks never counts as completed.
 *
 * Step 5: the recompute runs INSIDE the same server transaction as the task
 * create / status change / delete (the caller passes the transaction client),
 * so the flag can never go stale. Callers publish the realtime update only
 * after the commit.
 */
export interface CompletionResult {
  /** the flag actually changed in this call */
  flipped: boolean;
  /** the project's completion value after the recompute */
  isCompleted: boolean;
}

export async function recomputeProjectCompletion(
  client: PrismaClient | Prisma.TransactionClient,
  projectId: string,
): Promise<CompletionResult> {
  const [total, done] = await Promise.all([
    client.task.count({ where: { projectId } }),
    client.task.count({ where: { projectId, status: { category: "done" } } }),
  ]);
  const isCompleted = total > 0 && total === done;
  const res = await client.project.updateMany({
    where: { id: projectId, isCompleted: { not: isCompleted } },
    data: { isCompleted },
  });
  return { flipped: res.count > 0, isCompleted };
}
