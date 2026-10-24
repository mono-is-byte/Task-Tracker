import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TaskInput, ctxFromLoad, createTask, defaultCreationStatusId, listTasks } from "@/lib/tasks";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const url = new URL(req.url);
  const q = url.searchParams;
  const boolOrUndef = (v: string | null) => (v === null ? undefined : v === "true");
  try {
    const result = await listTasks(db, ctxFromLoad(loaded.project, auth.membership, auth.user.id), {
      epicId: q.get("epicId") ?? undefined,
      statusId: q.get("statusId") ?? undefined,
      priorityId: q.get("priorityId") ?? undefined,
      assigneeId: q.get("assigneeId") ?? undefined,
      testedById: q.get("testedById") ?? undefined,
      typeId: q.get("typeId") ?? undefined,
      search: q.get("search") ?? undefined,
      archived: boolOrUndef(q.get("archived")),
      label: q.get("label") ?? undefined,
      take: q.get("take") ? Number(q.get("take")) : undefined,
      skip: q.get("skip") ? Number(q.get("skip")) : undefined,
    });
    return ok(result);
  } catch (e) {
    return fail(400, "bad_filter", e instanceof Error ? e.message : "Bad filter.");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "create_task");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = TaskInput.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid task fields.", parsed.error.issues);
  try {
    // Creation rule (change request): tasks created through the API always
    // start in To Do — overriding any statusId an older client may send. The
    // Board/Table creation forms only offer the To Do column as well.
    const statusId = await defaultCreationStatusId(db, id);
    const task = await createTask(db, ctxFromLoad(loaded.project, auth.membership, auth.user.id), { ...parsed.data, statusId });
    return ok({ task }, 201);
  } catch (e) {
    return fail(403, "forbidden", e instanceof Error ? e.message : "Cannot create task.");
  }
}
