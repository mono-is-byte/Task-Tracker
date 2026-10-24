import type { PrismaClient } from "@prisma/client";

export type Db = PrismaClient;

/**
 * PHASE 6a — audit retention.
 *
 * The Audit Log is a *display* feed: it answers "what just happened", not "what
 * happened historically". Keeping it bounded (newest 25 rows) keeps the table,
 * and the /admin/audit page, instant forever.
 *
 * Tables that are deliberately NOT capped: `Activity` (assignment/status
 * history for a task — that IS history), `TaskStageTime`, `Comment`,
 * `Notification`, tasks and everything else. `LoginAttempt` is pruned by age
 * (24h) elsewhere because the 5-failures/15-minute lockout needs the window.
 */
export const AUDIT_RETENTION = 25;

/**
 * Trim the audit table to the newest {@link AUDIT_RETENTION} rows.
 *
 * Serverless hosts have no cron, so this runs inline right after an insert. It
 * answers with the exact ids to KEEP rather than comparing timestamps, so rows
 * sharing a millisecond can never make it keep more than the cap. Safe under
 * concurrent writes: every writer keeps its own just-inserted row.
 *
 * Best-effort by design — a failed cleanup must never fail the audited action,
 * so errors are swallowed on purpose.
 */
export async function pruneAuditLog(client: Db): Promise<void> {
  try {
    const keep = await client.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: AUDIT_RETENTION,
      select: { id: true },
    });
    if (keep.length < AUDIT_RETENTION) return;
    await client.auditLog.deleteMany({ where: { id: { notIn: keep.map((r) => r.id) } } });
  } catch {
    // Never bubble: pruning is housekeeping, the write itself already succeeded.
  }
}

/**
 * Write one audit row and prune the table back to the retention cap.
 *
 * PHASE 6b: callers must not call this when nothing changed — "no change = no
 * audit row". Store a small `{ field: [old, new] }` diff as `meta` so the page
 * can summarise it. Never pass passwords, tokens or hashes.
 */
export async function audit(
  client: Db,
  opts: {
    actorId?: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    meta?: unknown;
    ip?: string;
  },
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: opts.actorId ?? null,
      action: opts.action,
      entity: opts.entity ?? null,
      entityId: opts.entityId ?? null,
      meta: JSON.stringify(opts.meta ?? {}),
      ip: opts.ip ?? null,
    },
  });
  await pruneAuditLog(client);
}
