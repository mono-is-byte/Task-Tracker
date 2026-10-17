import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TaskInput, ctxFromLoad, updateTask } from "@/lib/tasks";

const BulkBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  patch: TaskInput,
});

// Bulk edit: applies the same patch to many tasks; per-task permission checks apply.
// Returns per-item results so partial failures are visible.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = BulkBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "ids[] and patch are required.");
  const ctx = ctxFromLoad(loaded.project, auth.membership, auth.user.id);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const taskId of parsed.data.ids) {
    try {
      await updateTask(db, ctx, taskId, parsed.data.patch);
      results.push({ id: taskId, ok: true });
    } catch (e) {
      results.push({ id: taskId, ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  return ok({ results });
}
