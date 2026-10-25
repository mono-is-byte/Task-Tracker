"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { memberLabel, memberRoleLabels } from "@/lib/memberLabel";
import { IconPlus, IconTrash } from "@/components/icons";

/**
 * Project Members (change request: Members page redesign).
 *
 * One compact card holds everything: an aligned add-member toolbar in its
 * header and the member table underneath — no stacked sections, no gaps
 * between a separate "add" card and the list. Every value shown is real:
 * member rows come from GET /members, the user picker offers every valid user
 * not already a member, and designations are resolved live from the Users page
 * (never copied). Adding and removing go through the existing API and every
 * destructive action still goes through the one ConfirmDialog.
 */

interface Member {
  id: string; userId: string; name: string; email: string; username: string; active: boolean;
  avatarUrl: string | null;
  /** Live designation from the Users page (role reference name); shown as a chip. */
  designation: string | null;
  roleIds: string[]; roleNames: string[];
}

interface AddCandidate {
  id: string; name: string; email: string; username: string;
  avatarUrl: string | null; designationName: string | null;
}

/** Compact toolbar controls (same size/style for selects, inputs and buttons). */
const inp = "rounded border border-line bg-surface p-1 text-xs";

export default function MembersPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<AddCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  async function load() {
    try {
      const d = await api<{ members: Member[]; roles: { id: string; name: string }[]; users: AddCandidate[] }>(
        `/api/projects/${projectId}/members`
      );
      setMembers(d.members);
      setRoles(d.roles ?? []);
      setUsers(d.users ?? []);
      // Keep the current choice; otherwise default to Developer like the seed data.
      setAddRole((cur) => {
        if (cur) return cur;
        const dev = (d.roles ?? []).find((r) => r.name === "Developer");
        return dev?.id ?? d.roles?.[0]?.id ?? "";
      });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Could not load the members.", ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function add() {
    if (!addUser || !addRole || adding) return;
    const user = users.find((u) => u.id === addUser);
    const role = roles.find((r) => r.id === addRole);
    setAdding(true);
    setNotice(null);
    try {
      await api(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addUser, roleIds: [addRole] }),
      });
      setAddUser("");
      setNotice({
        text: `${user ? user.name : "User"} was added as ${role ? role.name : "a member"}.`,
        ok: true,
      });
      await load();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Add failed.", ok: false });
    } finally {
      setAdding(false);
    }
  }

  async function removeSelected() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const name = removing.name;
      await api(`/api/projects/${projectId}/members?userId=${removing.userId}`, { method: "DELETE" });
      setRemoving(null);
      setNotice({ text: `${name} was removed from this project.`, ok: true });
      await load();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Remove failed.", ok: false });
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  const candidates = users.filter((u) => !members.some((m) => m.userId === u.id));

  return (
    <div className="flex flex-col gap-3">
      {/* Page heading + real counts, aligned with the card below. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="tt-title">Project Members</h1>
        <span
          className="rounded-full bg-line/60 px-2 py-0.5 text-xs text-muted"
          title={`${members.length} member${members.length === 1 ? "" : "s"} in this project`}
        >
          {members.length} member{members.length === 1 ? "" : "s"}
        </span>
        <p className="w-full text-xs text-muted">
          People with access to this project. A member&apos;s project role and their
          designation from the{" "}
          <Link href="/users" className="text-indigo-600 underline dark:text-indigo-400">Users page</Link>{" "}
          are shown together in one column — identical labels appear only once.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-xs ${notice.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"}`}
        >
          {notice.text}
        </p>
      )}

      <div className="tt-card overflow-hidden">
        {/* Toolbar: card title on the left, the add form aligned on the right. */}
        <div className="flex flex-wrap items-end gap-2 border-b border-line bg-canvas/60 p-3">
          <div className="mr-auto min-w-0">
            <h2 className="text-sm font-semibold">Members</h2>
            <p className="text-[11px] text-muted">
              {loading ? "Loading…" : `Ordered by name · ${candidates.length} user${candidates.length === 1 ? "" : "s"} available to add`}
            </p>
          </div>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            User
            <select
              value={addUser}
              onChange={(e) => setAddUser(e.target.value)}
              className={`${inp} w-56 max-w-[60vw]`}
              aria-label="User to add"
            >
              <option value="">Choose a user…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id} title={u.email}>
                  {memberLabel({ name: u.name, designationName: u.designationName })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            Role
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className={`${inp} w-36`}
              aria-label="Project role for the new member"
            >
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button
            onClick={() => void add()}
            disabled={!addUser || !addRole || adding}
            className="tt-btn-primary px-3 py-1 text-xs"
            title={candidates.length === 0 ? "Every user is already a member" : "Add the selected user to this project"}
          >
            <IconPlus className="h-3.5 w-3.5" /> {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {loading ? (
          <p className="p-4 text-sm text-muted">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="p-4 text-sm text-muted">No members yet — choose a user above to add the first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-[11px] uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Role / Designation</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => {
                  const roleLabels = memberRoleLabels(m.roleNames, m.designation);
                  return (
                    <tr key={m.id} className="align-top hover:bg-canvas/60">
                      <td className="px-3 py-2">
                        <span className="flex items-start gap-2">
                          <Avatar name={m.name} url={m.avatarUrl} size={28} />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="truncate font-medium"
                                title={memberLabel({ name: m.name, designationName: m.designation })}
                              >
                                {m.name}
                              </span>
                              {!m.active && (
                                <span
                                  className="rounded border border-slate-300 px-1 text-[10px] text-muted dark:border-slate-600"
                                  title="Account deactivated on the Users page — they cannot sign in"
                                >
                                  deactivated
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted" title={m.email}>
                              @{m.username} · {m.email}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {roleLabels.map((rn) => (
                            <span
                              key={rn}
                              className="rounded border border-indigo-300 px-1.5 py-0.5 text-xs text-indigo-700 dark:border-indigo-700 dark:text-indigo-300"
                              title="Project role, or the designation from the Users page when the member has no project role"
                            >
                              {rn}
                            </span>
                          ))}
                          {roleLabels.length === 0 && <span className="text-xs text-muted">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setRemoving(m)}
                          className="tt-btn px-2 py-0.5 text-xs hover:text-red-600"
                          title={`Remove ${m.name} from this project`}
                          aria-label={`Remove ${m.name} from this project`}
                        >
                          <IconTrash className="h-3.5 w-3.5" /> Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
