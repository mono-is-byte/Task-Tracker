"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Change request Phase 6: sidebar/topbar navigation links mark the ACTIVE tab
 * (current route) with an accent pill so users always know where they are.
 * `exact` matches only the exact path (used for "/"); child routes count as
 * active otherwise (e.g. /p/x/board lights up "Projects" children).
 */
export default function NavLink({
  href,
  exact = false,
  className = "",
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href === "/" ? "/\u0000" : `${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded px-2 py-1 transition-colors ${
        active
          ? "bg-accent/10 font-semibold text-accent"
          : "hover:bg-line"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
