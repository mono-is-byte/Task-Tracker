"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import ConfirmDialog from "@/components/ConfirmDialog";

interface Member {
  id: string; userId: string; name: string; email: string; username: string; active: boolean;
  /** Live designation from the Users page (free text); shown as a role chip. */
  designation: string | null;
  roleIds: string[]; roleNames: string[];
}

export default function MembersPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string; email: string; username: string }[]>([]);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("");
  const [msg, setMsg] = useState("");
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  async function load() {
    try {
      const d = await api<{ members: Member[]; roles: { id: string; name: string }[]; users: { id: string; name: string; email: string; username: string }[] }>(
        `/api/projects/${projectId}/members`
      );
      setMembers(d.members);
      setRoles(d.roles);
      setUsers(d.users);
      if (!addRole && d.roles.length > 0) {
        const dev = d.roles.find((r) => r.name === "Developer");
        setAddRole(dev?.id ?? d.roles[0].id);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Load failed.");
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function add() {
    if (!addUser || !addRole) return;
    try {
      await api(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addUser, roleIds: [addRole] }),
      });
      setAddUser("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Add failed.");
    }
  }

  async function removeSelected() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api(`/api/projects/${projectId}/members?userId=${removing.userId}`, { method: "DELETE" });
      setRemoving(null);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Remove failed.");
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-lg font-bold">Project Members</h2>
      <p className="mb-2 text-xs text-slate-500">
        Add or remove members here. Designations set on the{" "}
        <Link href="/users" className="text-indigo-600 underline dark:text-indigo-400">Users page</Link>{" "}
        appear automatically as the first chip under “Roles in project”. To assign multiple roles, use the Users page.
      </p>
      {msg && <p className="mb-2 text-xs text-red-600">{msg}</p>}
      <div className="mb-3 flex gap-1 text-xs">
        <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">Add user…</option>
          {users.filter((u) => !members.some((m) => m.userId === u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>
        <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button onClick={add} className="rounded bg-indigo-600 px-2 font-semibold text-white">Add</button>
      </div>
      <div className="overflow-auto rounded border bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-50 text-left dark:bg-slate-800">
            <tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Roles in project</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t dark:border-slate-800">
                <td className="p-2">{m.name} <span className="text-xs text-slate-500">@{m.username}</span></td>
                <td className="p-2 text-xs">{m.email}</td>
                <td className="p-2">
                  <span className="flex flex-wrap gap-1">
                    {m.designation && (
                      <span
                        className="rounded border border-indigo-300 px-1 text-xs text-indigo-700 dark:border-indigo-700 dark:text-indigo-300"
                        title="Designation (synced live from the Users page)"
                      >
                        {m.designation}
                      </span>
                    )}
                    {m.roleNames.map((rn) => (
                      <span key={rn} className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{rn}</span>
                    ))}
                    {!m.designation && m.roleNames.length === 0 && (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </span>
                </td>
                <td className="p-2"><button onClick={() => setRemoving(m)} className="rounded border px-2 py-0.5 text-xs">Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name} from this project?`}
          body="They lose access to this project. Their name stays on existing task assignments and activity."
          confirmLabel="Remove"
          busy={removeBusy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void removeSelected()}
        />
      )}
    </div>
  );
}
