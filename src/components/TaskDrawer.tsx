"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import type { Lookups } from "@/hooks/useProject";
import { useTaskRow, patchTask } from "@/lib/taskStore";
import AssignStepDialog from "@/components/AssignStepDialog";
import TaskMenu from "@/components/TaskMenu";
import ScrollableList from "@/components/ScrollableList";
import { userOptionLabel } from "@/lib/memberLabel";
import { buildTaskNotes, filterVisibleNotes } from "@/lib/notes";
import { IconX } from "@/components/icons";

interface Props {
  projectId: string;
  taskId: string | null;
  lookups: Lookups;
  onClose: () => void;
  onChanged: () => void;
}

const sectionTitle = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted";
const staticBox = "mt-1 flex h-[38px] items-center rounded-md border border-line bg-canvas px-2.5 text-sm";

/**
 * Board/Table task-details side panel (redesign change request).
 *
 * Layout: fixed header (issue key chip, issue-type chip, editable title, actions
 * menu, close) + internally scrolling body (Properties → Estimates → Dates →
 * Description → Comments → Activity) so the panel never grows past the viewport
 * and the header stays reachable. Full-screen on phones, a 512 px side panel
 * from ≥sm. Every value written here goes through the shared task store
 * (`patchTask`), so Board, Table, Timeline and the drawer stay in sync.
 */
