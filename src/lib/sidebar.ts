/**
 * Shared sidebar state (change request: collapsible sidebar).
 *
 * ONE source of truth for the whole app: two data attributes on <html>.
 *  - data-sb="expanded" | "collapsed"  — desktop rail preference, persisted in
 *    localStorage ("tt.sidebar") and restored before paint by the root layout's
 *    inline script (no flicker, no server round-trip, no schema change).
 *  - data-sb-mobile="open"              — mobile/tablet drawer, session-only.
 *
 * The styling is plain CSS keyed off those attributes (see globals.css), so a
 * toggle never re-renders React trees, and only the toggle button itself keeps
 * local state for its icon/aria attributes.
 */

export const SIDEBAR_LS_KEY = "tt.sidebar";

/** Below lg (1024px) the sidebar is a drawer; at lg+ it is the icon rail. */
export const SIDEBAR_MOBILE_MQ = "(max-width: 1023.98px)";

const EVENT = "tt:sidebar";

export function isSidebarMobile(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SIDEBAR_MOBILE_MQ).matches;
}

export function getCollapsed(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.sb === "collapsed";
}

export function isMobileSidebarOpen(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.sbMobile === "open";
}

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

/** Desktop rail: collapse/expand and remember the choice on this device. */
export function setCollapsed(collapsed: boolean) {
  const root = document.documentElement;
  root.dataset.sb = collapsed ? "collapsed" : "expanded";
  try {
    window.localStorage.setItem(SIDEBAR_LS_KEY, root.dataset.sb);
  } catch { /* storage unavailable — the choice just won't persist */ }
  emit();
}

/** Mobile/tablet drawer: open/close (not persisted — it always starts closed). */
export function setMobileSidebarOpen(open: boolean) {
  const root = document.documentElement;
  if (open) root.dataset.sbMobile = "open";
  else delete root.dataset.sbMobile;
  emit();
}

/** Called after navigation so the drawer never covers the next page. */
export function closeMobileSidebar() {
  if (isMobileSidebarOpen()) setMobileSidebarOpen(false);
}

/** Used by nested navigation actions that need full-width UI (e.g. New project). */
export function expandSidebar() {
  if (getCollapsed()) setCollapsed(false);
}

/** Subscribe to any sidebar state change (toggle, other tab, resize is separate). */
export function onSidebarChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
