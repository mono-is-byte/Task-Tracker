import { ok, requireAdmin } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || undefined;
  const entity = url.searchParams.get("entity") || undefined;
  const take = Math.min(Number(url.searchParams.get("take") ?? 100), 500);
  const cursor = url.searchParams.get("cursor") || undefined;
  const logs = await db.auditLog.findMany({
    where: { ...(action ? { action } : {}), ...(entity ? { entity } : {}) },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const next = logs.length > take ? logs[take].id : null;
  const page = logs.slice(0, take);
  const actions = await db.auditLog.groupBy({ by: ["action"], _count: { action: true }, orderBy: { action: "asc" } });
  return ok({
    logs: page.map((l) => ({
      id: l.id, action: l.action, entity: l.entity, entityId: l.entityId,
      meta: l.meta, ip: l.ip, createdAt: l.createdAt,
      actor: l.actor ? { name: l.actor.name, email: l.actor.email } : null,
    })),
    next,
    actions: actions.map((a) => a.action),
  });
}
