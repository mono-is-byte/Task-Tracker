import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";

const TRIGGERS = ["status_changed", "task_created", "task_assigned"] as const;

const Body = z.object({
  name: z.string().min(1).max(120),
  trigger: z.enum(TRIGGERS),
  condition: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_automation");
  if ("response" in auth) return auth.response;
  const rules = await db.automationRule.findMany({ where: { projectId: id }, orderBy: { position: "asc" } });
  return ok({
    triggers: TRIGGERS,
    rules: rules.map((r) => ({
      id: r.id, name: r.name, trigger: r.trigger,
      condition: JSON.parse(r.condition), action: JSON.parse(r.action), enabled: r.enabled,
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_automation");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Rule name and trigger are required.");
  const count = await db.automationRule.count({ where: { projectId: id } });
  const rule = await db.automationRule.create({
    data: {
      projectId: id, name: parsed.data.name.trim(), trigger: parsed.data.trigger,
      condition: JSON.stringify(parsed.data.condition ?? {}),
      action: JSON.stringify(parsed.data.action ?? {}),
      enabled: parsed.data.enabled ?? true, position: count,
    },
  });
  return ok({ rule }, 201);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_automation");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  if (!ruleId) return fail(400, "validation", "ruleId required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.partial().safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid rule patch.");
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.condition !== undefined) data.condition = JSON.stringify(parsed.data.condition);
  if (parsed.data.action !== undefined) data.action = JSON.stringify(parsed.data.action);
  const n = await db.automationRule.updateMany({ where: { id: ruleId, projectId: id }, data });
  if (n.count === 0) return fail(404, "not_found", "Rule not found.");
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_automation");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  if (!ruleId) return fail(400, "validation", "ruleId required.");
  await db.automationRule.deleteMany({ where: { id: ruleId, projectId: id } });
  return ok({ deleted: true });
}
