import { z } from "zod";
import { fail, ok, readJson, requireUser, clientIp } from "@/lib/api";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { defaultAutomationRules } from "@/lib/automation";
import { userHasGlobalAction } from "@/lib/permissions";

const CreateBody = z.object({
  key: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/, "Key must be uppercase letters/digits, e.g. MAP"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  hoursPerDay: z.number().min(1).max(24).optional(),
});

const DEFAULT_STATUSES = [
  // Step 4: every new project gets the standard timer roles out of the box.
  { name: "To Do", category: "todo", color: "#64748b", timerRole: "NONE" },
  { name: "In Progress", category: "inprogress", color: "#3b82f6", timerRole: "TRACK" },
  { name: "Development Done", category: "inprogress", color: "#f59e0b", timerRole: "TRACK" },
  { name: "In Testing", category: "inprogress", color: "#a855f7", timerRole: "TRACK" },
  { name: "Re-open", category: "inprogress", color: "#ef4444", timerRole: "NONE" },
  { name: "Done", category: "done", color: "#22c55e", timerRole: "FINAL" },
];

const DEFAULT_PRIORITIES = [
  { name: "Highest", level: 5, color: "#dc2626" },
  { name: "High", level: 4, color: "#ea580c" },
  { name: "Medium", level: 3, color: "#ca8a04" },
  { name: "Low", level: 2, color: "#2563eb" },
  { name: "Lowest", level: 1, color: "#64748b" },
];

const DEFAULT_TYPES = [
  { name: "Task", color: "#3b82f6" },
  { name: "Story", color: "#22c55e" },
  { name: "Bug", color: "#ef4444" },
  { name: "Epic", color: "#a855f7" },
  { name: "Sub-task", color: "#64748b" },
];

export async function POST(req: Request) {
  // Project creation: Admin (superadmin) or PM-level only.
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const canCreate = await userHasGlobalAction(db, auth.user.id, auth.user.isSuperAdmin, "manage_members");
  if (!canCreate) return fail(403, "forbidden", "Only Admins and Project Managers can create projects.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Invalid project fields.");

  const key = parsed.data.key.toUpperCase();
  try {
    const project = await db.project.create({
      data: {
        key, name: parsed.data.name.trim(),
        description: parsed.data.description ?? null,
        hoursPerDay: parsed.data.hoursPerDay ?? 8,
        bannerNote: "Tasks time may change depending on meeting, emergency support",
      },
    });
    // seed project-scoped defaults
    const statusIds: Record<string, string> = {};
    for (let i = 0; i < DEFAULT_STATUSES.length; i++) {
      const s = await db.status.create({ data: { projectId: project.id, ...DEFAULT_STATUSES[i], position: i } });
      statusIds[s.name] = s.id;
    }
    const chain: [string, string][] = [
      ["To Do", "In Progress"], ["In Progress", "Development Done"],
      ["Development Done", "In Testing"], ["In Testing", "Done"],
      ["In Testing", "Re-open"], ["Re-open", "In Progress"], ["Development Done", "In Progress"],
    ];
    for (const [from, to] of chain) {
      await db.statusTransition.create({
        data: { projectId: project.id, fromId: statusIds[from], toId: statusIds[to], roleIds: "[]" },
      });
    }
    for (const p of DEFAULT_PRIORITIES) await db.priority.create({ data: { projectId: project.id, ...p } });
    for (const t of DEFAULT_TYPES) await db.issueType.create({ data: { projectId: project.id, ...t } });
    for (const r of defaultAutomationRules()) {
      await db.automationRule.create({
        data: { projectId: project.id, name: r.name, trigger: r.trigger, condition: JSON.stringify(r.condition), action: JSON.stringify(r.action) },
      });
    }
    // creator becomes Project Manager
    const pmRole = await db.role.findUnique({ where: { name: "Project Manager" } });
    if (pmRole) {
      await db.projectMember.create({
        data: { projectId: project.id, userId: auth.user.id, roles: { create: [{ roleId: pmRole.id }] } },
      });
    }
    await audit(db, { actorId: auth.user.id, action: "project.create", entity: "project", entityId: project.id, ip: clientIp(req) });
    return ok({ project: { id: project.id, key: project.key } }, 201);
  } catch {
    return fail(409, "conflict", "Project key already exists.");
  }
}
