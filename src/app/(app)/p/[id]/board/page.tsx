"use client";

import { Fragment, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import { useTicker } from "@/hooks/useTicker";
import {
  useTasks, patchTask, createTask, timerAction, removeTask, refreshTasks, type TaskRow,
} from "@/lib/taskStore";
import TaskDrawer from "@/components/TaskDrawer";
import TaskMenu from "@/components/TaskMenu";
import AssignStepDialog from "@/components/AssignStepDialog";
import Avatar from "@/components/Avatar";
import { timerChipClass, timerSummary, fmtDur } from "@/lib/timerFormat";
import { IconCalendar, IconClipboardCheck, IconPause, IconPlay, IconX } from "@/components/icons";

type Card = TaskRow & {
  serial: number; key: string; title: string;
  estDays: number | null;
  statusId: string; status: { name: string; color: string; category: string; timerRole: string };
  priority: { name: string; color: string };
  typeId: string | null; type: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  testedBy: { id: string; name: string } | null;
  epic: { id: string; name: string } | null;
  position: number;
  startedAt: string | null; stoppedAt: string | null; dueAt: string | null;
  stageEnteredAt: string | null; totalSeconds: number | null;
  timerState: string; timerWorkedMs: number | null; timerRemainingMs: number | null; timerOverdueMs: number | null;
};

/** Left-border colour by timer state (colour + text label, never colour alone). */
const TIMER_BORDER: Record<string, string> = {
  running: "border-l-blue-500",
  overdue: "border-l-red-500",
  finished: "border-l-green-500",
  paused: "border-l-transparent",
  not_started: "border-l-transparent",
};

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const searchParams = useSearchParams();
  const { data: lookups } = useProject(projectId);
  // Single source of truth (item 7): the board renders the shared store.
  const { tasks: cards, loading, error } = useTasks(projectId);
  const typed = cards as Card[];
  const [drawerId, setDrawerId] = useState<string | null>(searchParams.get("task"));
  const [lane, setLane] = useState("");
  const [msg, setMsg] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ cardId: string; toStatusId: string; toPosition: number } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  // Live counting: tick once a second while any card on the board is running.
  const anyRunning = typed.some((c) => c.timerState === "running" || c.timerState === "overdue");
  const now = useTicker(anyRunning);

  const wipLimits = (lookups?.project.settings.wipLimits ?? {}) as Record<string, number>;

  const lanes = useMemo(() => {
    if (!lane) return [{ name: "", cards: typed }];
    const map = new Map<string, Card[]>();
    for (const c of typed) {
      const name =
        lane === "assignee" ? (c.assignee?.name ?? "(unassigned)") :
        lane === "epic" ? (c.epic?.name ?? "(no project name)") :
        lane === "type" ? (c.type?.name ?? "(no issue type)") :
        lane === "priority" ? c.priority.name : "";
      const arr = map.get(name) ?? [];
      arr.push(c);
      map.set(name, arr);
    }
    return [...map.entries()].map(([name, items]) => ({ name, cards: items }));
  }, [typed, lane]);

  if (!lookups) return <p className="text-sm">Loading board…</p>;
  const canChange = lookups.membership.perms.change_status === true || lookups.membership.isSuperAdmin;
  // Task creation is PM/Admin only (Phase 1) — server enforces `create_task` too.
  const canCreate = lookups.membership.perms.create_task === true || lookups.membership.isSuperAdmin;
  // Creation rule (change request): new tasks may only be started in the To Do
  // column. The server forces this status (defaultCreationStatusId), so hiding
  // the other columns' add buttons is UX, not the enforcement.
  const createStatusId =
    (lookups.statuses.find((s) => s.category === "todo") ?? lookups.statuses[0])?.id ?? null;

  /** Status change: optimistic through the shared store; the server applies
   *  the timer bookkeeping (auto-stop on transition, Done freeze). */
  async function moveCard(cardId: string, toStatusId: string, toPosition?: number, assigneeId?: string | null) {
    setMsg("");
    const assigned = assigneeId ? lookups?.members.find((m) => m.userId === assigneeId) : undefined;
    try {
      await patchTask(projectId, cardId, {
        statusId: toStatusId,
        ...(toPosition !== undefined ? { position: toPosition } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(assigneeId && assigned
          ? { assignee: { id: assigneeId, name: assigned.name, avatarUrl: assigned.avatarUrl } }
          : {}),
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Move not allowed.");
    }
  }

  const me = lookups.membership.userId;
  const isManager =
    lookups.membership.isSuperAdmin ||
    lookups.membership.perms.manage_workflow === true ||
    lookups.membership.perms.manage_archive === true;
  const canOperate = (c: Card) => isManager || (c.assignee?.id ?? null) === me;
  // Actions-menu gates (server re-checks): rename ≈ can edit the task, delete = delete_task.
  const canDelete = lookups.membership.perms.delete_task === true || lookups.membership.isSuperAdmin;
  const canManageCard = (c: Card) =>
    lookups.membership.isSuperAdmin ||
    lookups.membership.perms.edit_task_all === true ||
    (lookups.membership.perms.edit_task_own === true && (c.assignee == null || c.assignee.id === me));

  async function timerCardAction(c: Card, action: "start" | "stop") {
    setMsg("");
    try {
      await timerAction(projectId, c.id, action);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Timer action failed.");
    }
  }

  async function addTask() {
    const title = addTitle.trim();
    if (!title || !createStatusId) return;
    try {
      // No statusId: the server always creates in To Do (creation rule).
      await createTask(projectId, { title });
      setAddingTo(null);
      setAddTitle("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add task.");
    }
  }

  function cardView(c: Card) {
    const isTrack = c.status.timerRole === "TRACK";
    const showStart = canOperate(c) && isTrack && (c.timerState === "not_started" || c.timerState === "paused");
    const showStop = canOperate(c) && isTrack && (c.timerState === "running" || c.timerState === "overdue");
    return (
      <div
        key={c.id}
        draggable={canChange}
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => setDragId(null)}
        onClick={() => setDrawerId(c.id)}
        className={`mb-1.5 cursor-pointer rounded-lg border border-l-4 bg-surface p-2 shadow-sm transition-shadow hover:shadow ${TIMER_BORDER[c.timerState] ?? "border-l-transparent"} ${dragId === c.id ? "opacity-40" : ""}`}
      >
        {/* Identifier + issue type + priority + actions on one aligned row (change request 2/3/5). */}
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span
            className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent"
            title={`Task number ${c.serial}`}
          >
            {c.key}
          </span>
          {c.type && (
            <span
              className="inline-flex min-w-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px]"
              title={`Issue type: ${c.type.name}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.type.color }} aria-hidden="true" />
              <span className="max-w-[5rem] truncate">{c.type.name}</span>
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="inline-flex items-center gap-0.5" style={{ color: c.priority.color }} title={`Priority: ${c.priority.name}`}>
              <span aria-hidden="true">●</span>
              <span className="max-w-[4.5rem] truncate">{c.priority.name}</span>
            </span>
            <TaskMenu
              projectId={projectId}
              taskId={c.id}
              taskKey={c.key}
              title={c.title}
              canRename={canManageCard(c)}
              canDelete={canDelete}
              onChanged={() => void removeTaskRefetch(c.id)}
            />
          </div>
        </div>
        <div className="mt-1 break-words text-xs font-semibold leading-snug">{c.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {c.assignee && (
            <span className="flex min-w-0 items-center gap-1" title={`Assignee: ${c.assignee.name}`}>
              <Avatar name={c.assignee.name} url={c.assignee.avatarUrl} size={20} />
              <span className="max-w-[6rem] truncate">{c.assignee.name}</span>
            </span>
          )}
          {c.estDays != null && <span className="inline-flex items-center gap-0.5" title="Est. days"><IconCalendar className="h-3 w-3" /> {c.estDays}d</span>}
          {c.testedBy && <span className="inline-flex items-center gap-0.5" title={`Tested by ${c.testedBy.name}`}><IconClipboardCheck className="h-3 w-3" /> {initials(c.testedBy.name)}</span>}
        </div>
        {c.status.timerRole !== "NONE" && (
          <div className="mt-1 flex items-center gap-1">
            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${timerChipClass(c.timerState)}`}>
              {timerSummary(c, now)}
            </span>
            {showStart && (
              <button
                onClick={(e) => { e.stopPropagation(); void timerCardAction(c, "start"); }}
                className="ml-auto inline-flex items-center gap-0.5 rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
                title="Start the timer for this stage"
              >
                <IconPlay className="h-2.5 w-2.5" /> Start
              </button>
            )}
            {showStop && (
              <button
                onClick={(e) => { e.stopPropagation(); void timerCardAction(c, "stop"); }}
                className="ml-auto inline-flex items-center gap-0.5 rounded border border-red-300 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                title="Stop the timer (work on this stage is done)"
              >
                <IconPause className="h-2.5 w-2.5" /> Stop
              </button>
            )}
          </div>
        )}
        {c.status.timerRole === "FINAL" && (
          <div className="mt-1 text-[10px] font-medium text-green-700 dark:text-green-300">
            Total time: {fmtDur(c.timerWorkedMs)}
          </div>
        )}
      </div>
    );
  }

  // The actions menu renamed/deleted the task — refresh the shared store.
  function removeTaskRefetch(_id: string) {
    // Rename: the store is refetched by the SSE event; delete: remove locally.
    // TaskMenu performs its own API call, so just nudge the store.
    refreshTasks(projectId);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <select value={lane} onChange={(e) => setLane(e.target.value)} className="rounded-md border border-line bg-surface p-1.5">
          <option value="">No swimlanes</option>
          <option value="assignee">Swimlanes: Assignee</option>
          <option value="epic">Swimlanes: Project Name</option>
          <option value="type">Swimlanes: Issue Type</option>
          <option value="priority">Swimlanes: Priority</option>
        </select>
        {!canChange && <span className="text-slate-500">(Your role cannot change status — drag disabled)</span>}
        {(msg || error) && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">{msg || error}</span>}
        <span className="ml-auto text-slate-500">{loading ? "Loading…" : `Live ● SSE${typeof window !== "undefined" && "EventSource" in window ? "" : " (polling)"}`}</span>
      </div>

      {lanes.map((l) => (
        <Fragment key={l.name || "all"}>
          {l.name && <h3 className="mb-1 mt-2 text-sm font-semibold">{l.name}</h3>}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {lookups.statuses.map((s) => {
              const col = l.cards.filter((c) => c.statusId === s.id).sort((a, b) => a.position - b.position || a.serial - b.serial);
              const limit = wipLimits[s.id];
              const over = limit != null && col.length > limit;
              return (
                <div key={s.id}
                  onDragOver={(e) => { if (canChange) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && canChange) {
                      const moving = typed.find((c) => c.id === dragId);
                      if (moving && moving.statusId !== s.id) {
                        if (s.category === "done") {
                          // Timer rule: moving INTO a final status never opens the
                          // "Assign to" step and never changes the assignee.
                          void moveCard(dragId, s.id, col.length);
                        } else {
                          // Status change → open the "Assign to" step first
                          setPendingMove({ cardId: dragId, toStatusId: s.id, toPosition: col.length });
                        }
                      } else {
                        void moveCard(dragId, s.id, col.length);
                      }
                      setDragId(null);
                    }
                  }}
                  className="w-64 shrink-0 rounded bg-slate-100 p-1 dark:bg-slate-800/60">
                  <div className="mb-1 flex items-center gap-1 px-1 text-xs font-bold" style={{ color: s.color }}>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                    <span className="text-slate-500">({col.length}{limit != null ? `/${limit}` : ""})</span>
                    {over && <span className="rounded bg-red-600 px-1 text-[10px] text-white">WIP!</span>}
                  </div>
                  {col.map((c) => cardView(c))}
                  {canCreate && s.id === createStatusId && addingTo !== s.id && (
                    <button
                      onClick={() => { setAddingTo(s.id); setAddTitle(""); }}
                      className="mt-1 w-full rounded border border-dashed p-1 text-[11px] text-slate-500 hover:bg-line/50 dark:border-slate-700"
                    >
                      + Add Task
                    </button>
                  )}
                  {addingTo === s.id && (
                    <form
                      onSubmit={(e) => { e.preventDefault(); void addTask(); }}
                      className="mt-1 flex gap-1"
                    >
                      <input
                        autoFocus
                        value={addTitle}
                        onChange={(e) => setAddTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") { setAddingTo(null); setAddTitle(""); } }}
                        placeholder="Task title…"
                        className="w-full rounded border px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                      />
                      <button type="submit" className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] text-white">Add</button>
                      <button
                        type="button"
                        onClick={() => { setAddingTo(null); setAddTitle(""); }}
                        className="rounded border px-2 py-0.5 text-[11px] dark:border-slate-700"
                        title="Cancel"
                        aria-label="Cancel"
                      >
                        <IconX className="h-3 w-3" />
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </Fragment>
      ))}

      <TaskDrawer projectId={projectId} taskId={drawerId} lookups={lookups}
        onClose={() => setDrawerId(null)} onChanged={() => undefined} />

      {pendingMove && (
        <AssignStepDialog
          lookups={lookups}
          statusId={pendingMove.toStatusId}
          currentAssigneeId={typed.find((c) => c.id === pendingMove.cardId)?.assignee?.id ?? null}
          onCancel={() => setPendingMove(null)}
          onConfirm={(assigneeId) => {
            const m = pendingMove;
            setPendingMove(null);
            void moveCard(m.cardId, m.toStatusId, m.toPosition, assigneeId);
          }}
        />
      )}
    </div>
  );
}
