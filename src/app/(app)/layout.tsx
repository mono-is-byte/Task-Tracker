import Link from "next/link";
import { db } from "@/lib/db";
import { listProjectsForUser, requireViewer } from "@/lib/server";
import { mergeRoles } from "@/lib/permissions";
import SidebarProjects from "@/components/SidebarProjects";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import NotificationsBell from "@/components/NotificationsBell";
import Avatar from "@/components/Avatar";
import NavLink from "@/components/NavLink";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireViewer("/");
  const projects = await listProjectsForUser(user.id, user.isSuperAdmin);

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
  // script) > saved profile preference (this script) > system default.
  // Runs before paint, so no FOUC either way.
  const themeScript = `(function(){try{if(!localStorage.getItem('tt_theme')&&!/tt_theme=/.test(document.cookie)){document.documentElement.classList.toggle('dark',${JSON.stringify(user.theme)}==='dark')}}catch(e){}})();`;

  return (
    <div className="flex min-h-screen">
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      {/* Phase 6: the sidebar is sticky + scrolls on its own, so navigation
          stays reachable while long pages scroll. */}
      <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-3">
        <Link href="/" className="mb-4 px-2 text-lg font-bold tracking-tight text-accent">
          TaskTracker
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          <NavLink href="/" exact>🏠 Dashboard</NavLink>
          <NavLink href="/calendar">📅 Calendar</NavLink>
          {(user.isSuperAdmin || manageIds.size > 0) && (
            <NavLink href="/users">👥 Users</NavLink>
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
              <div className="mt-2 px-2 text-xs uppercase text-muted">Admin</div>
              <NavLink href="/admin/roles">🔑 Roles &amp; Permissions</NavLink>
              <NavLink href="/admin/audit">📜 Audit Log</NavLink>
            </>
          )}
        </nav>
        <div className="mt-auto border-t border-line pt-2 text-xs">
          <div className="mb-1 flex items-center justify-between rounded-lg bg-canvas px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar name={user.name} url={user.avatarUrl} size={22} />
              <span className="truncate font-semibold" title={user.email}>{user.name}</span>
            </span>
            <NotificationsBell />
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NavLink href="/profile">Profile</NavLink>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:px-6">{children}</main>
    </div>
  );
}
