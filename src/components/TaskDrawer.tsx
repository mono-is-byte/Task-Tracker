"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import type { Lookups } from "@/hooks/useProject";
import { useTaskRow, patchTask } from "@/lib/taskStore";
import AssignStepDialog from "@/components/AssignStepDialog";
import TaskMenu from "@/components/TaskMenu";
import ScrollableList from "@/components/ScrollableList";
import { memberLabel } from "@/lib/memberLabel";

interface Props {
  projectId: string;
  taskId: string | null;
  lookups: Lookups;
  onClose: () => void;
  onChanged: () => void;
}

/** ISO → "YYYY-MM-DDTHH:mm" in local time (for datetime-local inputs). */
function toLocalInput(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TaskDrawer({ projectId, taskId, lookups, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [activities, setActivities] = useState<unknown[]>([]);
  const [comment, setComment] = useState("");
  const [commentKind, setCommentKind] = useState("comment");
  const [saving, setSaving] = useState("");
  const [err, setErr] = useState("");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const m = lookups.membership;
  const can = (a: string) => m.perms[a] === true || m.isSuperAdmin;
  const rule = (f: string) => (m.isSuperAdmin ? "editable" : (m.fieldRules[f] ?? "readonly"));
  const isManager = m.isSuperAdmin || m.perms.manage_workflow === true || m.perms.manage_archive === true;
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

  if (!taskId) return null;
  const tid: string = taskId; // captured for the callbacks below (TS narrowing)

  /** Edits go through the shared store: optimistic + rolled back on failure. */
  async function patch(fields: Record<string, unknown>, _label: string) {
    setSaving(_label);
    setErr("");
    try {
      await patchTask(projectId, tid, fields);
      // reload full detail (automation side effects, fresh activity list)
      await loadDetail();
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

  // Store row wins (live); detail fills in until the store has loaded.
  const t: Record<string, unknown> | null = (storeTask as Record<string, unknown> | undefined) ?? detail;
  const comments = (t?.comments as { id: string; kind: string; body: string; author: { name: string }; createdAt: string }[] | undefined) ?? [];
  // Client-side gate for the ⋯ menu; the API re-checks every action server-side.
  const canEditThis = !!t && (
    m.isSuperAdmin || m.perms.edit_task_all === true ||
    (m.perms.edit_task_own === true && (t.assigneeId == null || t.assigneeId === m.userId))
  );

  function sel(
    label: string, value: string | null, options: { id: string; name: string }[],
    onPick: (id: string | null) => void, disabled: boolean
  ) {
    const selected = options.find((o) => o.id === value);
    return (
      <label className="block text-xs text-slate-500">{label}
        <select
          value={value ?? ""}
          disabled={disabled || saving !== ""}
          onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
          title={selected ? selected.name : undefined}
          className="mt-0.5 w-full rounded border p-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-auto bg-white p-4 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {!t ? (
          <p className="text-sm">{err || "Loading…"}</p>
        ) : (
          <>
            <div className="mb-2 flex items-start gap-2">
              <span className="font-mono text-sm text-slate-500">{String(t.key)}</span>
              <div className="ml-auto">
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
              </div>
              <button onClick={onClose} className="rounded border px-2 text-sm">✕ Close (Esc)</button>
            </div>
            {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
            {rule("title") === "editable" ? (
              <input
                defaultValue={String(t.title ?? "")}
                key={String(t.id) + String(t.updatedAt)}
                onBlur={(e) => { if (e.target.value !== t.title) patch({ title: e.target.value }, "title"); }}
                className="mb-2 w-full rounded border p-2 font-bold dark:border-slate-700 dark:bg-slate-800"
              />
            ) : (
              <h2 className="mb-2 text-lg font-bold">{String(t.title)}</h2>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2">
              {sel("Status", t.statusId as string | null, lookups.statuses, (v) => {
                if (v && v !== t.statusId) {
                  const target = lookups.statuses.find((s) => s.id === v);
                  // Moving INTO a final status never opens the Assign step (and never reassigns).
                  if (target?.category === "done") void patch({ statusId: v }, "status");
                  else setPendingStatus(v); // Assign step opens first
                }
              }, !can("change_status"))}
              {sel("Priority", t.priorityId as string | null, lookups.priorities, (v) => v && patch({ priorityId: v }, "priority"), !(can("change_priority") || can("edit_task_own")))}
              {sel("Assignee", t.assigneeId as string | null, lookups.members.map((x) => ({ id: x.userId, name: memberLabel(x) })), (v) => patch({ assigneeId: v }, "assignee"), !(can("assign") || can("edit_task_own")))}
              {sel("Tested By", t.testedById as string | null, lookups.members.map((x) => ({ id: x.userId, name: memberLabel(x) })), (v) => patch({ testedById: v }, "tester"), rule("testedBy") !== "editable")}
              {sel("Epic", t.epicId as string | null, lookups.epics, (v) => patch({ epicId: v }, "epic"), rule("epic") !== "editable")}
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
              {(["estHours", "rdTime"] as const).map((f) => (
                <label key={f} className="block text-xs text-slate-500">{f === "estHours" ? "Est. hours" : "R&D hrs"}
                  <input
                    type="number" step="any" min={0}
                    defaultValue={t[f] == null ? "" : String(t[f])}
                    key={String(t.id) + f + String(t.updatedAt)}
                    disabled={rule(f) !== "editable" || saving !== ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== t[f]) patch({ [f]: v }, f);
                    }}
                    className="mt-0.5 w-full rounded border p-1 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
              ))}
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Est. days (auto): <strong>{t.estDays == null ? "—" : String(t.estDays)}</strong>
            </p>
            <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
              <label className="block text-xs text-slate-500">Start date
                <input type="date" defaultValue={fmtDate(t.startDate as string | null)} key={"s" + String(t.updatedAt)}
                  disabled={rule("startDate") !== "editable"}
                  onChange={(e) => patch({ startDate: e.target.value || null }, "start")}
                  className="mt-0.5 w-full rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
              </label>
              <label className="block text-xs text-slate-500">End date
                <input type="date" defaultValue={fmtDate(t.endDate as string | null)} key={"e" + String(t.updatedAt)}
                  disabled={rule("endDate") !== "editable"}
                  onChange={(e) => patch({ endDate: e.target.value || null }, "end")}
                  className="mt-0.5 w-full rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
              </label>
              {/* Due date drives the calendar, overdue highlighting and the
                  timeline — editing it stays here (the timer box is gone; the
                  Start/Stop controls live on the board and table cards). */}
              <label className="block text-xs text-slate-500">Due
                <input type="datetime-local" defaultValue={toLocalInput(t.dueAt)} key={"du" + String(t.updatedAt)}
                  disabled={!isManager || saving !== ""}
                  onChange={(e) => patch({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null }, "due")}
                  className="mt-0.5 w-full rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
              </label>
            </div>
            <label className="mb-3 block text-xs text-slate-500">Description
              <textarea defaultValue={t.description ? String(t.description) : ""} key={"d" + String(t.updatedAt)} rows={3}
                disabled={rule("description") !== "editable"}
                onBlur={(e) => { if (e.target.value !== (t.description ?? "")) patch({ description: e.target.value || null }, "desc"); }}
                className="mt-0.5 w-full rounded border p-1 text-sm dark:border-slate-700 dark:bg-slate-800" />
            </label>

            <div className="mb-3">
              <h3 className="mb-1 text-sm font-semibold">Comments / Remarks / Feedback</h3>
              <ScrollableList
                items={comments}
                label="Comments"
                emptyText="No comments yet."
                maxH="max-h-48"
                renderItem={(c) => {
                  const cm = c as { id: string; kind: string; body: string; author: { name: string }; createdAt: string };
                  return (
                    <div className="rounded bg-slate-50 p-2 dark:bg-slate-800">
                      <span className="mr-1 rounded bg-slate-200 px-1 dark:bg-slate-700">{cm.kind}</span>
                      <strong>{cm.author.name}</strong>{" "}
                      <span className="text-slate-500">{new Date(cm.createdAt).toLocaleString()}</span>
                      <div className="mt-0.5 whitespace-pre-wrap">{cm.body}</div>
                    </div>
                  );
                }}
              />
              <div className="mt-2 flex gap-1">
                <select value={commentKind} onChange={(e) => setCommentKind(e.target.value)}
                  className="rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800">
                  <option value="comment">comment</option>
                  <option value="remark">remark</option>
                  <option value="feedback">feedback</option>
                </select>
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write…"
                  className="flex-1 rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
                <button onClick={addComment} className="rounded bg-indigo-600 px-2 text-xs font-semibold text-white">Add</button>
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-sm font-semibold">Activity</h3>
              <ScrollableList
                items={activities}
                label="Activity"
                emptyText="No activity yet."
                maxH="max-h-64"
                renderItem={(a) => {
                  const act = a as { id: string; action: string; field: string | null; before: string | null; after: string | null; createdAt: string; actor: { name: string } | null };
                  return (
                    <span className="text-slate-500">
                      {new Date(act.createdAt).toLocaleString()} — {act.actor?.name ?? "system"} {act.action}
                      {act.field ? ` ${act.field}: ${act.before ?? "—"} → ${act.after ?? "—"}` : ""}
                    </span>
                  );
                }}
              />
            </div>
            {saving && <p className="mt-2 text-xs text-slate-500">Saving {saving}…</p>}
            {pendingStatus && t && (
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
          </>
        )}
      </div>
    </div>
  );
}
