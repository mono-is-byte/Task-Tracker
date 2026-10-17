import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

const CommentBody = z.object({
  body: z.string().min(1).max(20000),
  kind: z.enum(["comment", "remark", "feedback"]).optional(),
});

function viewersMayComment(settingsJson: string): boolean {
  try {
    return (JSON.parse(settingsJson) as Record<string, unknown>).viewersCanComment === true;
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const comments = await db.comment.findMany({
    where: { taskId, task: { projectId: id } },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok({ comments });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CommentBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Comment body is required.");
  const task = await db.task.findFirst({ where: { id: taskId, projectId: id } });
  if (!task) return fail(404, "not_found", "Task not found.");

  const isViewer = auth.membership.roleName === "Viewer / Stakeholder" && !auth.membership.isSuperAdmin;
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  const allowedByPerm = auth.membership.perms.comment === true;
  if (!allowedByPerm && !(isViewer && viewersMayComment(project.settings))) {
    return fail(403, "forbidden", "Your role cannot comment. (Admins can enable viewer comments in project settings.)");
  }
  const kind = parsed.data.kind ?? "comment";
  if ((kind === "remark" || kind === "feedback") && auth.membership.fieldRules[kind] === "hidden") {
    return fail(403, "forbidden", `Your role cannot write ${kind}.`);
  }
  const comment = await db.comment.create({
    data: { taskId, authorId: auth.user.id, kind, body: parsed.data.body },
  });
  await db.activity.create({
    data: { taskId, actorId: auth.user.id, action: `task.${kind}_added`, field: kind },
  });
  // notify assignee/tester about new feedback (not the author themselves)
  const notifyIds = [task.assigneeId, task.testedById].filter((x): x is string => !!x && x !== auth.user.id);
  for (const uid of [...new Set(notifyIds)]) {
    await db.notification.create({
      data: {
        userId: uid, kind: "comment_added", title: `New ${kind} on ${task.title}`,
        body: parsed.data.body.slice(0, 200), link: `/p/${id}/board?task=${taskId}`,
      },
    });
  }
  publish(id, "comment_added", { taskId, id: comment.id });
  return ok({ comment }, 201);
}
