import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { taskKey } from "@/lib/db";
import { publish } from "@/lib/events";

// Task dependency links (blocks / blocked by / relates)
export async function GET(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const links = await db.taskLink.findMany({
    where: { OR: [{ fromId: taskId }, { toId: taskId }] },
    include: {
      from: { select: { id: true, serial: true, title: true, projectId: true } },
      to: { select: { id: true, serial: true, title: true, projectId: true } },
    },
  });
  const project = await db.project.findUnique({ where: { id } });
  const keys: Record<string, string> = {};
  for (const l of links) {
    keys[l.from.id] = l.from.projectId === id && project ? taskKey(project.key, l.from.serial) : l.from.serial.toString();
    keys[l.to.id] = l.to.projectId === id && project ? taskKey(project.key, l.to.serial) : l.to.serial.toString();
  }
  return ok({ links, keys });
}

const LinkBody = z.object({
  toId: z.string().min(1),
  kind: z.enum(["blocks", "relates"]).default("blocks"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  // editing links counts as editing the task
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = LinkBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "toId required.");
  const [a, b] = await Promise.all([
    db.task.findFirst({ where: { id: taskId, projectId: id } }),
    db.task.findFirst({ where: { id: parsed.data.toId, projectId: id } }),
  ]);
  if (!a || !b) return fail(404, "not_found", "Task not found.");
  if (a.id === b.id) return fail(400, "validation", "A task cannot depend on itself.");
  try {
    const link = await db.taskLink.create({ data: { fromId: a.id, toId: b.id, kind: parsed.data.kind } });
    await db.activity.create({ data: { taskId: a.id, actorId: auth.user.id, action: "task.link_added", field: "dependency", after: parsed.data.toId } });
    publish(id, "task_updated", { id: a.id, changes: ["dependency"] });
    return ok({ link }, 201);
  } catch {
    return fail(409, "conflict", "Link already exists.");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const toId = url.searchParams.get("toId");
  if (!toId) return fail(400, "validation", "toId query param required.");
  await db.taskLink.deleteMany({ where: { fromId: taskId, toId } });
  publish(id, "task_updated", { id: taskId, changes: ["dependency"] });
  return ok({ removed: true });
}
