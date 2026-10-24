import { z } from "zod";
import { fail, ok, readJson, requireMember, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish, publishGlobal } from "@/lib/events";
import { updateProjectIdentity } from "@/lib/server";

const SettingsBody = z.object({
  // Change request (sidebar → Edit project): the KEY is editable next to the
  // name, with the same rules as "New project" (uppercase letters/digits).
  key: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/, "Key must be uppercase letters/digits, e.g. MAP").optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  hoursPerDay: z.number().min(1).max(24).optional(),
  workingDays: z.array(z.number().min(0).max(6)).optional(),
  bannerNote: z.string().max(500).nullable().optional(),
  viewersCanComment: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  accent: z.string().max(20).optional(),
  wipLimits: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_workflow");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = SettingsBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid settings.");
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(project.settings); } catch { settings = {}; }
  // The key + name pair is saved through the shared helper so the sidebar, the
  // "New project" form and this route all enforce the same rules.
  let identityChanged = false;
  if (parsed.data.key !== undefined || parsed.data.name !== undefined) {
    const res = await updateProjectIdentity(id, { key: parsed.data.key, name: parsed.data.name }, db);
    if (!res.ok) return fail(409, "conflict", res.message);
    identityChanged = true;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.hoursPerDay !== undefined) data.hoursPerDay = parsed.data.hoursPerDay;
  if (parsed.data.workingDays !== undefined) data.workingDays = JSON.stringify(parsed.data.workingDays);
  if (parsed.data.bannerNote !== undefined) data.bannerNote = parsed.data.bannerNote;
  if (parsed.data.isHidden !== undefined) data.isHidden = parsed.data.isHidden;
  if (parsed.data.viewersCanComment !== undefined) settings.viewersCanComment = parsed.data.viewersCanComment;
  if (parsed.data.accent !== undefined) settings.accent = parsed.data.accent;
  if (parsed.data.wipLimits !== undefined) settings.wipLimits = parsed.data.wipLimits;
  data.settings = JSON.stringify(settings);
  await db.project.update({ where: { id }, data });
  await audit(db, { actorId: auth.user.id, action: "project.settings", entity: "project", entityId: id, meta: parsed.data, ip: clientIp(req) });
  publish(id, "project_changed", {});
  // The sidebar shows every project's key + name, so tell ALL connected clients
  // to refresh when the identity changed (project-scoped events alone would
  // only reach clients that joined this project's stream).
  if (identityChanged) publishGlobal("projects_changed", { projectId: id });
  return ok({ updated: true });
}
