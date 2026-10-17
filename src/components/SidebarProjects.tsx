"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import ConfirmDialog from "./ConfirmDialog";
import RenameDialog from "./RenameDialog";

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
 * - per-project Rename / Delete menu for Admin/PM
 * - "Completed Projects" section: filled automatically when all of a project's
 *   tasks reach a final status (server-computed, 0 tasks never counts).
 * Step 3: both sections collapse/expand with a chevron + count badge and a
 * smooth animation; the open/closed state persists per section in localStorage.
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
  const [renaming, setRenaming] = useState<SidebarProject | null>(null);
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
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }

  useEffect(() => {
    if (!menuFor) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
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

  async function rename(p: SidebarProject, name: string) {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/projects/${p.id}/settings`, { method: "PATCH", body: JSON.stringify({ name }) });
      setRenaming(null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Rename failed.");
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
      <div key={p.id} className="group relative">
        <Link
          href={`/p/${p.id}/board`}
          aria-current={active ? "page" : undefined}
          className={`block truncate rounded px-2 py-1 pr-6 transition-colors ${
            active ? "bg-accent/10 font-semibold text-accent" : "hover:bg-line"
          }`}
          title={`${p.key} ${p.name}`}
        >
          <span className={`font-mono text-xs ${active ? "" : "text-muted"}`}>{p.key}</span> {p.name}
          {p.isCompleted && <span className="ml-1 text-green-600 dark:text-green-400" title="All tasks are done">✓</span>}
        </Link>
        {p.canManage && (
          <button
            type="button"
            aria-label={`Actions for ${p.name}`}
            onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded px-1 text-muted opacity-0 hover:bg-line focus:opacity-100 group-hover:opacity-100"
          >
            ⋯
          </button>
        )}
        {menuFor === p.id && (
          <div ref={menuRef} className="absolute right-0 top-full z-40 w-32 rounded border border-line bg-surface py-1 text-xs shadow-lg">
            <button
              type="button"
              onClick={() => { setMenuFor(null); setRenaming(p); setMsg(""); }}
              className="block w-full px-2 py-1 text-left hover:bg-line"
            >
              ✎ Rename
            </button>
            <button
              type="button"
              onClick={() => { setMenuFor(null); setDeleting(p); setMsg(""); }}
              className="block w-full px-2 py-1 text-left text-red-600 hover:bg-line dark:text-red-400"
            >
              🗑 Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mt-2 flex items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggleProjects}
          aria-expanded={projectsOpen}
          className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left text-xs uppercase text-muted hover:bg-line"
          title={projectsOpen ? "Collapse the project list" : "Expand the project list"}
        >
          <span className="text-[10px]">{projectsOpen ? "▾" : "▸"}</span>
          <span className="truncate">Projects ({active.length})</span>
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={() => { setCreating((v) => !v); setMsg(""); }}
            className="rounded px-1 leading-none text-muted hover:bg-line hover:text-accent"
            title="New project"
          >
            ＋
          </button>
        )}
      </div>
      {collapse(projectsOpen, (
        <>
          {msg && <p className="px-2 py-0.5 text-[11px] text-red-600 dark:text-red-400">{msg}</p>}
          {creating && (
            <div className="mx-1 mb-1 flex flex-col gap-1 rounded border border-line p-1.5">
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
            <span className="block px-2 text-xs text-muted">No projects yet.</span>
          )}
        </>
      ))}
      {completed.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={toggleCompleted}
            aria-expanded={completedOpen}
            className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs uppercase text-muted hover:bg-line"
            title="Projects whose tasks are all in a final status"
          >
            <span className="text-[10px]">{completedOpen ? "▾" : "▸"}</span>
            Completed Projects ({completed.length})
          </button>
          {collapse(completedOpen, <div>{completed.map(item)}</div>)}
        </div>
      )}
      {renaming && (
        <RenameDialog
          title={`Rename “${renaming.name}”`}
          initialValue={renaming.name}
          busy={busy}
          error={msg}
          onCancel={() => { setRenaming(null); setMsg(""); }}
          onSave={(v) => rename(renaming, v)}
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
