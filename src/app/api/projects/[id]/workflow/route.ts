import { z } from "zod";
import { fail, ok, readJson, requireMember, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";
import { loadProject } from "@/lib/server";
import { ctxFromLoad } from "@/lib/tasks";
import { removeStatus } from "@/lib/workflow-server";
import { replaceStatusDesignations } from "@/lib/workflow";

const Body = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(["todo", "inprogress", "done"]),
  color: z.string().max(20).optional(),
  // Timer role for the stage: NONE (no timer), TRACK (Start/Stop), FINAL (Done).
  timerRole: z.enum(["NONE", "TRACK", "FINAL"]).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const [statuses, transitions, designationTags] = await Promise.all([
    db.status.findMany({ where: { projectId: id }, orderBy: { position: "asc" } }),
    db.statusTransition.findMany({ where: { projectId: id }, include: { from: true, to: true } }),
    db.statusDesignationTag.findMany({ where: { status: { projectId: id } }, select: { statusId: true, text: true } }),
  ]);
  const roles = await db.role.findMany({ select: { id: true, name: true } });
  const types = await db.issueType.findMany({ where: { projectId: id }, select: { id: true, name: true } });
  const tags: Record<string, string[]> = {};
  for (const m of designationTags) (tags[m.statusId] ??= []).push(m.text);
  // Autocomplete hints for the tag editor: the role names users are actually
  // designated as (designations are role references — resolve the live names).
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const designated = await db.user.findMany({
    where: { deletedAt: null, designation: { not: null } },
    select: { designation: true }, distinct: ["designation"],
  });
  const designationHints = designated
    .map((h) => (h.designation ? roleName.get(h.designation) : null))
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
  return ok({ statuses, transitions, roles, issueTypes: types, designationHints, designationTags: tags });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "status";
  const { value, error } = await readJson(req);
  if (error) return error;

  if (kind === "transition") {
    const T = z.object({
      fromId: z.string().min(1), toId: z.string().min(1),
      roleIds: z.array(z.string()).optional(), issueTypeIds: z.array(z.string()).optional(),
    }).safeParse(value);
    if (!T.success) return fail(400, "validation", "fromId and toId are required.");
    try {
      const tr = await db.statusTransition.create({
        data: {
          projectId: id, fromId: T.data.fromId, toId: T.data.toId,
          roleIds: JSON.stringify(T.data.roleIds ?? []),
          issueTypeIds: JSON.stringify(T.data.issueTypeIds ?? []),
        },
      });
      publish(id, "workflow_changed", {});
      return ok({ transition: tr }, 201);
    } catch {
      return fail(409, "conflict", "Transition already exists.");
    }
  }

  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Status name and category are required.");
  const count = await db.status.count({ where: { projectId: id } });
  // Round 2: default the timer role by category — Done finishes, todo shows no
  // timer, in-progress columns track time with manual Start/Stop buttons.
  let timerRole = parsed.data.timerRole;
  if (!timerRole) {
    if (parsed.data.category === "done") timerRole = "FINAL";
    else if (parsed.data.category === "todo") timerRole = "NONE";
    else timerRole = "TRACK";
  }
  try {
    const status = await db.status.create({
      data: { projectId: id, name: parsed.data.name.trim(), category: parsed.data.category, color: parsed.data.color ?? "#94a3b8", position: count, timerRole },
    });
    await audit(db, { actorId: auth.user.id, action: "workflow.status_create", entity: "status", entityId: status.id, ip: clientIp(req) });
    publish(id, "workflow_changed", {});
    return ok({ status }, 201);
  } catch {
    return fail(409, "conflict", "Status name already exists.");
  }
}

const PatchBody = z.object({
  kind: z.enum(["status", "transition"]),
  refId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  category: z.enum(["todo", "inprogress", "done"]).optional(),
  color: z.string().max(20).optional(),
  position: z.number().optional(),
  // Which part the column plays in the timer: NONE / TRACK / FINAL.
  timerRole: z.enum(["NONE", "TRACK", "FINAL"]).optional(),
  roleIds: z.array(z.string()).optional(),
  issueTypeIds: z.array(z.string()).optional(),
  // Role-name tags suggested by a status (replace-the-set semantics).
  designationTags: z.array(z.string().max(60)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = PatchBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid workflow patch.");
  if (parsed.data.kind === "status") {
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.category !== undefined) data.category = parsed.data.category;
    if (parsed.data.color !== undefined) data.color = parsed.data.color;
    if (parsed.data.position !== undefined) data.position = parsed.data.position;
    if (parsed.data.timerRole !== undefined) data.timerRole = parsed.data.timerRole;
    const exists = await db.status.findFirst({ where: { id: parsed.data.refId, projectId: id }, select: { id: true } });
    if (!exists) return fail(404, "not_found", "Status not found.");
    if (Object.keys(data).length > 0) {
      await db.status.updateMany({ where: { id: parsed.data.refId, projectId: id }, data });
    }
    if (parsed.data.designationTags !== undefined) {
      await replaceStatusDesignations(db, parsed.data.refId, parsed.data.designationTags);
    }
  } else {
    const data: Record<string, unknown> = {};
    if (parsed.data.roleIds !== undefined) data.roleIds = JSON.stringify(parsed.data.roleIds);
    if (parsed.data.issueTypeIds !== undefined) data.issueTypeIds = JSON.stringify(parsed.data.issueTypeIds);
    const n = await db.statusTransition.updateMany({ where: { id: parsed.data.refId, projectId: id }, data });
    if (n.count === 0) return fail(404, "not_found", "Transition not found.");
  }
  publish(id, "workflow_changed", {});
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "status";
  const refId = url.searchParams.get("refId");
  // Phase 3: removing a column that still holds tasks — pass moveToId to relocate
  // them first (per-task via updateTask: activity, notifications, automations apply).
  const moveToId = url.searchParams.get("moveToId");
  if (!refId) return fail(400, "validation", "refId required.");
  if (kind === "transition") {
    await db.statusTransition.deleteMany({ where: { id: refId, projectId: id } });
  } else if (moveToId) {
    const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
    if (!loaded) return fail(404, "not_found", "Project not found.");
    try {
      const result = await removeStatus(
        db, ctxFromLoad(loaded.project, auth.membership, auth.user.id), refId, moveToId,
      );
      publish(id, "workflow_changed", {});
      return ok(result);
    } catch (e) {
      return fail(400, "validation", e instanceof Error ? e.message : "Cannot remove status.");
    }
  } else {
    const used = await db.task.count({ where: { statusId: refId, projectId: id } });
    if (used > 0) return fail(400, "validation", `Status still has ${used} task(s). Move them first.`);
    await db.statusTransition.deleteMany({ where: { projectId: id, OR: [{ fromId: refId }, { toId: refId }] } });
    await db.status.deleteMany({ where: { id: refId, projectId: id } });
  }
  publish(id, "workflow_changed", {});
  return ok({ deleted: true });
}
