import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TaskInput, ctxFromLoad, deleteTask, serializeTask, updateTask } from "@/lib/tasks";

async function ctxOf(projectId: string, userId: string, isSuperAdmin: boolean) {
  const loaded = await loadProject(projectId, userId, isSuperAdmin);
  if (!loaded) return null;
  return { loaded, ctx: ctxFromLoad(loaded.project, loaded.membership, userId) };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const c = await ctxOf(id, auth.user.id, auth.user.isSuperAdmin);
  if (!c) return fail(404, "not_found", "Project not found.");
  const task = await db.task.findFirst({
    where: { id: taskId, projectId: id },
    include: {
      status: true, priority: true, type: true,
      assignee: { select: { id: true, name: true, username: true, avatarUrl: true } },
      testedBy: { select: { id: true, name: true, username: true, avatarUrl: true } },
      epic: true, story: true,
      comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      linksFrom: { include: { to: { select: { id: true, serial: true, title: true } } } },
      linksTo: { include: { from: { select: { id: true, serial: true, title: true } } } },
    },
  });
  if (!task) return fail(404, "not_found", "Task not found.");
  const activities = await db.activity.findMany({
    where: { taskId },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // hide hidden fields for this role
  const rules = auth.membership.fieldRules;
  const out = serializeTask(c.loaded.project.key, c.loaded.project.hoursPerDay, task as unknown as Record<string, unknown>) as Record<string, unknown>;
  for (const [k, rule] of Object.entries(rules)) {
    if (rule === "hidden" && k in out) out[k] = null;
  }
  return ok({ task: out, activities });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const c = await ctxOf(id, auth.user.id, auth.user.isSuperAdmin);
  if (!c) return fail(404, "not_found", "Project not found.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = TaskInput.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid task fields.", parsed.error.issues);
  try {
    const updated = await updateTask(db, c.ctx, taskId, parsed.data);
    return ok({ task: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cannot update task.";
    const status = msg === "Task not found." ? 404 : 403;
    return fail(status, status === 404 ? "not_found" : "forbidden", msg);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "delete_task");
  if ("response" in auth) return auth.response;
  const c = await ctxOf(id, auth.user.id, auth.user.isSuperAdmin);
  if (!c) return fail(404, "not_found", "Project not found.");
  try {
    await deleteTask(db, c.ctx, taskId);
    return ok({ deleted: true });
  } catch (e) {
    return fail(403, "forbidden", e instanceof Error ? e.message : "Cannot delete task.");
  }
}
