"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import { expandSidebar, getCollapsed, isSidebarMobile } from "@/lib/sidebar";
import ConfirmDialog from "./ConfirmDialog";
import EditProjectDialog from "./EditProjectDialog";
import { IconCheck, IconChevronRight, IconDots, IconPencil, IconPlus, IconTrash } from "./icons";

export interface SidebarProject {
  id: string;
  key: string;
  name: string;
  isCompleted: boolean;
  /** Admin/PM in this project → Rename/Delete menu. */
  canManage: boolean;
}

/**
 * Sidebar Projects section (change request Phase 2):
 * - the ONLY place to create a project (Admin/PM "+")
 * - per-project Edit (name + key) / Delete menu for Admin/PM
 * - "Project Done" section: filled automatically when all of a project's
 *   tasks reach a final status (server-computed, 0 tasks never counts).
 * Step 3: both sections collapse/expand with a chevron + count badge and a
 * smooth animation; the open/closed state persists per section in localStorage.
 * Sidebar toggle change request: in the collapsed icon rail the project rows
 * shrink to their key badges (the `.sb-*` hooks below), the section headers
 * hide, and "New project" expands the rail first so the form has room.
 */
const LS_PROJECTS_OPEN = "tt.sidebar.projectsOpen";
const LS_COMPLETED_OPEN = "tt.sidebar.completedOpen";

