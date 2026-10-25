import Link from "next/link";
import { redirect } from "next/navigation";
import { loadProject, requireViewer } from "@/lib/server";
import { memberRoleLabels } from "@/lib/memberLabel";
import ProjectTabs from "@/components/ProjectTabs";

const TABS = [
  ["board", "Board"],
  ["table", "Table"],
  ["timeline", "Timeline"],
  ["workload", "Workload"],
  ["reports", "Reports"],
  ["archive", "Archive"],
  ["members", "Members"],
  ["settings", "Settings"],
] as const;

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireViewer(`/p/${id}/board`);
  const loaded = await loadProject(id, user.id, user.isSuperAdmin);
  if (!loaded) redirect("/no-access");
  const { project, membership } = loaded;
  const accent = (project.settings.accent as string) || "#4f46e5";
  // The badge beside the project name shows who you are HERE — the project role
  // (super admins included) or your designation — instead of the generic
  // synthetic "Super Admin"/"Team member" label. The directory row already
  // carries both values, so no extra query is needed.
  const viewer = loaded.members.find((m) => m.userId === user.id);
  const viewerRole =
    memberRoleLabels(viewer?.roleNames ?? [], viewer?.designationName).join(", ") || membership.roleName;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/" className="text-sm text-slate-500">← My Work</Link>
        <h1 className="text-xl font-bold">
          <span className="mr-2 font-mono text-sm" style={{ color: accent }}>{project.key}</span>
          {project.name}
        </h1>
        <span
          className="rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-800"
          title="Your role in this project (falls back to your designation)"
        >
          {viewerRole}
        </span>
        <div className="ml-2">
          <ProjectTabs
            projectId={id}
            accent={accent}
            tabs={TABS.filter(([slug]) => {
              if (slug === "settings" && !(membership.perms.manage_workflow || membership.isSuperAdmin)) return false;
              if (slug === "members" && !(membership.perms.manage_members || membership.isSuperAdmin)) return false;
              if (slug === "reports" && !membership.perms.view_reports && !membership.isSuperAdmin) return false;
              return true;
            })}
          />
        </div>
      </div>
      {project.bannerNote && (
        <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          📢 {project.bannerNote}
        </p>
      )}
      {children}
    </div>
  );
}
