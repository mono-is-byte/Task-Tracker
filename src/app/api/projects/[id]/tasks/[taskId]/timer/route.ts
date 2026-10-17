import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { ctxFromLoad, serializeTask } from "@/lib/tasks";
import { startTimer, stopTimer } from "@/lib/timer";

/**
 * Task timer: the only actions are "start" and "stop". The server derives the
 * state from the status timerRole + timestamps and enforces who may operate it
 * (the task's assignee, any PM or any Admin).
 */

const Body = z.object({ action: z.enum(["start", "stop"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "action must be \"start\" or \"stop\".");
  const ctx = ctxFromLoad(loaded.project, auth.membership, auth.user.id);
  try {
    const task = parsed.data.action === "start"
      ? await startTimer(db, ctx, taskId)
      : await stopTimer(db, ctx, taskId);
    const full = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { status: true } });
    return ok({ task: serializeTask(loaded.project.key, loaded.project.hoursPerDay, full) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Timer action failed.";
    const status = msg === "Task not found." ? 404 : 403;
    return fail(status, status === 404 ? "not_found" : "forbidden", msg);
  }
}