export default function SidebarProjects({ projects, canCreate }: { projects: SidebarProject[]; canCreate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Open the dropdown upward when the row sits low in the sidebar — below the
   *  fold it used to be clipped by the sidebar's scroll container (change
   *  request: "unable to edit project name, it's hidden for lower projects"). */
  const [menuUp, setMenuUp] = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const [editing, setEditing] = useState<SidebarProject | null>(null);
  const [deleting, setDeleting] = useState<SidebarProject | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Step 3: restore the persisted open/closed state (client only).
  useEffect(() => {
    try {
      const p = window.localStorage.getItem(LS_PROJECTS_OPEN);
      const c = window.localStorage.getItem(LS_COMPLETED_OPEN);
      if (p !== null) setProjectsOpen(p === "1");
      if (c !== null) setCompletedOpen(c === "1");
    } catch { /* storage unavailable — keep the defaults */ }
  }, []);

  function toggleProjects() {
    setProjectsOpen((v) => {
      const next = !v;
      try { window.localStorage.setItem(LS_PROJECTS_OPEN, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  function toggleCompleted() {
    setCompletedOpen((v) => {
      const next = !v;
      try { window.localStorage.setItem(LS_COMPLETED_OPEN, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  /** Smooth collapse wrapper (0fr ⇄ 1fr grid rows). */
  function collapse(open: boolean, children: ReactNode) {
    return (
      <div className={`sb-collapse grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }

  useEffect(() => {
    if (!menuFor) return;
    // Backstop for controls stacked ABOVE the click-away layer (the fixed
    // sidebar toggle sits at z-60): close when one of them is pressed. Clicks
    // on the layer itself are handled by its own onClick.
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-menu-shield]")) return;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuFor(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuFor]);

  // Step 5: the server pushes a global event when a project moves between the
  // active and Completed lists; refresh the sidebar without a page reload
  // (SSE, with a slow polling fallback when the stream cannot connect).
  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => { if (!stopped) router.refresh(); };
    try {
      es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { type?: string };
          if (data.type === "projects_changed") refresh();
        } catch { /* ignore malformed frames */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!poll && !stopped) poll = setInterval(refresh, 30000);
      };
    } catch {
      poll = setInterval(refresh, 30000);
    }
    return () => {
      stopped = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [router]);

  const active = projects.filter((p) => !p.isCompleted);
  const completed = projects.filter((p) => p.isCompleted);

  async function create() {
    if (!newKey.trim() || !newName.trim()) { setMsg("Key and name are required."); return; }
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ key: newKey.trim().toUpperCase(), name: newName.trim() }),
      });
      setCreating(false);
      setNewKey("");
      setNewName("");
      router.push(`/p/${r.project.id}/board`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create project.");
    } finally {
      setBusy(false);
    }
  }

  /** Change request: save the project name AND key together (like New project). */
  async function saveProject(p: SidebarProject, key: string, name: string) {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${p.id}/settings`, { method: "PATCH", body: JSON.stringify({ key, name }) });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: SidebarProject) {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      setDeleting(null);
      if (pathname?.startsWith(`/p/${p.id}`)) router.push("/");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  function item(p: SidebarProject) {
    const active = pathname?.startsWith(`/p/${p.id}`) ?? false;
    return (
      <div key={p.id} className="sb-proj group relative">
        <Link
          href={`/p/${p.id}/board`}
          aria-current={active ? "page" : undefined}
          className={`sb-proj-link block truncate rounded px-2 py-1 pr-6 transition-colors ${
            active ? "bg-accent/10 font-semibold text-accent" : "hover:bg-line"
          }`}
          title={`${p.key} ${p.name}`}
        >
          <span className={`font-mono text-xs ${active ? "" : "text-muted"}`}>{p.key}</span> <span className="sb-proj-name">{p.name}</span>
          {p.isCompleted && <span className="sb-proj-check ml-1 inline-flex align-middle text-green-600 dark:text-green-400" title="All tasks are done"><IconCheck className="h-3 w-3" /></span>}
        </Link>
        {p.canManage && (
          <button
            type="button"
            aria-label={`Actions for ${p.name}`}
            onClick={(e) => {
              if (menuFor === p.id) { setMenuFor(null); return; }
              // Flip the dropdown up for rows near the bottom of the sidebar so
              // the menu is never clipped by the scroll container.
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuUp(window.innerHeight - rect.bottom < 140);
              setMenuRect(rect);
              setMenuFor(p.id);
            }}
            className="sb-proj-dots absolute right-0 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-muted opacity-60 transition-opacity hover:bg-line hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
          >
            <IconDots className="h-3.5 w-3.5" />
          </button>
        )}
        {menuFor === p.id && createPortal(
          <>
            {/* Click-away layer: while the menu is open ANY click outside it
                lands on this layer first and closes the menu — completely
                independent of event propagation on whatever sits underneath
                (board drag sensors, rows, the drawer). It closes on `click`
                (not mousedown) so the very same click is consumed here and
                cannot fall through to activate the element beneath. Elements
                above it (e.g. the z-60 sidebar toggle) are covered by the
                document mousedown backstop below. */}
            <div
              aria-hidden="true"
              data-menu-shield="1"
              className="fixed inset-0 z-[45]"
              onClick={() => setMenuFor(null)}
            />
            <div
              ref={(el) => {
                // Attach the outside-click ref AND measure the height so the menu
                // can open upward near the bottom of the sidebar.
                menuRef.current = el;
                if (el) setMenuHeight(el.offsetHeight);
              }}
              className="fixed z-50 w-36 rounded border border-line bg-surface py-1 text-xs shadow-lg"
              style={{
                right: `${window.innerWidth - (menuRect?.right ?? 0)}px`,
                top: menuUp ? `${(menuRect?.top ?? 0) - menuHeight - 4}px` : `${(menuRect?.bottom ?? 0) + 4}px`,
              }}
            >
              <button
                type="button"
                title="Edit the project name and key"
                onClick={() => { setMenuFor(null); setEditing(p); setMsg(""); }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-line"
              >
                <IconPencil className="h-3.5 w-3.5" /> Edit project
              </button>
              <button
                type="button"
                onClick={() => { setMenuFor(null); setDeleting(p); setMsg(""); }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-red-600 hover:bg-line dark:text-red-400"
              >
                <IconTrash className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="sb-section-head mt-2 flex items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggleProjects}
          aria-expanded={projectsOpen}
          className="sb-section-toggle flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left text-xs uppercase text-muted hover:bg-line"
          title={projectsOpen ? "Collapse the project list" : "Expand the project list"}
        >
          <IconChevronRight className={`h-3 w-3 shrink-0 transition-transform ${projectsOpen ? "rotate-90" : ""}`} />
          <span className="sb-label truncate">Projects ({active.length})</span>
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              // The create form needs full width — open the rail first when collapsed.
              if (!isSidebarMobile() && getCollapsed()) expandSidebar();
              setCreating((v) => !v);
              setMsg("");
            }}
            className="sb-plus rounded p-0.5 text-muted hover:bg-line hover:text-accent"
            title="New project"
            aria-label="New project"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {collapse(projectsOpen, (
        <>
          {msg && <p className="sb-msg px-2 py-0.5 text-[11px] text-red-600 dark:text-red-400">{msg}</p>}
          {creating && (
            <div className="sb-create mx-1 mb-1 flex flex-col gap-1 rounded border border-line p-1.5">
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                placeholder="KEY (e.g. MAP)"
                maxLength={10}
                className="rounded border border-line bg-surface p-1 font-mono text-xs"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                maxLength={120}
                className="rounded border border-line bg-surface p-1 text-xs"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={create}
                  disabled={busy}
                  className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setMsg(""); }}
                  className="rounded border border-line px-2 py-0.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {active.map(item)}
          {active.length === 0 && completed.length === 0 && (
            <span className="sb-label block px-2 text-xs text-muted">No projects yet.</span>
          )}
        </>
      ))}
      {completed.length > 0 && (
        <div className="sb-completed mt-2">
          <button
            type="button"
            onClick={toggleCompleted}
            aria-expanded={completedOpen}
            className="sb-section-toggle flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs uppercase text-muted hover:bg-line"
            title="Projects whose tasks are all in a final status"
          >
            <IconChevronRight className={`h-3 w-3 shrink-0 transition-transform ${completedOpen ? "rotate-90" : ""}`} />
            <span className="sb-label truncate">Project Done ({completed.length})</span>
          </button>
          {collapse(completedOpen, <div>{completed.map(item)}</div>)}
        </div>
      )}
      {editing && (
        <EditProjectDialog
          project={{ key: editing.key, name: editing.name }}
          busy={busy}
          error={msg}
          onCancel={() => { setEditing(null); setMsg(""); }}
          onSave={(key, name) => saveProject(editing, key, name)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete project “${deleting.key} ${deleting.name}”?`}
          body="Every task, comment and history entry in this project is permanently removed, and no member will see it anymore. This cannot be undone."
          busy={busy}
          error={msg}
          onCancel={() => { setDeleting(null); setMsg(""); }}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}
