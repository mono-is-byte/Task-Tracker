import { z } from "zod";
import { fail, ok, readJson, requireMember, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";
import type { LookupKind } from "@/lib/lookups";
import { createLookup, removeLookup, updateLookup, type LookupFailure } from "@/lib/lookups-server";
import { loadProject } from "@/lib/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const { membership, ...rest } = loaded;
  return ok({ ...rest, membership: { roleIds: membership.roleIds, roleNames: membership.roleNames, roleName: membership.roleName, perms: membership.perms, fieldRules: membership.fieldRules, isSuperAdmin: membership.isSuperAdmin } });
}

/**
 * Priorities & issue types management (change request: editable and better
 * designed). Same `manage_workflow` permission as the workflow itself; the
 * rules live in src/lib/lookups-server.ts — names are unique per project
 * (case-insensitively), and deleting an option that tasks still use is refused
 * with code "in_use" until the caller names where the tasks should go.
 *
 * These endpoints used to live under /settings (create/delete only, no UI
 * called them); they moved next to the GET that serves the same lookups.
 */

const LookupBody = z.object({
  name: z.string().min(1).max(80),
  level: z.number().optional(),
  color: z.string().max(20).optional(),
});

const LookupPatchBody = z.object({
  kind: z.enum(["priority", "type", "issuetype"]),
  refId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  level: z.number().optional(),
  color: z.string().max(20).optional(),
});

/** `kind` query/body values: "priority" (default) or "type" / "issuetype". */
function lookupKind(raw: string | null): LookupKind {
  return raw === "type" || raw === "issuetype" ? "issuetype" : "priority";
}

function lookupFailure(f: LookupFailure): Response {
  const status = f.code === "duplicate" ? 409 : f.code === "not_found" ? 404 : 400;
  return fail(status, f.code, f.message);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = lookupKind(url.searchParams.get("kind"));
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = LookupBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Name required.");
  const result = await createLookup(db, id, kind, parsed.data);
  if (!result.ok) return lookupFailure(result);
  await audit(db, {
    actorId: auth.user.id,
    action: kind === "priority" ? "project.priority_create" : "project.issuetype_create",
    entity: "project",
    entityId: id,
    meta: parsed.data,
    ip: clientIp(req),
  });
  publish(id, "workflow_changed", {});
  return ok(kind === "priority" ? { priority: result.priority } : { issueType: result.issueType }, 201);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = LookupPatchBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid priority / issue type patch.");
  const kind = lookupKind(parsed.data.kind);
  const result = await updateLookup(db, id, kind, parsed.data.refId, {
    name: parsed.data.name,
    level: parsed.data.level,
    color: parsed.data.color,
  });
  if (!result.ok) return lookupFailure(result);
  await audit(db, {
    actorId: auth.user.id,
    action: kind === "priority" ? "project.priority_update" : "project.issuetype_update",
    entity: "project",
    entityId: id,
    meta: { refId: parsed.data.refId, name: parsed.data.name, level: parsed.data.level, color: parsed.data.color },
    ip: clientIp(req),
  });
  publish(id, "workflow_changed", {});
  return ok(kind === "priority" ? { priority: result.priority } : { issueType: result.issueType });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const kind = lookupKind(url.searchParams.get("kind"));
  const refId = url.searchParams.get("refId");
  // Tasks that still use the option are moved to `moveToId` first (issue types
  // may instead pass "__none__" to clear the field) — never a dangling id.
  const moveToId = url.searchParams.get("moveToId");
  if (!refId) return fail(400, "validation", "refId required.");
  const result = await removeLookup(db, id, kind, refId, moveToId, auth.user.id);
  if (!result.ok) return lookupFailure(result);
  await audit(db, {
    actorId: auth.user.id,
    action: kind === "priority" ? "project.priority_delete" : "project.issuetype_delete",
    entity: "project",
    entityId: id,
    meta: { refId, moved: result.result.moved },
    ip: clientIp(req),
  });
  publish(id, "workflow_changed", {});
  return ok({ deleted: true, moved: result.result.moved });
}