export default function TaskDrawer({ projectId, taskId, lookups, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [activities, setActivities] = useState<unknown[]>([]);
  const [comment, setComment] = useState("");
  const [commentKind, setCommentKind] = useState("comment");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [saving, setSaving] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState("");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const m = lookups.membership;
  const can = (a: string) => m.perms[a] === true || m.isSuperAdmin;
  const rule = (f: string) => (m.isSuperAdmin ? "editable" : (m.fieldRules[f] ?? "readonly"));
  // Two-way sync (item 7): field values come from the shared store, so an
  // edit made on the board/table (or another user's) shows up here at once.
  const storeTask = useTaskRow(projectId, taskId);

  async function loadDetail() {
    if (!taskId) return;
    try {
      const d = await api<{ task: Record<string, unknown>; activities: unknown[] }>(
        `/api/projects/${projectId}/tasks/${taskId}`
      );
      setDetail(d.task);
      setActivities(d.activities);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load task.");
    }
  }

  useEffect(() => {
    setDetail(null);
    setErr("");
    if (taskId) loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pendingStatus) setPendingStatus(null); // close the Assign step first
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pendingStatus]);

  // Transient "Saved ✓" confirmation after a successful write.
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(timer);
  }, [justSaved]);

  if (!taskId) return null;
  const tid: string = taskId; // captured for the callbacks below (TS narrowing)

  /** Edits go through the shared store: optimistic + rolled back on failure. */
  async function patch(fields: Record<string, unknown>, _label: string) {
    setSaving(_label);
    setJustSaved(false);
    setErr("");
    try {
      await patchTask(projectId, tid, fields);
      // reload full detail (automation side effects, fresh activity list)
      await loadDetail();
      setJustSaved(true);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving("");
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment, kind: commentKind }),
      });
      setComment("");
      loadDetail();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add comment.");
    }
  }

  async function saveNote(id: string) {
    if (!editingNoteText.trim()) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: editingNoteText }),
      });
      setEditingNoteId(null);
      setEditingNoteText("");
      await loadDetail();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not edit note.");
    }
  }

  async function deleteNote(id: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
      setEditingNoteId(null);
      await loadDetail();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete note.");
    }
  }

  /** Mark a comment/remark/feedback as solved ("(solved)" beside the text). */
  async function solveNote(id: string) {
    setErr("");
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ solved: true }),
      });
      await loadDetail();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark note as solved.");
    }
  }

  /**
   * Editing clears the solved marker first, so the note goes back to open and
   * the Solve button is offered again once the edit is done.
   */
  async function startEditNote(n: { id: string; text: string; solved: boolean }) {
    setEditingNoteId(n.id);
    setEditingNoteText(n.text);
    if (!n.solved) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}/comments/${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({ solved: false }),
      });
      await loadDetail();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reopen note.");
    }
  }

  // Store row wins (live); detail fills in until the store has loaded.
  const t: Record<string, unknown> | null = (storeTask as Record<string, unknown> | undefined) ?? detail;
  const comments = (t?.comments as { id: string; kind: string; body: string; author: { name: string }; createdAt: string }[] | undefined) ?? [];
  // Client-side gate for the actions menu; the API re-checks every action server-side.
  const canEditThis = !!t && (
    m.isSuperAdmin || m.perms.edit_task_all === true ||
    (m.perms.edit_task_own === true && (t.assigneeId == null || t.assigneeId === m.userId))
  );
  // Issue type: prefer the project-settings list (updates optimistically with
  // typeId), fall back to the relation the API row carries.
  const typeInfo = t
    ? (lookups.issueTypes.find((x) => x.id === (t.typeId as string | null)) ??
       ((t.type as { id: string; name: string; color: string } | null) ?? null))
    : null;
  // Epic is a read-only badge in the header (change request: epic moved out of
  // Properties, where "Assigned by" now lives).
  const epicInfo = t
    ? ((t.epic as { id: string; name: string; color?: string | null } | null) ?? null)
    : null;
  const assignedBy = t
    ? ((t.assignedBy as { name: string; deletedAt: string | null } | null) ?? null)
    : null;
  const assignedByName = assignedBy ? `${assignedBy.name}${assignedBy.deletedAt ? " (removed)" : ""}` : "—";
  const assignedAtLabel = t?.assignedAt ? new Date(String(t.assignedAt)).toLocaleString() : undefined;

  function sel(
    label: string, value: string | null, options: { id: string; name: string }[],
    onPick: (id: string | null) => void, disabled: boolean
  ) {
    const selected = options.find((o) => o.id === value);
    const dot = selected ? (selected as { color?: string }).color : undefined;
    return (
      <label className="block text-xs text-muted">
        <span className="mb-1 flex items-center gap-1">
          {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />}
          {label}
        </span>
        <select
          value={value ?? ""}
          disabled={disabled || saving !== ""}
          onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
          title={selected ? selected.name : undefined}
          className="tt-input"
        >
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Task details"
    >
      <div
        className="glass-strong flex h-full w-full max-w-lg flex-col shadow-2xl sm:rounded-l-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header: identifier + type + epic + title (task title is enough —
            the project name is not repeated inside the drawer). */}
        <div className="flex shrink-0 items-start gap-2 border-b border-line p-3">
          <div className="min-w-0 flex-1">
            {t ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className="rounded bg-accent/10 px-1.5 py-0.5 font-mono font-semibold text-accent"
                    title={`Task number ${String(t.serial)} of this project`}
                  >
                    {String(t.key)}
                  </span>
                  {epicInfo && (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-muted" title={`Epic: ${epicInfo.name}`}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: epicInfo.color ?? "currentColor" }} aria-hidden="true" />
                      <span className="max-w-[10rem] truncate">{epicInfo.name}</span>
                    </span>
                  )}
                  {typeInfo && (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-muted" title={`Issue type: ${typeInfo.name}`}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: typeInfo.color }} aria-hidden="true" />
                      <span className="max-w-[9rem] truncate">{typeInfo.name}</span>
                    </span>
                  )}
                  {saving && <span className="text-muted" role="status">Saving {saving}…</span>}
                  {!saving && justSaved && <span className="font-medium text-emerald-600 dark:text-emerald-400" role="status">Saved ✓</span>}
                </div>
                {rule("title") === "editable" ? (
                  <input
                    defaultValue={String(t.title ?? "")}
                    key={String(t.id) + String(t.updatedAt)}
                    onBlur={(e) => { if (e.target.value !== t.title) patch({ title: e.target.value }, "title"); }}
                    aria-label="Task title"
                    className="tt-input mt-1.5 font-semibold"
                  />
                ) : (
                  <h2 className="mt-1.5 break-words text-base font-semibold leading-snug">{String(t.title)}</h2>
                )}
              </>
            ) : (
              <span className="text-sm font-semibold">Task details</span>
            )}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {t && (
              <TaskMenu
                projectId={projectId}
                taskId={String(t.id)}
                taskKey={String(t.key)}
                title={String(t.title ?? "")}
                canRename={canEditThis && rule("title") === "editable"}
                canDelete={can("delete_task")}
                onChanged={() => { loadDetail(); onChanged(); }}
                onDeleted={() => { onChanged(); onClose(); }}
              />
            )}
            <button onClick={onClose} className="tt-btn shrink-0" title="Close (Esc)" aria-label="Close task panel">
              <IconX className="h-3.5 w-3.5" /> Close (Esc)
            </button>
          </div>
        </div>

        {!t ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted" role="status">
            {err || "Loading task…"}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3">
            {err && (
              <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {err}
              </p>
            )}

            <section className="mb-4">
              <h3 className={sectionTitle}>Properties</h3>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
                {sel("Status", t.statusId as string | null, lookups.statuses, (v) => {
                  if (v && v !== t.statusId) {
                    const target = lookups.statuses.find((s) => s.id === v);
                    // Moving INTO a final status never opens the Assign step (and never reassigns).
                    if (target?.category === "done") void patch({ statusId: v }, "status");
                    else setPendingStatus(v); // Assign step opens first
                  }
                }, !can("change_status"))}
                {sel("Priority", t.priorityId as string | null, lookups.priorities, (v) => v && patch({ priorityId: v }, "priority"), !(can("change_priority") || can("edit_task_own")))}
                {sel("Issue Type", t.typeId as string | null, lookups.issueTypes, (v) => patch({ typeId: v }, "issue type"), rule("type") !== "editable")}
                {sel("Assignee", t.assigneeId as string | null, lookups.members.map((x) => ({ id: x.userId, name: userOptionLabel(x) })), (v) => patch({ assigneeId: v }, "assignee"), !can("assign"))}
                {sel("Tested By", t.testedById as string | null, lookups.members.map((x) => ({ id: x.userId, name: userOptionLabel(x) })), (v) => patch({ testedById: v }, "tester"), rule("testedBy") !== "editable")}
                {rule("assignee") !== "hidden" && (
                  <label className="block text-xs text-muted">Assigned by
                    <span className={`${staticBox} gap-2`} title={assignedAtLabel}>
                      <input
                        type="checkbox"
                        checked={Boolean(t.assignedBy)}
                        disabled={!can("assign") || saving !== ""}
                        onChange={(e) => void patch({ assignedByToggle: e.target.checked }, "assigned by")}
                        aria-label="Set me as the assigned by"
                      />
                      <span className="min-w-0 flex-1 truncate">{assignedByName}</span>
                    </span>
                  </label>
                )}
              </div>
            </section>

            <section className="mb-4">
              <h3 className={sectionTitle}>Estimates</h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
                {(["estHours", "rdTime"] as const).map((f) => (
                  <label key={f} className="block text-xs text-muted">{f === "estHours" ? "Est. hours" : "R&D hrs"}
                    <input
                      type="number" step="any" min={0}
                      defaultValue={t[f] == null ? "" : String(t[f])}
                      key={String(t.id) + f + String(t.updatedAt)}
                      disabled={rule(f) !== "editable" || saving !== ""}
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v !== t[f]) patch({ [f]: v }, f);
                      }}
                      className="tt-input mt-1"
                    />
                  </label>
                ))}
                <label className="block text-xs text-muted">Est. days (auto)
                  <div className={staticBox} title="Est. hours ÷ the project's working hours per day">
                    {t.estDays == null ? "—" : String(t.estDays)}
                  </div>
                </label>
              </div>
            </section>

            <section className="mb-4">
              <h3 className={sectionTitle}>Dates</h3>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
                <label className="block text-xs text-muted">Start date
                  <input type="date" defaultValue={fmtDate(t.startDate as string | null)} key={"s" + String(t.updatedAt)}
                    disabled={rule("startDate") !== "editable"}
                    onChange={(e) => patch({ startDate: e.target.value || null }, "start")}
                    className="tt-input mt-1" />
                </label>
                <label className="block text-xs text-muted">End date
                  <input type="date" defaultValue={fmtDate(t.endDate as string | null)} key={"e" + String(t.updatedAt)}
                    disabled={rule("endDate") !== "editable"}
                    onChange={(e) => patch({ endDate: e.target.value || null }, "end")}
                    className="tt-input mt-1" />
                </label>
              </div>
            </section>

            <section className="mb-4">
              <h3 className={sectionTitle}>Description</h3>
              <textarea defaultValue={t.description ? String(t.description) : ""} key={"d" + String(t.updatedAt)} rows={5}
                disabled={rule("description") !== "editable"}
                onBlur={(e) => { if (e.target.value !== (t.description ?? "")) patch({ description: e.target.value || null }, "desc"); }}
                aria-label="Description"
                placeholder="Add a description…"
                className="tt-input leading-relaxed" />
            </section>

            <section className="mb-4 border-t border-line pt-3">
              <h3 className={sectionTitle}>Comments / Remarks / Feedback</h3>
              {(() => {
                const visibleComments = filterVisibleNotes(comments, m.fieldRules);
                const notes = buildTaskNotes(visibleComments as { id: string; kind: string; body: string; createdAt: string; solvedAt?: string | null; author: { name: string; deletedAt: string | null } | null }[]);
                if (notes.length === 0) return <p className="text-xs text-muted">No comments yet.</p>;
                return (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-md border border-line bg-canvas p-2">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="mr-1 rounded bg-line px-1">{n.type}</span>
                          <strong>{n.n}.</strong> <strong>{n.author}{n.authorDeleted ? " (removed)" : ""}</strong>{" "}
                          <span className="text-muted">{new Date(n.createdAt).toLocaleString()}</span>
                          <span className="ml-auto flex gap-1">
                            {!n.solved && (
                              <button
                                type="button"
                                className="rounded border border-emerald-300 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                                onClick={() => void solveNote(n.id)}
                                title="Mark this note as solved"
                              >
                                Solve
                              </button>
                            )}
                            <button
                              type="button"
                              className="rounded border border-line px-1.5 py-0.5 text-[10px]"
                              onClick={() => void startEditNote(n)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-600"
                              onClick={() => void deleteNote(n.id)}
                            >
                              Delete
                            </button>
                          </span>
                        </div>
                        {editingNoteId === n.id ? (
                          <div className="mt-1">
                            <textarea
                              value={editingNoteText}
                              onChange={(e) => setEditingNoteText(e.target.value)}
                              rows={3}
                              className="tt-input w-full text-sm"
                              aria-label={`Edit note ${n.n}`}
                            />
                            <div className="mt-1 flex gap-1">
                              <button type="button" onClick={() => void saveNote(n.id)} className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">Save</button>
                              <button type="button" onClick={() => { setEditingNoteId(null); setEditingNoteText(""); }} className="rounded border border-line px-2 py-0.5 text-[11px]">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-0.5 whitespace-pre-wrap text-sm">
                            {n.text}
                            {n.solved && (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400"> (solved)</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="mt-2 flex gap-1.5">
                <select value={commentKind} onChange={(e) => setCommentKind(e.target.value)}
                  className="w-24 shrink-0 rounded-md border border-line bg-surface px-1.5 py-1 text-xs">
                  <option value="comment">comment</option>
                  <option value="remark">remark</option>
                  <option value="feedback">feedback</option>
                </select>
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write…"
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs" />
                <button onClick={addComment} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent-strong dark:text-slate-950">Add</button>
              </div>
            </section>

            <section>
              <h3 className={sectionTitle}>Activity</h3>
              <ScrollableList
                items={activities}
                label="Activity"
                emptyText="No activity yet."
                maxH="max-h-64"
                renderItem={(a) => {
                  const act = a as {
                    id: string; action: string; field: string | null; before: string | null; after: string | null;
                    beforeName?: string | null; afterName?: string | null; meta?: string | null;
                    createdAt: string; actor: { name: string } | null;
                  };
                  // PHASE 4: assignment events ("task.assigned", plus legacy
                  // "task.updated" rows for the assignee field) render with the
                  // resolved names and the automation tag, not raw user ids.
                  const isAssign = act.action === "task.assigned" || (act.action === "task.updated" && act.field === "assigneeId");
                  if (isAssign) {
                    let via = "";
                    try {
                      const meta = JSON.parse(act.meta ?? "{}") as { via?: string };
                      if (meta.via) via = ` · ${meta.via}`;
                    } catch { /* legacy rows have no meta */ }
                    const to = act.after ? `assigned to ${act.afterName ?? "someone"}` : "unassigned";
                    const from = act.before ? ` (was ${act.beforeName ?? "someone"})` : "";
                    return (
                      <span className="text-muted">
                        {new Date(act.createdAt).toLocaleString()} — {act.actor?.name ?? "system"} {to}{from}{via}
                      </span>
                    );
                  }
                  return (
                    <span className="text-muted">
                      {new Date(act.createdAt).toLocaleString()} — {act.actor?.name ?? "system"} {act.action}
                      {act.field ? ` ${act.field}: ${act.before ?? "—"} → ${act.after ?? "—"}` : ""}
                    </span>
                  );
                }}
              />
            </section>

            {pendingStatus && (
              <AssignStepDialog
                lookups={lookups}
                statusId={pendingStatus}
                currentAssigneeId={t.assigneeId as string | null}
                onCancel={() => setPendingStatus(null)}
                onConfirm={(assigneeId) => {
                  const sid = pendingStatus;
                  setPendingStatus(null);
                  void patch(assigneeId ? { statusId: sid, assigneeId } : { statusId: sid }, "status");
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
