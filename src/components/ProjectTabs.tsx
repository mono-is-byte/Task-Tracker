"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Project sub-navigation (Board, Table, Timeline …). The active tab is derived
 * from the current pathname (`/p/<id>/<tab>`), so it survives refreshes and
 * direct links — no local state. Styling matches the app chrome and flips
 * with dark mode.
 */
export default function ProjectTabs({
  projectId,
  tabs,
  accent,
}: {
  projectId: string;
  /** [slug, label] pairs, already permission-filtered by the layout. */
  tabs: readonly (readonly [string, string])[];
  accent: string;
}) {
  const pathname = usePathname();
  const base = `/p/${projectId}`;

  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label="Project sections">
      {tabs.map(([slug, label]) => {
        const href = `${base}/${slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-2 py-1 transition-colors ${
              active
                ? "font-semibold text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
            style={active ? { background: accent } : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
