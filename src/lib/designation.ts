import type { PrismaClient } from "@prisma/client";

/**
 * Phase 1 decision — ROLE = DESIGNATION.
 *
 * There is ONE source of truth for "what is this person": the `Role` table.
 * `User.designation` is simply the id of the user's PRIMARY role (the one shown
 * next to their name almost everywhere). It is a REFERENCE, never a copied
 * label: renaming a role updates every display at once, and deleting a role
 * clears it (see `resolveDesignationRole`).
 *
 * To stop the two views from drifting apart, every code path that changes a
 * user's project roles funnels through the helpers below. The rules:
 *   - a user's designation MUST be one of the roles they actually hold in a
 *     project whenever they hold any (a "Repair" pass exists for legacy rows);
 *   - an explicit choice made in Users admin / Users create survives as long as
 *     the user still holds that role;
 *   - when the held role disappears, the first held role (by name) takes over;
 *   - a user with no project roles keeps whatever was set (often null) because
 *     there is nothing to derive from — the UI then shows "No role".
 */

/** The role ids a user holds across ALL their projects, id → name. */
async function heldRoles(client: PrismaClient, userId: string): Promise<Map<string, string>> {
  const memberships = await client.projectMember.findMany({
    where: { userId },
    include: { roles: { include: { role: { select: { id: true, name: true } } } } },
  });
  const held = new Map<string, string>();
  for (const m of memberships) {
    for (const link of m.roles) held.set(link.role.id, link.role.name);
  }
  return held;
}

/**
 * Read-side helper for "role = designation": the label to show wherever a
 * user's role is displayed (sidebar card, header, dashboard badge, …).
 *
 * The name is resolved LIVE from the `Role` table — so renaming a role renames
 * it everywhere — and never falls back to a hard-coded demo label such as
 * "Developer" or "Team member". A user holding no role shows the caller's
 * `fallback` ("No role"); Project Managers/Super Admins keep their explicit
 * label when no role is set.
 */
export async function designationLabel(
  client: PrismaClient,
  user: { designation: string | null; isSuperAdmin?: boolean },
  fallback = "No role",
): Promise<string> {
  if (user.designation) {
    const role = await client.role.findUnique({ where: { id: user.designation }, select: { name: true } });
    if (role?.name) return role.name;
  }
  return user.isSuperAdmin ? "Super Admin" : fallback;
}

/**
 * Re-align `User.designation` with the user's project roles. Call this AFTER
 * every membership/role change (add member, change roles, remove member).
 *
 * `preferredRoleId` is used when the caller wants to promote a specific role —
 * it only wins if the user actually holds it.
 */
export async function syncUserDesignation(
  client: PrismaClient,
  userId: string,
  preferredRoleId?: string | null,
): Promise<string | null> {
  const [held, user] = await Promise.all([
    heldRoles(client, userId),
    client.user.findUnique({ where: { id: userId }, select: { designation: true } }),
  ]);
  const current = user?.designation ?? null;

  let next: string | null;
  if (preferredRoleId && held.has(preferredRoleId)) next = preferredRoleId;
  else if (current && held.has(current)) next = current;
  else if (held.size > 0) {
    next = [...held.entries()].sort((a, b) => a[1].localeCompare(b[1]))[0][0];
  } else next = current;

  if (next !== current) {
    await client.user.update({ where: { id: userId }, data: { designation: next } });
  }
  return next;
}

/**
 * One-time repair across every user: any designation that is no longer among
 * the user's held roles is replaced by their first held role. Users with no
 * project memberships are left untouched. Returns how many rows changed.
 * (The `role_designation_and_transition_enforcement` migration runs the same
 * fix in SQL; this version is idempotent and reusable from seed/admin tooling.)
 */
export async function repairDesignations(client: PrismaClient): Promise<number> {
  const users = await client.user.findMany({
    where: { deletedAt: null },
    select: { id: true, designation: true },
  });
  let changed = 0;
  for (const u of users) {
    const held = await heldRoles(client, u.id);
    if (held.size === 0) continue;
    if (u.designation && held.has(u.designation)) continue;
    const next = [...held.entries()].sort((a, b) => a[1].localeCompare(b[1]))[0][0];
    if (next !== u.designation) {
      await client.user.update({ where: { id: u.id }, data: { designation: next } });
      changed += 1;
    }
  }
  return changed;
}
