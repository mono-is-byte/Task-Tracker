"use client";

import { useRouter } from "next/navigation";

/**
 * Change request: the Dashboard's ONE combined project-wise filter. Picking a
 * project re-renders the server page with ?project=<id> (every KPI, card and
 * list is scoped by the page); "All projects" clears the parameter. This is
 * the only filter on the Dashboard.
 */
export default function DashboardProjectFilter({
  projects,
  selected,
}: {
  projects: { id: string; key: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span className="sr-only">Project wise filter</span>
      <select
        value={selected}
        onChange={(e) => router.push(e.target.value ? `/?project=${encodeURIComponent(e.target.value)}` : "/")}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
        title="Show the whole dashboard for all projects or one project"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.key} · {p.name}</option>
        ))}
      </select>
    </label>
  );
}
