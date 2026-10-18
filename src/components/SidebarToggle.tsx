"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconMenu, IconPanelLeft, IconX } from "./icons";
import {
  closeMobileSidebar,
  getCollapsed,
  isMobileSidebarOpen,
  isSidebarMobile,
  setCollapsed,
  setMobileSidebarOpen,
} from "@/lib/sidebar";

/**
 * The ONE sidebar hide/show control (change request: collapsible sidebar).
 *
 * Lives at the sidebar's top edge (fixed, so it follows the rail width) and
 * drives both states:
 *  - ≥1024px: collapses the rail to icons-only / expands it again, remembered
 *    in localStorage (`tt.sidebar`, restored before paint — no flicker).
 *  - <1024px: opens/closes the overlay drawer; the drawer also closes itself
 *    after any navigation (see the pathname effect).
 *
 * All visual state is CSS keyed off <html data-sb / data-sb-mobile>, so the
 * click never re-renders pages — only this button re-reads the state for its
 * icon, aria-expanded and label. The backdrop below only exists on mobile.
 */
export default function SidebarToggle() {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const sync = () => {
      setMobile(mq.matches);
      setCollapsedState(getCollapsed());
      setDrawerOpen(isMobileSidebarOpen());
      // Back at desktop width the drawer is meaningless — make sure it is closed.
      if (!mq.matches) closeMobileSidebar();
      // While the drawer is closed its off-canvas links must not be keyboard-reachable.
      const aside = document.getElementById("app-sidebar");
      if (aside) aside.inert = mq.matches && !isMobileSidebarOpen();
    };
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("tt:sidebar", sync);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("tt:sidebar", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Close the mobile drawer after navigation (any route change).
  useEffect(() => {
    closeMobileSidebar();
  }, [pathname]);

  const expanded = mobile ? drawerOpen : !collapsed;
  const label = mobile
    ? drawerOpen ? "Close navigation" : "Open navigation"
    : collapsed ? "Expand sidebar" : "Collapse sidebar";

  function toggle() {
    if (isSidebarMobile()) setMobileSidebarOpen(!isMobileSidebarOpen());
    else setCollapsed(!getCollapsed());
  }

  return (
    <>
      <div
        className="sb-backdrop"
        aria-hidden="true"
        onClick={() => setMobileSidebarOpen(false)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="app-sidebar"
        title={label}
        aria-label={label}
        className="sb-toggle"
      >
        <IconMenu className="sb-ico sb-ico-menu h-4 w-4" />
        <IconX className="sb-ico sb-ico-close h-4 w-4" />
        <IconPanelLeft className="sb-ico sb-ico-panel h-4 w-4" />
      </button>
    </>
  );
}
