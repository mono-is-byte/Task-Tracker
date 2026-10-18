import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { COOKIE_NAME, getSessionUser } from "./auth";
import { db, taskKey } from "./db";
import { getMembership, type Membership } from "./permissions";
import { listAssignableUsers, type DirectoryUser } from "./userDirectory";

export { taskKey };

export async function getViewer(): Promise<{ user: User; sessionId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const su = await getSessionUser(db, token);
  return su;
}

export async function requireViewer(next?: string): Promise<{ user: User; sessionId: string }> {
  const su = await getViewer();
  if (!su) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  if (su.user.mustChangePassword) redirect("/change-password");
  return su;
}

export interface ProjectContext {
  project: {
    id: string; key: string; name: string; description: string | null;
    hoursPerDay: number; workingDays: number[]; pointScale: number[];
    bannerNote: string | null; settings: Record<string, unknown>; isHidden: boolean;
  };
  membership: Membership;
  statuses: { id: string; name: string; category: string; color: string; position: number; designationTags: string[] }[];
  priorities: { id: string; name: string; level: number; color: string }[];
  issueTypes: { id: string; name: string; color: string }[];
  /** Every valid (non-deleted) user, one entry per user id. `isMember` marks the
   *  project members; `roleIds`/`roleNames` are the project roles (empty for
   *  non-members). Assignee/Tested By pickers use this whole list — the Users
   *  section is the source of truth, not the project membership. */
  members: DirectoryUser[];
  epics: { id: string; name: string; color: string; status: string }[];
  customFields: { id: string; name: string; fieldType: string; options: string[]; required: boolean; showIn: string[]; roleVisibility: Record<string, string> }[];
}

function parseArr(json: string, fallback: number[]): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function loadProject(projectId: string, userId: string, isSuperAdmin: boolean): Promise<ProjectContext | null> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const membership = await getMembership(db, userId, isSuperAdmin, projectId);
  if (!membership) return null;
  const [statuses, priorities, issueTypes, members, epics, customFields, designationTags] = await Promise.all([
    db.status.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    db.priority.findMany({ where: { projectId }, orderBy: { level: "desc" } }),
    db.issueType.findMany({ where: { projectId }, select: { id: true, name: true, color: true } }),
    // Assignee / Tested By options: every valid user, not just project members.
    listAssignableUsers(db, projectId),
    db.epic.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    db.customField.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    db.statusDesignationTag.findMany({ where: { status: { projectId } }, select: { statusId: true, text: true } }),
  ]);
  const tagsByStatus: Record<string, string[]> = {};
  for (const m of designationTags) (tagsByStatus[m.statusId] ??= []).push(m.text);
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(project.settings); } catch { settings = {}; }
  return {
    project: {
      id: project.id, key: project.key, name: project.name, description: project.description,
      hoursPerDay: project.hoursPerDay, workingDays: parseArr(project.workingDays, [1, 2, 3, 4, 5]),
      pointScale: parseArr(project.pointScale, [1, 2, 3, 5, 8, 13, 21]),
      bannerNote: project.bannerNote, settings,
      isHidden: project.isHidden,
    },
    membership,
    statuses: statuses.map((s) => ({ ...s, designationTags: tagsByStatus[s.id] ?? [] })),
    priorities, issueTypes,
    members,
    epics: epics.map((e) => ({ id: e.id, name: e.name, color: e.color, status: e.status })),
    customFields: customFields.map((f) => ({
      id: f.id, name: f.name, fieldType: f.fieldType,
      options: (() => { try { return JSON.parse(f.options); } catch { return []; } })(),
      required: f.required,
      showIn: (() => { try { return JSON.parse(f.showIn); } catch { return ["table", "card", "form"]; } })(),
      roleVisibility: (() => { try { return JSON.parse(f.roleVisibility); } catch { return {}; } })(),
    })),
  };
}

/** Projects the user can see, ordered by key. Hidden projects (Project.isHidden)
 *  are excluded unless includeHidden — hiding removes a project from default lists
 *  (home, sidebar) but the URL still works for members. */
export async function listProjectsForUser(
  userId: string,
  isSuperAdmin: boolean,
  includeHidden = false,
  client = db,
) {
  const hiddenFilter = includeHidden ? {} : { isHidden: false };
  if (isSuperAdmin) {
    return client.project.findMany({ where: hiddenFilter, orderBy: { key: "asc" } });
  }
  const memberships = await client.projectMember.findMany({
    where: { userId }, include: { project: true },
  });
  return memberships.map((m) => m.project).filter((p) => includeHidden || !p.isHidden);
}

/** Result of {@link updateProjectIdentity}: the saved values or a friendly error. */
export type ProjectIdentityUpdate =
  | { ok: true; key: string; name: string }
  | { ok: false; message: string };

/**
 * Change request (sidebar → Edit project): the project KEY and NAME are edited
 * together, like the "New project" form. The key is normalised to the create
 * rules (trim + uppercase) and must stay unique across projects. Task keys
 * ("LVM-12") are computed from the project key, so re-labelling updates every
 * task immediately — no stored task data is rewritten.
 */
export async function updateProjectIdentity(
  projectId: string,
  input: { key?: string; name?: string },
  client = db,
): Promise<ProjectIdentityUpdate> {
  const data: { key?: string; name?: string } = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.key !== undefined) {
    const key = input.key.trim().toUpperCase();
    const clash = await client.project.findUnique({ where: { key } });
    if (clash && clash.id !== projectId) {
      return { ok: false, message: `The key “${key}” is already used by another project.` };
    }
    data.key = key;
  }
  try {
    const updated = await client.project.update({
      where: { id: projectId },
      data,
      select: { key: true, name: true },
    });
    return { ok: true, ...updated };
  } catch (e) {
    // Two clients saving the same key at once: the unique index wins, we keep
    // the friendly message (the update is atomic, so nothing was applied).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      return { ok: false, message: "That key is already used by another project." };
    }
    throw e;
  }
}
