import Link from "next/link";
import { db } from "@/lib/db";
import { listProjectsForUser, requireViewer } from "@/lib/server";
import { mergeRoles } from "@/lib/permissions";
import { designationLabel } from "@/lib/designation";
import SidebarProjects from "@/components/SidebarProjects";
import ThemeToggle from "@/components/ThemeToggle";
import ThemeSync from "@/components/ThemeSync";
import LogoutButton from "@/components/LogoutButton";
import NotificationsBell from "@/components/NotificationsBell";
import Avatar from "@/components/Avatar";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { IconAuditLog, IconCalendar, IconHome, IconKey, IconUser, IconUsers } from "@/components/icons";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireViewer("/");
  const projects = await listProjectsForUser(user.id, user.isSuperAdmin);
  // Phase 2 (role = designation): the sidebar shows the LIVE name of the primary
  // role (never a hard-coded label). "No role" when none is set.
  const roleLabel = await designationLabel(db, user);

  // Change request Phase 2: per-project Admin/PM flags (manage_members) decide
  // the sidebar's Rename/Delete menu; the "+" project creator appears when the
  // user manages at least one project (superadmins always). APIs re-check.
  let canCreate = user.isSuperAdmin;
  const manageIds = new Set<string>();
  if (user.isSuperAdmin) {
    for (const p of projects) manageIds.add(p.id);
  } else {
    const memberships = await db.projectMember.findMany({
      where: { userId: user.id },
      include: { roles: { include: { role: true } } },
    });
    for (const m of memberships) {
      if (mergeRoles(m.roles.map((l) => l.role)).perms.manage_members === true) {
        manageIds.add(m.projectId);
        canCreate = true;
      }
    }
  }

  // Theme precedence: device choice (localStorage/cookie, applied by the root
  // layout's inline script before paint) > saved profile preference (seeded into
  // the cookie by the login response, re-applied here after client navigation) >
  // system default. No inline <script> here: React never executes script tags
  // rendered inside components on the client and logs a console error for them.

  return (
    <div className="flex min-h-screen">
      <ThemeSync profileTheme={user.theme} />
      {/* Sidebar change request: ONE fixed toggle that follows the rail edge —
          collapses the desktop sidebar to an icon rail, opens/closes the mobile
          drawer. State lives on <html data-sb / data-sb-mobile> (restored
          before paint by the root layout's inline script) so toggling never
          re-renders pages. */}
      <SidebarToggle />
      {/* Phase 6: the sidebar is sticky + scrolls on its own, so navigation
          stays reachable while long pages scroll. */}
      <aside id="app-sidebar" className="sb-aside glass sticky top-0 flex h-screen w-52 shrink-0 flex-col overflow-y-auto border-r border-line p-3">
        <Link href="/" className="sb-logo mb-4 px-2 text-lg font-bold tracking-tight text-accent">
          TaskTracker
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          <NavLink href="/" exact title="Dashboard"><IconHome className="h-4 w-4 shrink-0" /> <span className="sb-label">Dashboard</span></NavLink>
          <NavLink href="/calendar" title="Calendar"><IconCalendar className="h-4 w-4 shrink-0" /> <span className="sb-label">Calendar</span></NavLink>
          {(user.isSuperAdmin || manageIds.size > 0) && (
            <NavLink href="/users" title="Users"><IconUsers className="h-4 w-4 shrink-0" /> <span className="sb-label">Users</span></NavLink>
          )}
          <SidebarProjects
            canCreate={canCreate}
            projects={projects.map((p) => ({
              id: p.id, key: p.key, name: p.name,
              isCompleted: p.isCompleted, canManage: manageIds.has(p.id),
            }))}
          />
          {user.isSuperAdmin && (
            <>
              <div className="sb-section mt-2 px-2 text-xs uppercase text-muted">Admin</div>
              <NavLink href="/admin/roles" title="Roles & Permissions"><IconKey className="h-4 w-4 shrink-0" /> <span className="sb-label">Roles &amp; Permissions</span></NavLink>
              <NavLink href="/admin/audit" title="Audit Log"><IconAuditLog className="h-4 w-4 shrink-0" /> <span className="sb-label">Audit Log</span></NavLink>
            </>
          )}
        </nav>
        <div className="sb-foot mt-auto border-t border-line pt-2 text-xs">
          <div className="sb-user glass-soft mb-1 flex items-center justify-between rounded-lg px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar name={user.name} url={user.avatarUrl} size={22} />
              <span className="flex min-w-0 flex-col">
                <span className="sb-label truncate font-semibold" title={user.email}>{user.name}</span>
                <span className="sb-label truncate text-[10px] text-muted" title={roleLabel}>{roleLabel}</span>
              </span>
            </span>
            <NotificationsBell />
          </div>
          <div className="sb-actions flex items-center gap-1">
            <ThemeToggle />
            <NavLink href="/profile" title="Profile"><IconUser className="h-4 w-4 shrink-0" /> <span className="sb-label">Profile</span></NavLink>
            <LogoutButton />
          </div>
        </div>
      </aside>
      {/* pt-12 keeps page content clear of the fixed mobile toggle; lg+ restores p-4. */}
      <main className="min-w-0 flex-1 p-4 pt-12 md:px-6 lg:pt-4">{children}</main>
    </div>
  );
}
