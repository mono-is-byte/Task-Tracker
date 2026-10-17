import { z } from "zod";
import { fail, ok, readJson, requireMember, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

const SettingsBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  hoursPerDay: z.number().min(1).max(24).optional(),
  workingDays: z.array(z.number().min(0).max(6)).optional(),
  pointScale: z.array(z.number().min(0)).optional(),
  bannerNote: z.string().max(500).nullable().optional(),
  viewersCanComment: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  accent: z.string().max(20).optional(),
  wipLimits: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = SettingsBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid settings.");
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(project.settings); } catch { settings = {}; }
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.hoursPerDay !== undefined) data.hoursPerDay = parsed.data.hoursPerDay;
  if (parsed.data.workingDays !== undefined) data.workingDays = JSON.stringify(parsed.data.workingDays);
  if (parsed.data.pointScale !== undefined) data.pointScale = JSON.stringify(parsed.data.pointScale);
  if (parsed.data.bannerNote !== undefined) data.bannerNote = parsed.data.bannerNote;
  if (parsed.data.isHidden !== undefined) data.isHidden = parsed.data.isHidden;
  if (parsed.data.viewersCanComment !== undefined) settings.viewersCanComment = parsed.data.viewersCanComment;
  if (parsed.data.accent !== undefined) settings.accent = parsed.data.accent;
  if (parsed.data.wipLimits !== undefined) settings.wipLimits = parsed.data.wipLimits;
  data.settings = JSON.stringify(settings);
  await db.project.update({ where: { id }, data });
  await audit(db, { actorId: auth.user.id, action: "project.settings", entity: "project", entityId: id, meta: parsed.data, ip: clientIp(req) });
  publish(id, "project_changed", {});
  return ok({ updated: true });
}

const PriorityBody = z.object({ name: z.string().min(1).max(40), level: z.number().optional(), color: z.string().max(20).optional() });
const TypeBody = z.object({ name: z.string().min(1).max(40), color: z.string().max(20).optional() });

// Priorities & issue types management (same manage_workflow permission)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "priority";
  const { value, error } = await readJson(req);
  if (error) return error;
  try {
    if (kind === "type") {
      const parsed = TypeBody.safeParse(value);
      if (!parsed.success) return fail(400, "validation", "Type name required.");
      const t = await db.issueType.create({ data: { projectId: id, name: parsed.data.name.trim(), color: parsed.data.color ?? "#6366f1" } });
      return ok({ type: t }, 201);
    }
    const parsed = PriorityBody.safeParse(value);
    if (!parsed.success) return fail(400, "validation", "Priority name required.");
    const p = await db.priority.create({ data: { projectId: id, name: parsed.data.name.trim(), level: parsed.data.level ?? 3, color: parsed.data.color ?? "#94a3b8" } });
    return ok({ priority: p }, 201);
  } catch {
    return fail(409, "conflict", "Name already exists.");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "priority";
  const refId = url.searchParams.get("refId");
  if (!refId) return fail(400, "validation", "refId required.");
  if (kind === "type") {
    const used = await db.task.count({ where: { typeId: refId, projectId: id } });
    if (used > 0) return fail(400, "validation", `Type still has ${used} task(s).`);
    await db.issueType.deleteMany({ where: { id: refId, projectId: id } });
  } else {
    const used = await db.task.count({ where: { priorityId: refId, projectId: id } });
    if (used > 0) return fail(400, "validation", `Priority still has ${used} task(s).`);
    await db.priority.deleteMany({ where: { id: refId, projectId: id } });
  }
  return ok({ deleted: true });
}
