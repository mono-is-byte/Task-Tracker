import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/api";

const EpicBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  color: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const epics = await db.epic.findMany({ where: { projectId: id }, orderBy: { position: "asc" } });
  return ok({ epics });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = EpicBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Epic name is required.");
  const count = await db.epic.count({ where: { projectId: id } });
  const epic = await db.epic.create({
    data: {
      projectId: id, name: parsed.data.name.trim(),
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? "#8b5cf6",
      status: parsed.data.status ?? "open", position: count,
    },
  });
  await audit(db, { actorId: auth.user.id, action: "epic.create", entity: "epic", entityId: epic.id, ip: clientIp(req) });
  return ok({ epic }, 201);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const epicId = url.searchParams.get("epicId");
  if (!epicId) return fail(400, "validation", "epicId query param required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = EpicBody.partial().safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid epic fields.");
  const epic = await db.epic.updateMany({ where: { id: epicId, projectId: id }, data: parsed.data });
  if (epic.count === 0) return fail(404, "not_found", "Epic not found.");
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const epicId = url.searchParams.get("epicId");
  if (!epicId) return fail(400, "validation", "epicId query param required.");
  const used = await db.task.count({ where: { epicId, projectId: id } });
  if (used > 0) return fail(400, "validation", `Epic still has ${used} task(s). Move them first.`);
  await db.epic.deleteMany({ where: { id: epicId, projectId: id } });
  return ok({ deleted: true });
}
