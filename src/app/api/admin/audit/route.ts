import { ok, requireAdmin } from "@/lib/api";
import { db } from "@/lib/db";
import { AUDIT_RETENTION } from "@/lib/audit";

/**
 * PHASE 6a — the Audit Log is a "latest events" feed, not an archive: it returns
 * the newest {@link AUDIT_RETENTION} rows and nothing older. The old
 * `take`/`cursor`/"load more" pagination was removed with the retention cap —
 * there is never a page 2 to fetch.
 *
 * PHASE 6b — rows render with a READABLE entity label ("user: Administrator",
 * "task: LVM-3 Letter view with attachments") instead of the raw cuid, because
 * an audit trail nobody can read is not an audit trail.
 */

/** Resolve `{ entity, entityId }` pairs into short human labels, batched per entity. */
async function entityLabels(rows: { entity: string | null; entityId: string | null }[]): Promise<Map<string, string>> {
  const wanted = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entity || !r.entityId) continue;
    const set = wanted.get(r.entity) ?? new Set<string>();
    set.add(r.entityId);
    wanted.set(r.entity, set);
  }
  const labels = new Map<string, string>();
  const key = (entity: string, id: string) => `${entity}:${id}`;
  const ids = (entity: string) => [...(wanted.get(entity) ?? [])];

  const userIds = ids("user");
  if (userIds.length) {
    for (const u of await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })) {
      labels.set(key("user", u.id), `user: ${u.name}`);
    }
  }
  const roleIds = ids("role");
  if (roleIds.length) {
    for (const r of await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })) {
      labels.set(key("role", r.id), `role: ${r.name}`);
    }
  }
  const projectIds = ids("project");
  if (projectIds.length) {
    for (const p of await db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, key: true, name: true } })) {
      labels.set(key("project", p.id), `project: ${p.key} ${p.name}`);
    }
  }
  const taskIds = ids("task");
  if (taskIds.length) {
    for (const t of await db.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, serial: true, title: true, project: { select: { key: true } } },
    })) {
      labels.set(key("task", t.id), `task: ${t.project.key}-${t.serial} ${t.title}`);
    }
  }
  const statusIds = ids("status");
  if (statusIds.length) {
    for (const s of await db.status.findMany({ where: { id: { in: statusIds } }, select: { id: true, name: true } })) {
      labels.set(key("status", s.id), `status: ${s.name}`);
    }
  }
  return labels;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || undefined;
  const entity = url.searchParams.get("entity") || undefined;
  const logs = await db.auditLog.findMany({
    where: { ...(action ? { action } : {}), ...(entity ? { entity } : {}) },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: AUDIT_RETENTION,
  });
  const labels = await entityLabels(logs);
  const actions = await db.auditLog.groupBy({ by: ["action"], _count: { action: true }, orderBy: { action: "asc" } });
  return ok({
    logs: logs.map((l) => ({
      id: l.id, action: l.action, entity: l.entity, entityId: l.entityId,
      entityLabel: l.entity && l.entityId ? labels.get(`${l.entity}:${l.entityId}`) ?? null : null,
      meta: l.meta, ip: l.ip, createdAt: l.createdAt,
      actor: l.actor ? { name: l.actor.name, email: l.actor.email } : null,
    })),
    limit: AUDIT_RETENTION,
    actions: actions.map((a) => a.action),
  });
}
