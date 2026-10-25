import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

const EditBody = z.object({
  body: z.string().min(1).max(20000).optional(),
  kind: z.enum(["comment", "remark", "feedback"]).optional(),
  /** true = mark solved, false = clear the marker. */
  solved: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string; commentId: string }> },
) {
  const { id, taskId, commentId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const membership = auth.membership;
  const user = auth.user;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = EditBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid comment fields.");
  const comment = await db.comment.findFirst({
    where: { id: commentId, taskId, task: { projectId: id } },
  });
  if (!comment) return fail(404, "not_found", "Comment not found.");

  const isAuthor = comment.authorId === user.id;
  const canEditOthers = user.isSuperAdmin || membership.perms.edit_task_all === true;
  if (!isAuthor && !canEditOthers) return fail(403, "forbidden", "You can only edit your own comments.");

  function canTouchKind(kind: string): boolean {
    if (membership.isSuperAdmin) return true;
    if (kind === "remark" || kind === "feedback") return membership.fieldRules[kind] === "editable";
    return true;
  }
  if (!canTouchKind(comment.kind)) {
    return fail(403, "forbidden", `The ${comment.kind} field is read-only for your role.`);
  }
  const nextKind = parsed.data.kind ?? comment.kind;
  if (!canTouchKind(nextKind)) {
    return fail(403, "forbidden", `The ${nextKind} field is read-only for your role.`);
  }

  const bodyChanged = parsed.data.body !== undefined && parsed.data.body !== comment.body;
  const kindChanged = nextKind !== comment.kind;
  const solved = parsed.data.solved;
  // Change request: editing a note drops its "solved" marker (it becomes open
  // again and the Solve button reappears). An explicit `solved` wins.
  const solvedAt = solved === undefined
    ? (bodyChanged || kindChanged ? null : comment.solvedAt)
    : (solved ? new Date() : null);
  const solvedChanged = (solvedAt === null) !== (comment.solvedAt === null);

  const updated = await db.comment.update({
    where: { id: comment.id },
    data: {
      body: parsed.data.body ?? comment.body,
      kind: nextKind,
      solvedAt,
    },
  });
  await db.activity.create({
    data: {
      taskId,
      actorId: user.id,
      action: solvedChanged
        ? `task.${nextKind}_${solvedAt ? "solved" : "reopened"}`
        : `task.${nextKind}_edited`,
      field: nextKind,
    },
  });
  publish(id, "comment_edited", { taskId, id: comment.id });
  return ok({ comment: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string; commentId: string }> },
) {
  const { id, taskId, commentId } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const membership = auth.membership;
  const user = auth.user;
  const comment = await db.comment.findFirst({
    where: { id: commentId, taskId, task: { projectId: id } },
  });
  if (!comment) return fail(404, "not_found", "Comment not found.");

  const isAuthor = comment.authorId === user.id;
  const canDeleteOthers = user.isSuperAdmin || membership.perms.delete_task === true;
  if (!isAuthor && !canDeleteOthers) return fail(403, "forbidden", "You can only delete your own comments.");

  function canTouchKind(kind: string): boolean {
    if (membership.isSuperAdmin) return true;
    if (kind === "remark" || kind === "feedback") return membership.fieldRules[kind] === "editable";
    return true;
  }
  if (!canTouchKind(comment.kind)) {
    return fail(403, "forbidden", `The ${comment.kind} field is read-only for your role.`);
  }

  await db.comment.delete({ where: { id: comment.id } });
  await db.activity.create({
    data: { taskId, actorId: user.id, action: `task.${comment.kind}_deleted`, field: comment.kind },
  });
  publish(id, "comment_deleted", { taskId, id: comment.id });
  return ok({ deleted: true });
}
