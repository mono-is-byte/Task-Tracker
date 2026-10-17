"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * The dedicated Users page (sidebar entry, visible to Admins and PMs only).
 *  - Admin: add user, edit (name/email/avatar), activate/deactivate, make or
 *    remove admin, reset password, delete (soft) with confirmation.
 *  - PM (`manage_members` somewhere): edit name and the designation of users
 *    in a project they manage.
 * The designation is a REFERENCE to a role in Roles & Permissions — the
 * dropdown lists the live role names and stores the role id, so renaming a
 * role updates every user's designation automatically, and deleting a role
 * clears it. It never grants permissions by itself.
 * Membership editing lives in the project settings; each row links to a
 * "View projects" modal (Assigned / Solved projects via GET
 * /api/users/:id/projects).
 * Server rules live in src/lib/users.ts — this page is the UI for them.
 */

interface U {
  id: string; email: string; username: string; name: string;
  active: boolean; isSuperAdmin: boolean; mustChangePassword: boolean;
  lockedUntil: string | null; avatarUrl: string | null;
  /** Role id (the stored designation), null when none / role deleted. */
  designation: string | null;
  /** Live role name for display (follows renames). */
  designationName: string | null;
  /** Admin, or PM of a shared managed project → may edit name/designation. */
  canEdit: boolean;
}
interface UserProjectRow { projectId: string; key: string; name: string; openCount?: number; doneCount?: number }

const inp = "rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800";
const btn = "rounded border px-2 py-0.5 text-xs disabled:opacity-50";

