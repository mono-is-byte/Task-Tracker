import { clientIp, fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TaskInput, ctxFromLoad, deleteTask, serializeTask, stripHiddenFields, updateTask } from "@/lib/tasks";

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
      assignedBy: { select: { id: true, name: true, username: true, avatarUrl: true, deletedAt: true } },
      testedBy: { select: { id: true, name: true, username: true, avatarUrl: true } },
      epic: true,
      comments: { include: { author: { select: { id: true, name: true, deletedAt: true } } }, orderBy: { createdAt: "asc" } },
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
  const assignIds = new Set<string>();
  for (const a of activities) {
    if (a.action === "task.assigned" || (a.action === "task.updated" && a.field === "assigneeId")) {
      if (a.before) assignIds.add(a.before);
      if (a.after) assignIds.add(a.after);
    }
  }
  const assignUsers = assignIds.size > 0
    ? await db.user.findMany({ where: { id: { in: [...assignIds] } }, select: { id: true, name: true, deletedAt: true } })
    : [];
  const assignNames = new Map(assignUsers.map((u) => [u.id, u.deletedAt ? `${u.name} (removed)` : u.name]));
  const activitiesOut = activities.map((a) =>
    a.action === "task.assigned" || (a.action === "task.updated" && a.field === "assigneeId")
      ? {
          ...a,
          beforeName: a.before ? assignNames.get(a.before) ?? null : null,
          afterName: a.after ? assignNames.get(a.after) ?? null : null,
        }
      : a,
  );
  const out = stripHiddenFields(
    serializeTask(c.loaded.project.key, c.loaded.project.hoursPerDay, task as unknown as Record<string, unknown>),
    auth.membership.fieldRules,
  ) as Record<string, unknown>;
  out.project = { id: c.loaded.project.id, key: c.loaded.project.key, name: c.loaded.project.name };
  out.projectKey = c.loaded.project.key;
  out.projectName = c.loaded.project.name;
  return ok({ task: out, activities: activitiesOut });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const c = await ctxOf(id, auth.user.id, auth.user.isSuperAdmin);
  if (!c) return fail(404, "not_found", "Project not found.");
  c.ctx.ip = clientIp(req);
  const { value, error } = await readJson(req);
  if (error) return error;
  const body = (value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const toggle = body.assignedByToggle;
  delete body.assignedByToggle;
  const parsed = TaskInput.safeParse(body);
  if (!parsed.success) return fail(400, "validation", "Invalid task fields.", parsed.error.issues);
  try {
    const updated = (await updateTask(db, c.ctx, taskId, parsed.data)) as Record<string, unknown>;
    if (toggle !== undefined) {
      if (!auth.membership.perms.assign && !auth.membership.isSuperAdmin) {
        return fail(403, "forbidden", "Only users with the assign permission can change 'Assigned by'.");
      }
      const checked = toggle === true;
      await db.task.update({
        where: { id: taskId },
        data: checked
          ? { assignedById: auth.user.id, assignedAt: new Date() }
          : { assignedById: null, assignedAt: null },
      });
      await db.activity.create({
        data: {
          taskId,
          actorId: auth.user.id,
          action: "task.assigned",
          field: "assignedById",
          before: checked ? null : (updated.assignedById as string | null),
          after: checked ? auth.user.id : null,
          meta: JSON.stringify({ via: "checkbox" }),
        },
      });
      updated.assignedById = checked ? auth.user.id : null;
      updated.assignedAt = checked ? new Date().toISOString() : null;
      updated.assignedBy = checked
        ? { id: auth.user.id, name: auth.user.name, deletedAt: null }
        : null;
    }
    const out = stripHiddenFields(updated, auth.membership.fieldRules) as Record<string, unknown>;
    out.project = { id: c.loaded.project.id, key: c.loaded.project.key, name: c.loaded.project.name };
    out.projectKey = c.loaded.project.key;
    out.projectName = c.loaded.project.name;
    return ok({ task: out });
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
  c.ctx.ip = clientIp(req);
  try {
    await deleteTask(db, c.ctx, taskId);
    return ok({ deleted: true });
  } catch (e) {
    return fail(403, "forbidden", e instanceof Error ? e.message : "Cannot delete task.");
  }
}
