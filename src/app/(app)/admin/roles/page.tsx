"use client";

import { useEffect, useState } from "react";

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, boolean>;
  fieldRules: Record<string, string>;
  isSystem: boolean;
  /** Unique, non-deleted users whose designation is this role (server-computed). */
  users: number;
}

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");

  async function load() {
    const res = await fetch("/api/admin/roles");
    if (!res.ok) {
      if (res.status === 403) window.location.href = "/no-access";
      return;
    }
    const j = await res.json();
    setRoles(j.data.roles);
    setActions(j.data.actions);
    setFields(j.data.fields);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const res = await fetch(`/api/admin/roles/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name.trim(),
        permissions: editing.permissions,
        fieldRules: editing.fieldRules,
      }),
    });
    const j = await res.json();
    // A rename updates every user's designation automatically — those
    // reference this role by id, never a copied string.
    setMsg(res.ok ? "Role saved." : (j.error?.message ?? "Failed."));
    setEditing(null);
    load();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const j = await res.json();
    setMsg(res.ok ? "Role created." : (j.error?.message ?? "Failed."));
    setNewName("");
    load();
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Roles & Permissions</h1>
      {msg && <p className="mb-2 rounded bg-slate-200 p-2 text-sm dark:bg-slate-800">{msg}</p>}
      <form onSubmit={create} className="mb-4 flex items-end gap-2">
        <label className="text-xs">New role name<input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1 block rounded border p-1 dark:border-slate-700 dark:bg-slate-800" required /></label>
        <button className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">Create</button>
      </form>

      <div className="grid gap-2">
        {roles.map((r) => (
          <div key={r.id} className="tt-card p-3">
            <div className="flex items-center gap-2">
              <strong>{r.name}</strong>
              {r.isSystem && <span className="rounded bg-slate-200 px-1 text-xs dark:bg-slate-700">system</span>}
              <span
                className="rounded bg-line/60 px-1.5 py-0.5 text-xs text-muted"
                title={`${r.users} unique user${r.users === 1 ? "" : "s"} with this designation (set on the Users page)`}
              >
                {r.users} user{r.users === 1 ? "" : "s"}
              </span>
              <button onClick={() => setEditing(r)} className="ml-auto rounded border px-2 py-0.5 text-xs">Edit</button>
            </div>
            <p className="text-xs text-slate-500">{r.description}</p>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4">
          <div className="mx-auto max-w-3xl rounded bg-surface p-4">
            <h2 className="mb-2 font-bold">Edit role</h2>
            <label className="mb-3 block text-sm">
              Role name
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="mt-1 block w-full rounded border p-1 dark:border-slate-700 dark:bg-slate-800"
                required
              />
            </label>
            <h3 className="mb-1 text-sm font-semibold">Actions</h3>
            <div className="mb-3 grid grid-cols-2 gap-1 md:grid-cols-3">
              {actions.map((a) => (
                <label key={a} className="flex items-center gap-1 font-mono text-xs">
                  <input type="checkbox" checked={editing.permissions[a] === true}
                    onChange={(e) => setEditing({ ...editing, permissions: { ...editing.permissions, [a]: e.target.checked } })} />
                  {a}
                </label>
              ))}
            </div>
            <h3 className="mb-1 text-sm font-semibold">Field rules</h3>
            <div className="mb-3 grid grid-cols-2 gap-1 md:grid-cols-3">
              {fields.map((f) => (
                <label key={f} className="flex items-center gap-1 font-mono text-xs">
                  {f}
                  <select value={editing.fieldRules[f] ?? "readonly"}
                    onChange={(e) => setEditing({ ...editing, fieldRules: { ...editing.fieldRules, [f]: e.target.value } })}
                    className="rounded border text-xs dark:border-slate-700 dark:bg-slate-800">
                    <option value="hidden">hidden</option>
                    <option value="readonly">readonly</option>
                    <option value="editable">editable</option>
                  </select>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={save} className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">Save</button>
              <button onClick={() => setEditing(null)} className="rounded border px-3 py-1 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