export default function UsersPage() {
  const [users, setUsers] = useState<U[]>([]);
  /** Role options for the designation dropdown (from /api/users). */
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [lastTemp, setLastTemp] = useState("");
  const [busy, setBusy] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", username: "", name: "", designation: "", isSuperAdmin: false });

  const [editing, setEditing] = useState<U | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDesignation, setEditDesignation] = useState("");

  // Step 2: "View projects" modal.
  const [projectsOf, setProjectsOf] = useState<U | null>(null);
  const [projectRows, setProjectRows] = useState<{ assigned: UserProjectRow[]; solved: UserProjectRow[] } | null>(null);
  const [projectsErr, setProjectsErr] = useState("");

  const [deleting, setDeleting] = useState<U | null>(null);

  async function load() {
    try {
      const d = await api<{ viewer: { isSuperAdmin: boolean }; users: U[]; roles: { id: string; name: string }[] }>("/api/users");
      setUsers(d.users);
      setRoles(d.roles ?? []);
      setIsAdmin(d.viewer.isSuperAdmin);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    }
  }
  useEffect(() => { load(); }, []);

  async function openProjects(u: U) {
    setProjectsOf(u); setProjectRows(null); setProjectsErr("");
    try {
      const d = await api<{ assigned: UserProjectRow[]; solved: UserProjectRow[] }>(`/api/users/${u.id}/projects`);
      setProjectRows(d);
    } catch (e2) {
      setProjectsErr(e2 instanceof Error ? e2.message : "Could not load the projects.");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create"); setErr(""); setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addForm, designation: addForm.designation || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Failed to create user.");
      setLastTemp(`Temp password for ${addForm.email}: ${j.data.tempPassword}`);
      setAddForm({ email: "", username: "", name: "", designation: "", isSuperAdmin: false });
      setShowAdd(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed.");
    } finally { setBusy(""); }
  }

  async function patchUser(u: U, patch: Record<string, unknown>, label: string) {
    setBusy(u.id + label); setErr(""); setMsg("");
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Update failed.");
      setMsg("User updated.");
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Update failed.");
    } finally { setBusy(""); }
  }

  /** Save a user's designation (a role id from the dropdown — inline or modal). */
  async function saveDesignation(u: U, raw: string) {
    const next = raw.trim();
    if (next === (u.designation ?? "")) return;
    await patchUser(u, { designation: next || null }, "des");
  }

  async function resetPw(u: U) {
    setBusy(u.id + "pw"); setErr(""); setMsg("");
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Reset failed.");
      setLastTemp(`Temp password for ${u.email}: ${j.data.tempPassword}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Reset failed.");
    } finally { setBusy(""); }
  }

  async function doDelete() {
    if (!deleting) return;
    setBusy("delete"); setErr("");
    try {
      const res = await fetch(`/api/users/${deleting.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Delete failed.");
      setMsg(`${deleting.name} was deleted — tasks unassigned, memberships removed.`);
      setDeleting(null);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Delete failed.");
      setDeleting(null);
    } finally { setBusy(""); }
  }

  async function uploadAvatar(u: U, file: File) {
    setBusy(u.id + "av"); setErr(""); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${u.id}/avatar`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Upload failed.");
      setMsg("Avatar updated.");
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed.");
    } finally { setBusy(""); }
  }

  async function clearAvatar(u: U) {
    setBusy(u.id + "av"); setErr(""); setMsg("");
    try {
      const res = await fetch(`/api/users/${u.id}/avatar`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Remove failed.");
      setMsg("Avatar removed.");
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Remove failed.");
    } finally { setBusy(""); }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-xs text-slate-500">
          {isAdmin
            ? "Add and edit users and set their designation (a role from Roles & Permissions — labels only, never grants permissions)."
            : "You can edit the name and designation of users in the projects you manage."}
        </p>
        {isAdmin && (
          <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">
            + Add user
          </button>
        )}
      </div>

      {err && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
      {msg && <p className="mb-2 rounded bg-slate-200 p-2 text-sm dark:bg-slate-800">{msg}</p>}
      {lastTemp && (
        <p className="mb-2 rounded bg-amber-100 p-2 font-mono text-sm dark:bg-amber-950">
          {lastTemp} <span className="font-sans">(user must change it on next login)</span>
        </p>
      )}

      {showAdd && isAdmin && (
        <form onSubmit={create} className="tt-card mb-4 flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs">Email<input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} className={`${inp} mt-1 block`} required /></label>
          <label className="text-xs">Username<input value={addForm.username} onChange={(e) => setAddForm({ ...addForm, username: e.target.value })} className={`${inp} mt-1 block`} required /></label>
          <label className="text-xs">Name<input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} className={`${inp} mt-1 block`} required /></label>
          <label className="text-xs">Designation
            <select
              value={addForm.designation}
              onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })}
              disabled={roles.length === 0}
              className={`${inp} mt-1 block`}
            >
              <option value="">
                {roles.length === 0 ? "— no roles yet —" : "— no designation —"}
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={addForm.isSuperAdmin} onChange={(e) => setAddForm({ ...addForm, isSuperAdmin: e.target.checked })} /> Super Admin</label>
          <button disabled={busy === "create"} className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">Create user</button>
        </form>
      )}

      <div className="tt-card overflow-auto text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="p-2">User</th>
              <th className="p-2">Designation</th>
              <th className="p-2">Projects</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t align-top dark:border-slate-800 ${u.active ? "" : "opacity-50"}`}>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name} url={u.avatarUrl} size={32} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 font-semibold">
                        <span className="truncate">{u.name}</span>
                        {u.isSuperAdmin && <span className="rounded bg-purple-100 px-1 text-[10px] dark:bg-purple-950">admin</span>}
                        {u.mustChangePassword && <span className="rounded bg-amber-100 px-1 text-[10px] dark:bg-amber-950">temp-pw</span>}
                        {!u.active && <span className="rounded bg-red-100 px-1 text-[10px] dark:bg-red-950">inactive</span>}
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <span className="rounded bg-red-100 px-1 text-[10px] dark:bg-red-950">locked</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">{u.email} · @{u.username}</div>
                    </div>
                  </div>
                </td>
                <td className="p-2">
                  {u.canEdit ? (
                    <select
                      key={u.designation ?? ""}
                      defaultValue={u.designation ?? ""}
                      disabled={busy === u.id + "des" || roles.length === 0}
                      className={`${inp} w-40`}
                      title="Designation = a role from Roles & Permissions (label only)"
                      onChange={(e) => void saveDesignation(u, e.target.value)}
                    >
                      <option value="">— no designation —</option>
                      {u.designation && !roles.some((r) => r.id === u.designation) && (
                        <option value={u.designation}>(deleted role)</option>
                      )}
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-500" title={u.designationName ?? ""}>{u.designationName ?? "—"}</span>
                  )}
                </td>
                <td className="p-2">
                  <button onClick={() => void openProjects(u)} className={btn}>View projects</button>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => { setEditing(u); setEditName(u.name); setEditEmail(u.email); setEditDesignation(u.designation ?? ""); }} className={btn}>Edit</button>
                    {isAdmin && (
                      <>
                        <button onClick={() => void resetPw(u)} disabled={busy === u.id + "pw"} className={btn}>Reset pw</button>
                        <button onClick={() => void patchUser(u, { active: !u.active }, "act")} className={btn}>
                          {u.active ? "Deactivate" : "Activate"}
                        </button>
                        <button onClick={() => void patchUser(u, { isSuperAdmin: !u.isSuperAdmin }, "admin")} className={btn}>
                          {u.isSuperAdmin ? "Remove admin" : "Make admin"}
                        </button>
                        <button onClick={() => setDeleting(u)} className="rounded border px-2 py-0.5 text-xs text-red-600 dark:border-slate-700 dark:text-red-400">Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit user: name, email (Admin only), avatar upload (.jpg/.jpeg, <= 2 MB) */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div role="dialog" aria-label={`Edit ${editing.name}`} className="w-full max-w-md rounded-lg border border-line bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold">Edit user — {editing.name}</h3>
            <label className="mb-2 block text-xs text-slate-500">Name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inp} mt-0.5 block w-full`} />
            </label>
            <label className="mb-3 block text-xs text-slate-500">Email {!isAdmin && "(Admin only)"}
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} disabled={!isAdmin} className={`${inp} mt-0.5 block w-full disabled:opacity-60`} />
            </label>
            <label className="mb-3 block text-xs text-slate-500">Designation (a role — labels only)
              <select
                value={editDesignation}
                onChange={(e) => setEditDesignation(e.target.value)}
                disabled={roles.length === 0}
                className={`${inp} mt-0.5 block w-full`}
              >
                <option value="">
                  {roles.length === 0 ? "— no roles yet —" : "— no designation —"}
                </option>
                {editDesignation && !roles.some((r) => r.id === editDesignation) && (
                  <option value={editDesignation}>(deleted role)</option>
                )}
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
              <Avatar name={editing.name} url={editing.avatarUrl} size={40} />
              <label className={`cursor-pointer rounded border px-2 py-1 dark:border-slate-700 ${busy === editing.id + "av" ? "opacity-50" : ""}`}>
                Upload avatar (jpg/jpeg, ≤ 2 MB)
                <input type="file" accept=".jpg,.jpeg,image/jpeg" className="hidden" disabled={busy === editing.id + "av"}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(editing, f); e.target.value = ""; }} />
              </label>
              {editing.avatarUrl && (
                <button onClick={() => void clearAvatar(editing)} className="rounded border px-2 py-1 text-red-600 dark:border-slate-700 dark:text-red-400">Remove</button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded border px-3 py-1 text-sm dark:border-slate-700">Cancel</button>
              <button
                onClick={() => {
                  const patch: Record<string, unknown> = {};
                  if (editName.trim() && editName !== editing.name) patch.name = editName.trim();
                  if (isAdmin && editEmail.trim() && editEmail !== editing.email) patch.email = editEmail.trim();
                  const des = editDesignation.trim();
                  if (des !== (editing.designation ?? "")) patch.designation = des || null;
                  setEditing(null);
                  if (Object.keys(patch).length > 0) void patchUser(editing, patch, "edit");
                }}
                className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Assigned / Solved projects for the selected user. */}
      {projectsOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setProjectsOf(null)}>
          <div role="dialog" aria-label={`Projects for ${projectsOf.name}`} className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg border border-line bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-semibold">Projects — {projectsOf.name}</h3>
            <p className="mb-3 text-xs text-slate-500">Based on the tasks currently assigned to this user.</p>

            {!projectRows && !projectsErr && <p className="text-sm text-slate-500">Loading…</p>}
            {projectsErr && <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{projectsErr}</p>}

            {projectRows && (
              <>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Assigned projects ({projectRows.assigned.length})
                </h4>
                <ul className="mb-4 space-y-1 text-sm">
                  {projectRows.assigned.length === 0 && (
                    <li className="text-xs text-slate-400">No projects with open tasks.</li>
                  )}
                  {projectRows.assigned.map((p) => (
                    <li key={p.projectId} className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={`/p/${p.projectId}/board`}
                        onClick={() => setProjectsOf(null)}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {p.key} — {p.name}
                      </Link>
                      <span className="text-xs text-slate-500">{p.openCount} open task{p.openCount === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>

                <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Solved projects ({projectRows.solved.length})
                </h4>
                <ul className="space-y-1 text-sm">
                  {projectRows.solved.length === 0 && (
                    <li className="text-xs text-slate-400">No completed tasks yet.</li>
                  )}
                  {projectRows.solved.map((p) => (
                    <li key={p.projectId} className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={`/p/${p.projectId}/board`}
                        onClick={() => setProjectsOf(null)}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {p.key} — {p.name}
                      </Link>
                      <span className="text-xs text-slate-500">{p.doneCount} completed task{p.doneCount === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-4 flex justify-end">
              <button onClick={() => setProjectsOf(null)} className="rounded border px-3 py-1 text-sm dark:border-slate-700">Close</button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="The account is deleted: the user can no longer log in, their project memberships are removed, and their tasks become unassigned. Comments and history stay. This cannot be undone in the app."
          confirmLabel="Delete"
          busy={busy === "delete"}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void doDelete()}
        />
      )}
    </div>
  );
}
