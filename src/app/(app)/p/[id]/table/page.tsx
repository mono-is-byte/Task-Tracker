"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, fmtDate } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import { useTicker } from "@/hooks/useTicker";
import { useTasks, patchTask, createTask, timerAction, refreshTasks, type TaskRow } from "@/lib/taskStore";
import { fmtDateTime, fmtDur, timerChipClass, timerSummary } from "@/lib/timerFormat";
import { memberLabel, userOptionLabel } from "@/lib/memberLabel";
import { buildTaskNotes, filterVisibleNotes, notesAsLines } from "@/lib/notes";
import Avatar from "@/components/Avatar";
import TaskDrawer from "@/components/TaskDrawer";
import TaskMenu from "@/components/TaskMenu";
import AssignStepDialog from "@/components/AssignStepDialog";
import { IconCheck, IconDownload, IconLock, IconPause, IconPlay, IconPlus, IconUpload, IconWarning } from "@/components/icons";

/**
 * Table view — a fully editable, live view of the SAME task data used by the
 * board, timeline and drawer (item 7): every row reads/writes the shared task
 * store (`@/lib/taskStore`), which is kept in sync by SSE + optimistic
 * updates, so edits appear everywhere instantly and changes made elsewhere
 * (other views, other users) appear here without a refresh.
 *
 * Inline editing rules: save on blur/Enter, cancel on Esc, optimistic with a
 * per-cell saving/saved/error indicator (the store rolls the row back when
 * the server rejects the change). Computed/system columns (key, est. days,
 * total time, start time, created/updated) are read-only and
 * visually marked with a lock icon. Status changes reuse the board's rules
 * including the Assign step and the stage-timer bookkeeping (server-side).
 */

type Task = TaskRow & {
  serial: number; key: string; title: string; description: string | null;
  estHours: number | null; estDays: number | null; rdTime: number; loggedHours: number;
  statusId: string; status: { name: string; color: string; category: string; timerRole: string };
  priorityId: string; priority: { name: string; color: string };
  assigneeId: string | null; assignee: { id: string; name: string; avatarUrl: string | null } | null;
  /** PHASE 4: system "assigned by" snapshot (read-only). */
  assignedById: string | null; assignedAt: string | null;
  assignedBy: { id: string; name: string; deletedAt: string | null } | null;
  testedById: string | null; testedBy: { id: string; name: string } | null;
  epicId: string | null; epic: { id: string; name: string } | null;
  typeId: string | null; type: { id: string; name: string } | null;
  /** PHASE 11.3: unified notes (comments + remarks + feedback). */
  comments?: { id: string; kind: string; body: string; createdAt: string; author: { name: string; deletedAt?: string | null } | null }[];
  labels: string[]; customValues: Record<string, unknown>;
  startDate: string | null; endDate: string | null; dueAt: string | null;
  startedAt: string | null; stoppedAt: string | null; stageEnteredAt: string | null; totalSeconds: number | null;
  timerState: string; timerWorkedMs: number | null; timerRemainingMs: number | null; timerOverdueMs: number | null;
  createdAt: string; updatedAt: string;
};

// Change request (table redesign): the "Labels", "Due" and "Logged" columns
// are gone from the table. The task fields behind them (labels, dueAt,
// loggedHours) are untouched — the drawer, board, reports and API keep using
// them, and nothing in the database was rewritten.
const BASE_COLS = [
  // Description sits immediately beside the task title so the Board/dialog
  // description is readable in the main table without hunting for it.
  "key", "title", "description", "status",
  // PHASE 11.5: exact order Assigned by → Assignee → Tested by.
  "assignedBy", "assignee", "testedBy",
  "priority", "type",
  "startDate", "endDate", "estHours", "estDays", "rdTime",
  "epic", "notes",
  "timerStart", "timerDue", "timerState", "timerActual",
  "createdAt", "updatedAt",
] as const;
type BaseCol = (typeof BASE_COLS)[number];
type Col = BaseCol | `cf:${string}`;
/** Hidden by default (still available via "Hide column…"/show list). */
const DEFAULT_HIDDEN: Col[] = ["rdTime", "createdAt", "updatedAt"];

const RO_COLS = new Set<Col>(["key", "estDays", "timerStart", "timerActual", "createdAt", "updatedAt", "assignedBy"]);

/** Numeric/duration columns read better right-aligned (table redesign). */
const RIGHT_COLS = new Set<Col>([
  "estHours", "estDays", "rdTime", "timerStart", "timerDue", "timerActual", "createdAt", "updatedAt",
]);

/**
 * The per-project table layout (hidden columns + column widths) is remembered on
 * the DEVICE, so hiding/showing columns or resizing a column survives a reload
 * (requirement: "column show/hide preserved across sessions") without touching
 * the API or other people's saved views. Storage can be unavailable (private
 * mode), so everything is wrapped and invalid entries are dropped on read.
 */
const layoutKey = (projectId: string) => `tt_table_layout_${projectId}`;

function readTableLayout(projectId: string): { hidden?: Col[]; widths?: Record<string, number> } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(layoutKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { hidden?: unknown; widths?: unknown };
    const hidden = Array.isArray(parsed.hidden)
      ? (parsed.hidden.filter((c) => typeof c === "string") as Col[])
      : undefined;
    let widths: Record<string, number> | undefined;
    if (parsed.widths && typeof parsed.widths === "object" && !Array.isArray(parsed.widths)) {
      widths = {};
      for (const [k, v] of Object.entries(parsed.widths as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 48) widths[k] = Math.round(v);
      }
    }
    return { hidden, widths };
  } catch {
    return {};
  }
}

function writeTableLayout(projectId: string, hidden: Col[], widths: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(layoutKey(projectId), JSON.stringify({ hidden, widths }));
  } catch {
    /* storage unavailable (private mode) — the layout simply won't persist */
  }
}

// Before paint on the client, plain effect during SSR (where useLayoutEffect warns).
// Same pattern as ThemeSync: the restore must be invisible, and the server render
// must stay deterministic (reading storage during render would break hydration).
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** ISO → "YYYY-MM-DDTHH:mm" in local time (for datetime-local inputs). */
function toLocalInput(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ArrowUp/Down move focus between rows in the same column (DOM-only). */
function moveCellFocus(e: React.KeyboardEvent, col: Col) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const td = (e.target as HTMLElement).closest("td");
  if (!td) return;
  const cells = Array.from(document.querySelectorAll(`td[data-col="${col}"]`));
  const i = cells.indexOf(td);
  const next = cells[e.key === "ArrowDown" ? i + 1 : i - 1] as HTMLElement | undefined;
  const f = next?.querySelector("input,select,textarea") as HTMLElement | null;
  if (f) { e.preventDefault(); f.focus(); }
}

/** Local saving/saved/error state for one cell. */
function useCellCommit(onCommit: (value: unknown) => Promise<unknown>) {
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const run = useCallback(async (v: unknown) => {
    setStatus("saving");
    try {
      await onCommit(v);
      setStatus("saved");
    } catch {
      setStatus("error"); // the store already rolled the row back
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 2000);
  }, [onCommit]);
  return { status, run };
}

function CellStatus({ status }: { status: "" | "saving" | "saved" | "error" }) {
  if (!status) return null;
  if (status === "saving") return <span className="ml-1 text-[10px] text-slate-400" title="Saving…">…</span>;
  if (status === "saved") return <span className="ml-1 inline-flex align-middle text-green-600 dark:text-green-400" title="Saved"><IconCheck className="h-3 w-3" /></span>;
  return <span className="ml-1 inline-flex align-middle text-red-600 dark:text-red-400" title="Save failed — the cell was reverted"><IconWarning className="h-3 w-3" /></span>;
}

/** The little lock that marks computed/system columns as read-only. */
function LockMark() {
  return <span className="ml-1 inline-flex align-middle text-slate-400"><IconLock className="h-3 w-3" /></span>;
}

const cellInput =
  "w-full min-w-20 rounded border border-transparent bg-transparent p-0.5 hover:border-slate-300 focus:border-slate-400 dark:hover:border-slate-600 dark:focus:border-slate-500";

/** One compact toolbar control so the filter row, export buttons and saved
 *  views all share the same height and border (change request: table redesign). */
const fieldCls =
  "h-8 rounded-md border border-line bg-surface px-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent/30";

function TextCell({ value, onCommit, col, multiline }: { value: string; onCommit: (v: unknown) => Promise<unknown>; col: Col; multiline?: boolean }) {
  const { status, run } = useCellCommit(onCommit);
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  // Escape reverts THEN blurs synchronously — onBlur would still see the old
  // text and commit it. A flag tells onBlur "this blur is a cancel".
  const cancelledRef = useRef(false);
  const cancel = () => {
    cancelledRef.current = true;
    setText(value);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const commitOnBlur = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    if (text !== value) void run(text);
  };
  const keyHandler = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) { e.preventDefault(); (e.target as HTMLElement).blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else moveCellFocus(e, col);
  };
  if (multiline) {
    return (
      <span className="flex items-start">
        <textarea value={text} rows={1} onChange={(e) => setText(e.target.value)} onBlur={commitOnBlur} onKeyDown={keyHandler}
          className={`${cellInput} resize-none`} />
        <CellStatus status={status} />
      </span>
    );
  }
  return (
    <span className="flex items-center">
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commitOnBlur} onKeyDown={keyHandler}
        className={cellInput} />
      <CellStatus status={status} />
    </span>
  );
}

/**
 * PHASE 11.2: the Table's Description cell. Plain text, first lines truncated
 * with the full value in a tooltip; click to edit when the role may edit it.
 * (No HTML is ever rendered.)
 */
function LongTextCell({
  value, onCommit, editable,
}: {
  value: string; onCommit: (v: unknown) => Promise<unknown>; editable: boolean;
}) {
  const { status, run } = useCellCommit(onCommit);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  if (!editing || !editable) {
    return (
      <span
        className={`block max-w-56 truncate ${editable ? "cursor-text" : ""}`}
        title={value || "—"}
        onClick={() => { if (editable) setEditing(true); }}
      >
        {value || "—"}
        <CellStatus status={status} />
      </span>
    );
  }
  const finish = (save: boolean) => {
    setEditing(false);
    if (save && text !== value) void run(text);
    else setText(value);
  };
  return (
    <span className="flex items-start">
      <textarea
        autoFocus
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); finish(false); }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); }
        }}
        className={`${cellInput} min-w-56 resize-none`}
        aria-label="Description"
      />
      <CellStatus status={status} />
    </span>
  );
}

function NotesCell({ t }: { t: Task }) {
  const notes = buildTaskNotes(t.comments);
  const shown = notes.slice(-3);
  const more = notes.length - shown.length;
  const tip = notes.map((n) => `${n.n}. ${n.text}`).join("\n");
  if (notes.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="block max-w-60 cursor-pointer" title={tip}>
      {shown.map((n) => (
        <span key={n.id} className="block truncate text-xs">
          <span className="font-medium text-slate-500">{n.n}.</span> {n.text}
        </span>
      ))}
      {more > 0 && <span className="text-xs text-slate-400">+{more} more</span>}
    </span>
  );
}

function NumberCell({ value, onCommit, col, step }: { value: number | null; onCommit: (v: unknown) => Promise<unknown>; col: Col; step?: string }) {
  const { status, run } = useCellCommit(onCommit);
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => { setText(value == null ? "" : String(value)); }, [value]);
  const cancelledRef = useRef(false);
  const commitOnBlur = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    const v = text === "" ? null : Number(text);
    if (v !== value) void run(v);
  };
  return (
    <span className="flex items-center">
      <input type="number" step={step ?? "any"} min={0} value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitOnBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); }
          else if (e.key === "Escape") {
            cancelledRef.current = true;
            setText(value == null ? "" : String(value));
            (document.activeElement as HTMLElement | null)?.blur();
          }
          else moveCellFocus(e, col);
        }}
        className={`${cellInput} w-20`} />
      <CellStatus status={status} />
    </span>
  );
}

function DateCell({ value, onCommit, col, datetime }: { value: string | null; onCommit: (v: unknown) => Promise<unknown>; col: Col; datetime?: boolean }) {
  const { status, run } = useCellCommit(onCommit);
  const initial = datetime ? toLocalInput(value) : fmtDate(value);
  const [text, setText] = useState(initial);
  useEffect(() => { setText(datetime ? toLocalInput(value) : fmtDate(value)); }, [value, datetime]);
  const cancelledRef = useRef(false);
  const commitOnBlur = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    const iso = text
      ? (datetime ? new Date(text).toISOString() : new Date(`${text}T00:00:00`).toISOString())
      : null;
    if ((value ?? null) !== iso) void run(iso);
  };
  return (
    <span className="flex items-center">
      <input type={datetime ? "datetime-local" : "date"} value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitOnBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelledRef.current = true;
            setText(initial);
            (document.activeElement as HTMLElement | null)?.blur();
          }
          else moveCellFocus(e, col);
        }}
        className={`${cellInput} w-40`} />
      <CellStatus status={status} />
    </span>
  );
}

function SelectCell({
  value, options, onCommit, col, renderOption,
}: {
  value: string | null;
  options: { id: string; name: string; hint?: string; retired?: boolean }[];
  onCommit: (v: unknown) => Promise<unknown>;
  col: Col;
  renderOption?: (o: { id: string; name: string }) => string;
}) {
  const { status, run } = useCellCommit(onCommit);
  // Change request: a task can still hold a value the configuration no longer
  // offers (e.g. the removed Customer Impact option). Show the saved value
  // instead of silently blanking the cell, label it as removed, and disable
  // the entry so it is never offered for new/other edits.
  const opts = value != null && value !== "" && !options.some((o) => o.id === value)
    ? [...options, { id: value, name: `${value} (removed option)`, retired: true, hint: "Saved value — this option is no longer configured" }]
    : options;
  return (
    <span className="flex items-center">
      <select value={value ?? ""} title={opts.find((o) => o.id === value)?.hint}
        onChange={(e) => { if ((value ?? "") !== e.target.value) void run(e.target.value || null); }}
        onKeyDown={(e) => moveCellFocus(e, col)}
        className={`${cellInput} max-w-44`}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={o.id} disabled={o.retired}>{renderOption ? renderOption(o) : o.name}</option>)}
      </select>
      <CellStatus status={status} />
    </span>
  );
}

/** Custom-field editor picked by fieldType. */
function CustomFieldCell({
  fieldType, options, value, members, onCommit, col,
}: {
  fieldType: string; options: string[]; value: unknown;
  members: { userId: string; name: string }[];
  onCommit: (v: unknown) => Promise<unknown>; col: Col;
}) {
  switch (fieldType) {
    case "number": return <NumberCell value={value == null ? null : Number(value)} onCommit={onCommit} col={col} />;
    case "date": return <DateCell value={value ? String(value) : null} onCommit={onCommit} col={col} />;
    case "checkbox": {
      const { status, run } = useCellCommit(onCommit);
      return (
        <span className="flex items-center">
          <input type="checkbox" checked={value === true} onChange={(e) => void run(e.target.checked)} />
          <CellStatus status={status} />
        </span>
      );
    }
    case "select":
      return <SelectCell value={value == null ? null : String(value)} options={options.map((o) => ({ id: o, name: o }))} onCommit={onCommit} col={col} />;
    case "user":
      return <SelectCell value={value == null ? null : String(value)} options={members.map((u) => ({ id: u.userId, name: u.name }))} onCommit={onCommit} col={col} />;
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <TextCell value={list.join(", ")} col={col} onCommit={(v) =>
          onCommit(String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean))} />
      );
    }
    case "url":
      return <TextCell value={value == null ? "" : String(value)} onCommit={onCommit} col={col} />;
    default: // text / longtext
      return <TextCell value={value == null ? "" : String(value)} onCommit={onCommit} col={col} multiline={fieldType === "longtext"} />;
  }
}

interface TableProps { /* none — reads params */ }

export default function TablePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const searchParams = useSearchParams();
  const { data: lookups } = useProject(projectId);
  // Single source of truth (item 7).
  const { tasks, loading, error } = useTasks(projectId);
  const rows = tasks as Task[];
  const [drawerId, setDrawerId] = useState<string | null>(searchParams.get("task"));

  const [fSearch, setFSearch] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fAssignedBy, setFAssignedBy] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fEpic, setFEpic] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "serial", dir: 1 });
  const [groupBy, setGroupBy] = useState("");
  const [hidden, setHidden] = useState<Col[]>(DEFAULT_HIDDEN);
  const [widths, setWidths] = useState<Record<string, number>>({});
  /** Project whose saved layout is loaded; persistence waits for it so switching
   *  projects never writes one project's columns under another's key. */
  const [layoutFor, setLayoutFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [bulkPatch, setBulkPatch] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [views, setViews] = useState<{ id: string; name: string; config: Record<string, string> }[]>([]);
  const [viewName, setViewName] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingStatus, setPendingStatus] = useState<{ taskId: string; statusId: string; assigneeId: string | null } | null>(null);

  // Live counting for running timers (item 5).
  const anyRunning = rows.some((t) => t.timerState === "running" || t.timerState === "overdue");
  const now = useTicker(anyRunning);

  // Restore this project's saved table layout before paint…
  useBeforePaint(() => {
    const saved = readTableLayout(projectId);
    if (saved.hidden) setHidden(saved.hidden);
    if (saved.widths) setWidths(saved.widths);
    setLayoutFor(projectId);
  }, [projectId]);
  // …then remember every change (hide/show a column, resize) for next time.
  useEffect(() => {
    if (layoutFor !== projectId) return;
    writeTableLayout(projectId, hidden, widths);
  }, [layoutFor, projectId, hidden, widths]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        document.getElementById("table-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    api<{ views: { id: string; name: string; config: Record<string, string> }[] }>(`/api/projects/${projectId}/views?scope=table`)
      .then((d) => setViews(d.views)).catch(() => {});
  }, [projectId]);

  /** One commit path for every cell: optimistic via the shared store. */
  const commit = useCallback((t: Task, patch: Record<string, unknown>) => patchTask(projectId, t.id, patch), [projectId]);

  const sorted = useMemo(() => {
    const arr = rows.filter((t) => {
      if (fSearch && !(`${t.key} ${t.title}`.toLowerCase().includes(fSearch.toLowerCase()))) return false;
      if (fAssignee && (t.assigneeId ?? "") !== fAssignee) return false;
      // PHASE 4: "none" = tasks with no recorded assigner.
      if (fAssignedBy === "none" && t.assignedById) return false;
      if (fAssignedBy && fAssignedBy !== "none" && (t.assignedById ?? "") !== fAssignedBy) return false;
      if (fStatus && t.statusId !== fStatus) return false;
      if (fEpic && (t.epicId ?? "") !== fEpic) return false;
      return true;
    });
    const val = (t: Task, k: string): string | number => {
      switch (k) {
        case "serial": return t.serial;
        case "title": return t.title.toLowerCase();
        case "description": return (t.description ?? "").toLowerCase();
        case "estHours": return t.estHours ?? -1;
        case "estDays": return t.estDays ?? -1;
        case "rdTime": return t.rdTime ?? -1;
        case "status": return (lookups?.statuses ?? []).findIndex((s) => s.id === t.statusId);
        case "priority": return (lookups?.priorities ?? []).findIndex((p) => p.id === t.priorityId);
        case "assignee": return t.assignee?.name ?? "";
        case "assignedBy": return t.assignedBy?.name ?? "";
        case "testedBy": return t.testedBy?.name ?? "";
        case "type": return t.type?.name ?? "";
        case "epic": return t.epic?.name ?? "";
        case "notes": return buildTaskNotes(t.comments).map((n) => n.text).join(" ").toLowerCase();
        case "startDate": return t.startDate ?? "";
        case "endDate": return t.endDate ?? "";
        case "timerDue": return t.dueAt ?? "";
        case "timerStart": return t.startedAt ?? "";
        case "timerState": return t.timerState;
        case "timerActual": return t.timerWorkedMs ?? -1;
        case "createdAt": return t.createdAt;
        case "updatedAt": return t.updatedAt;
        default:
          if (k.startsWith("cf:")) return String(t.customValues?.[k.slice(3)] ?? "");
          return t.serial;
      }
    };
    arr.sort((a, b) => {
      const va = val(a, sort.key);
      const vb = val(b, sort.key);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    return arr;
  }, [rows, sort, fSearch, fAssignee, fAssignedBy, fStatus, fEpic, lookups]);

  const grouped = useMemo(() => {
    if (!groupBy) return [{ name: "", items: sorted }];
    const map = new Map<string, Task[]>();
    for (const t of sorted) {
      const name =
        groupBy === "epic" ? (t.epic?.name ?? "(no epic)") :
        groupBy === "assignee" ? (t.assignee?.name ?? "(unassigned)") :
        groupBy === "status" ? t.status.name : "";
      const arr = map.get(name) ?? [];
      arr.push(t);
      map.set(name, arr);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [sorted, groupBy]);

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  /** Column resize (drag the handle on a header edge). */
  const resizeRef = useRef<{ col: Col; startX: number; startW: number } | null>(null);

  // ---- Hooks end here: everything below may early-return. ----
  if (!lookups) return <p className="text-sm">Loading project…</p>;
  // Non-null alias usable inside the hoisted helpers below (function
  // declarations don't inherit TS narrowing from the guard above).
  const lk = lookups;

  const m = lk.membership;
  const can = (a: string) => m.perms[a] === true || m.isSuperAdmin;
  // Creation rule (change request): new tasks always start in To Do; the
  // quick-add rows show that status but cannot change it.
  const createStatusName =
    (lk.statuses.find((s) => s.category === "todo") ?? lk.statuses[0])?.name ?? "To Do";
  const rule = (f: string) => (m.isSuperAdmin ? "editable" : (m.fieldRules[f] ?? "readonly"));
  const isManager = m.isSuperAdmin || m.perms.manage_workflow === true || m.perms.manage_archive === true;
  const canDeleteTask = m.perms.delete_task === true || m.isSuperAdmin;
  const canManageRow = (t: Task) =>
    m.isSuperAdmin || m.perms.edit_task_all === true ||
    (m.perms.edit_task_own === true && (t.assigneeId == null || t.assigneeId === m.userId));

  /** The custom-field columns this project shows in the table. */
  const cfCols = lk.customFields.filter((f) => f.showIn.includes("table"));
  const ALL: Col[] = [...BASE_COLS, ...cfCols.map((f) => `cf:${f.id}` as Col)];

  function colField(c: Col): string {
    if (c.startsWith("cf:")) return "custom";
    // PHASE 4: the "assigned by" snapshot follows the assignee field's rule, so
    // a role that may not read the assignee never sees who assigned them.
    if (c === "assignedBy") return "assignee";
    return c === "key" || c === "notes" || c === "timerStart" || c === "timerActual" || c === "createdAt" || c === "updatedAt"
      ? "title" : c === "timerDue" ? "dueAt" : c === "timerState" ? "title" : c;
  }

  const visible = ALL.filter((c) => !hidden.includes(c) && (c.startsWith("cf:") || rule(colField(c)) !== "hidden"));

  function startResize(col: Col, e: React.MouseEvent) {
    const th = (e.currentTarget as HTMLElement).closest("th");
    resizeRef.current = { col, startX: e.clientX, startW: th?.getBoundingClientRect().width ?? 120 };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      setWidths((w) => ({ ...w, [r.col]: Math.max(48, r.startW + ev.clientX - r.startX) }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function quickAdd() {
    if (!quickTitle.trim()) return;
    try {
      // Creation rule (change request): no statusId — the server always
      // creates new tasks in the To Do status.
      await createTask(projectId, { title: quickTitle.trim() });
      setQuickTitle("");
      setShowQuickAdd(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Create failed.");
    }
  }

  async function applyBulk() {
    if (selected.size === 0 || !bulkPatch || !bulkValue) return;
    const patch: Record<string, unknown> =
      bulkPatch === "statusId" ? { statusId: bulkValue } :
      bulkPatch === "priorityId" ? { priorityId: bulkValue } :
      bulkPatch === "assigneeId" ? { assigneeId: bulkValue === "none" ? null : bulkValue } : {};
    try {
      const d = await api<{ results: { id: string; ok: boolean; error?: string }[] }>(
        `/api/projects/${projectId}/tasks/bulk`,
        { method: "POST", body: JSON.stringify({ ids: [...selected], patch }) }
      );
      const failed = d.results.filter((r) => !r.ok);
      setMsg(failed.length === 0 ? `Updated ${d.results.length} task(s).` : `${failed.length} failed: ${failed[0].error}`);
      setSelected(new Set());
      refreshTasks(projectId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Bulk update failed.");
    }
  }

  async function doImport(file: File) {
    const form = new FormData();
    form.append("file", file);
    setMsg("Importing…");
    try {
      const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.error?.message ?? "Import failed.");
        return;
      }
      setMsg(`Imported ${j.data.created} task(s), ${j.data.links} link(s), ${j.data.errorCount} error(s).` +
        (j.data.errors?.length ? ` First: row ${j.data.errors[0].row}: ${j.data.errors[0].error}` : ""));
      refreshTasks(projectId);
    } catch {
      setMsg("Import failed (network).");
    }
  }

  function statusCell(t: Task) {
    if (!can("change_status")) return <span>{t.status.name}</span>;
    return (
      <SelectCell
        col="status"
        value={t.statusId}
        options={lk.statuses}
        onCommit={async (v) => {
          if (!v || v === t.statusId) return;
          const target = lk.statuses.find((s) => s.id === v);
          if (target?.category === "done") {
            // Same rule as the board: moving INTO a final status never opens
            // the Assign step; the server auto-stops the running stage.
            await commit(t, { statusId: v });
          } else {
            setPendingStatus({ taskId: t.id, statusId: v as string, assigneeId: t.assigneeId ?? null });
          }
        }}
      />
    );
  }

  /** Memoized row: only the edited row re-renders (item 7 perf). */
  const TableRow = memo(function TableRow({ t }: { t: Task }) {
    const isSelected = selected.has(t.id);
    return (
      <tr
        className={`tt-row border-b border-line ${isSelected ? "row-selected" : ""} ${t.status.category === "done" ? "task-row-done" : ""}`}
        aria-selected={isSelected}
        style={{ background: isSelected ? "var(--row-selected-bg)" : `${t.status.color}14` }}>
        <td className="w-8 px-2 py-1"><input type="checkbox" checked={isSelected}
          aria-label={`Select ${t.key}`}
          onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })}
          onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setSelected((s) => { const n = new Set(s); if (s.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }); } }}
        /></td>
        {visible.map((c) => (
          <td key={c} data-col={c} data-num={RIGHT_COLS.has(c) ? "1" : undefined} className="whitespace-nowrap px-2 py-1 align-middle"
            style={widths[c] ? { width: widths[c], minWidth: widths[c] } : undefined}>
            {cell(t, c)}
          </td>
        ))}
        <td className="whitespace-nowrap px-2 py-1 text-right">
          <TaskMenu
            projectId={projectId}
            taskId={t.id}
            taskKey={t.key}
            title={t.title}
            canRename={canManageRow(t)}
            canDelete={canDeleteTask}
            variant="buttons"
            onChanged={() => refreshTasks(projectId)}
            onDeleted={() => { setMsg(`Deleted ${t.key} — it is gone from the board, calendar and reports.`); refreshTasks(projectId); }}
          />
        </td>
      </tr>
    );
  });

  function cell(t: Task, c: Col) {
    // Read-only computed/system columns are visibly marked with a lock.
    if (RO_COLS.has(c)) {
      switch (c) {
        case "key":
          return (
            <span className="font-mono" title={`${t.key} — read-only`} onClick={() => setDrawerId(t.id)} style={{ cursor: "pointer" }}>
              {t.key}
            </span>
          );
        case "estDays": return <span className="text-slate-500" title="Computed from est. hours — read-only">{t.estDays ?? "—"}<LockMark /></span>;
        case "timerStart": return <span className="text-slate-500" title="First Start click — read-only">{fmtDateTime(t.startedAt)}<LockMark /></span>;
        case "timerActual":
          return <span className="text-slate-500" title="Total tracked time — read-only">{t.timerState === "not_started" ? "—" : fmtDur(t.timerWorkedMs)}<LockMark /></span>;
        case "createdAt": return <span className="text-slate-500" title="Created — read-only">{new Date(t.createdAt).toLocaleDateString()}<LockMark /></span>;
        case "updatedAt": return <span className="text-slate-500" title="Last updated — read-only">{new Date(t.updatedAt).toLocaleDateString()}<LockMark /></span>;
        case "assignedBy":
          // PHASE 4: server-owned snapshot ("assigned by whom", newest change).
          // Soft-deleted assigners stay visible and are marked "(removed)";
          // a task whose assignment predates the feature shows "—".
          return (
            <span className="text-slate-500" title={t.assignedAt
              ? `Assigned ${new Date(t.assignedAt).toLocaleString()} — read-only`
              : "No recorded assignment — read-only"}>
              {t.assignedBy ? `${t.assignedBy.name}${t.assignedBy.deletedAt ? " (removed)" : ""}` : "—"}
              {t.assignedAt ? <span className="ml-1 text-slate-400">{new Date(t.assignedAt).toLocaleDateString()}</span> : null}
              <LockMark />
            </span>
          );
      }
    }
    switch (c) {
      case "title":
        return canManageRow(t) && rule("title") === "editable"
          ? <TextCell value={t.title} col={c} onCommit={(v) => commit(t, { title: v })} />
          : <span>{t.title}</span>;
      case "description":
        return rule("description") === "editable"
          ? <TextCell value={t.description ?? ""} col={c} multiline onCommit={(v) => commit(t, { description: v || null })} />
          : <span className="max-w-40 truncate" title={t.description ?? ""}>{t.description ?? "—"}</span>;
      case "status": return statusCell(t);
      case "priority":
        return can("change_priority") || can("edit_task_own")
          ? <SelectCell col={c} value={t.priorityId} options={lk.priorities} onCommit={(v) => (v ? commit(t, { priorityId: v }) : Promise.resolve())} />
          : <span style={{ color: t.priority.color }}>● {t.priority.name}</span>;
      case "assignee":
        return can("assign") || can("edit_task_own")
          ? <SelectCell col={c} value={t.assigneeId} options={lk.members.map((x) => ({ id: x.userId, name: userOptionLabel(x) }))}
              onCommit={(v) => commit(t, { assigneeId: v })}
              renderOption={(o) => o.name} />
          : (
            <span className="flex items-center gap-1.5">
              {t.assignee && <Avatar name={t.assignee.name} url={t.assignee.avatarUrl} size={18} />}
              {t.assignee?.name ?? "—"}
            </span>
          );
      case "testedBy":
        return rule("testedBy") === "editable"
          ? <SelectCell col={c} value={t.testedById} options={lk.members.map((x) => ({ id: x.userId, name: userOptionLabel(x) }))}
              onCommit={(v) => commit(t, { testedById: v })} />
          : (t.testedBy?.name ?? "—");
      case "type":
        return rule("type") === "editable" || can("edit_task_all") || m.isSuperAdmin
          ? <SelectCell col={c} value={t.typeId} options={lk.issueTypes} onCommit={(v) => commit(t, { typeId: v })} />
          : (t.type?.name ?? "—");
      case "epic":
        return rule("epic") === "editable"
          ? <SelectCell col={c} value={t.epicId} options={lk.epics} onCommit={(v) => commit(t, { epicId: v })} />
          : (t.epic?.name ?? "—");
      case "description":
        return rule("description") === "editable"
          ? <LongTextCell value={t.description ?? ""} editable={rule("description") === "editable"} onCommit={(v) => commit(t, { description: v })} />
          : (<span className="block max-w-56 truncate" title={t.description ?? "—"}>{t.description || "—"}</span>);
      case "notes":
        return <NotesCell t={t} />;
      case "estHours":
        return rule("estHours") === "editable"
          ? <NumberCell value={t.estHours} col={c} onCommit={(v) => commit(t, { estHours: v })} />
          : (t.estHours ?? "—");
      case "rdTime":
        return rule("rdTime") === "editable"
          ? <NumberCell value={t.rdTime} col={c} onCommit={(v) => commit(t, { rdTime: v ?? 0 })} />
          : (t.rdTime ?? "—");
      case "startDate": case "endDate":
        return rule(c) === "editable"
          ? <DateCell value={t[c]} col={c} onCommit={(v) => commit(t, { [c]: v })} />
          : fmtDate(t[c]);
      case "timerDue":
        return isManager
          ? <DateCell value={t.dueAt} col={c} datetime onCommit={(v) => commit(t, { dueAt: v })} />
          : fmtDateTime(t.dueAt);
      case "timerState": {
        // Start/Stop per tracked stage (item 5) — the server owns the logic.
        const oper = isManager || (t.assigneeId != null && t.assigneeId === m.userId);
        const isTrack = t.status.timerRole === "TRACK";
        const showStart = oper && isTrack && (t.timerState === "not_started" || t.timerState === "paused");
        const showStop = oper && isTrack && (t.timerState === "running" || t.timerState === "overdue");
        return (
          <span className="inline-flex items-center gap-1">
            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${timerChipClass(t.timerState)}`}>{timerSummary(t, now)}</span>
            {showStart && (
              <button onClick={() => void timerAction(projectId, t.id, "start").catch((e) => setMsg(e instanceof Error ? e.message : "Timer failed."))}
                title="Start the timer for this stage"
                className="inline-flex items-center gap-0.5 rounded border border-blue-300 px-1 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950">
                <IconPlay className="h-2.5 w-2.5" /> Start
              </button>
            )}
            {showStop && (
              <button onClick={() => void timerAction(projectId, t.id, "stop").catch((e) => setMsg(e instanceof Error ? e.message : "Timer failed."))}
                title="Stop the timer (work on this stage is done)"
                className="inline-flex items-center gap-0.5 rounded border border-red-300 px-1 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">
                <IconPause className="h-2.5 w-2.5" /> Stop
              </button>
            )}
          </span>
        );
      }
      default:
        if (c.startsWith("cf:")) {
          const f = lk.customFields.find((x) => x.id === c.slice(3));
          if (!f) return null;
          const vis = f.roleVisibility?.[m.roleIds[0] ?? ""] ?? "editable";
          const cfVal = t.customValues?.[f.id];
          if (vis === "hidden") return null;
          if (vis === "readonly") return <span className="text-slate-500" title="Read-only">{String(cfVal ?? "—")}<LockMark /></span>;
          const cfSet = (v: unknown) =>
            commit(t, { customValues: { ...(t.customValues ?? {}), [f.id]: v } });
          return (
            <CustomFieldCell fieldType={f.fieldType} options={f.options} value={cfVal}
              members={lk.members.map((x) => ({ userId: x.userId, name: userOptionLabel(x) }))} col={c}
              onCommit={cfSet} />
          );
        }
        return null;
    }
  }

  const headers: Record<BaseCol, string> = {
    key: "SL / Key", title: "Task title", status: "Status",
    assignedBy: "Assigned by", assignee: "Assignee", testedBy: "Tested By",
    priority: "Priority",
    type: "Issue type", startDate: "Start", endDate: "End",
    estHours: "Est. Hrs", estDays: "Est. Days", rdTime: "R&D Hrs",
    epic: "Epic", description: "Description", notes: "Comments & notes",
    timerStart: "Start time", timerDue: "Due time", timerState: "Timer", timerActual: "Total time",
    createdAt: "Created", updatedAt: "Updated",
  };
  const headerOf = (c: Col) => c.startsWith("cf:")
    ? (lookups.customFields.find((f) => f.id === c.slice(3))?.name ?? "Custom")
    : headers[c as BaseCol];

  // Change request (table export): the Excel download mirrors the current view,
  // so the four active filters travel with it. No filters = the full project
  // sheet, which is the file the import expects back.
  const exportQuery = (() => {
    const q = new URLSearchParams();
    if (fSearch.trim()) q.set("q", fSearch.trim());
    if (fAssignee) q.set("assignee", fAssignee);
    if (fAssignedBy) q.set("assignedBy", fAssignedBy);
    if (fStatus) q.set("status", fStatus);
    if (fEpic) q.set("epic", fEpic);
    const s = q.toString();
    return s ? `&${s}` : "";
  })();

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <input id="table-search" value={fSearch} onChange={(e) => setFSearch(e.target.value)} placeholder="Search tasks… ( / to focus )"
          className={`${fieldCls} w-56`} />
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={`${fieldCls} max-w-56`}>
          <option value="">All assignees</option>
          {lookups.members.map((x) => <option key={x.userId} value={x.userId}>{userOptionLabel(x)}</option>)}
        </select>
        <select value={fAssignedBy} onChange={(e) => setFAssignedBy(e.target.value)} className={`${fieldCls} max-w-56`}
          title="Show only tasks assigned by a given person">
          <option value="">All assigned by</option>
          <option value="none">— (no recorded assigner)</option>
          {lookups.members.map((x) => <option key={x.userId} value={x.userId}>{userOptionLabel(x)}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={fieldCls}>
          <option value="">All statuses</option>
          {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={fEpic} onChange={(e) => setFEpic(e.target.value)} className={fieldCls}>
          <option value="">All epics</option>
          {lookups.epics.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={fieldCls}>
          <option value="">No grouping</option>
          <option value="epic">Group: Epic</option>
          <option value="assignee">Group: Assignee</option>
          <option value="status">Group: Status</option>
        </select>
        <select
          value="" onChange={(e) => { if (e.target.value) setHidden((h) => h.includes(e.target.value as Col) ? h : [...h, e.target.value as Col]); }}
          className={fieldCls}>
          <option value="">Hide column…</option>
          {visible.map((c) => <option key={c} value={c}>{headerOf(c)}</option>)}
        </select>
        <select
          value="" onChange={(e) => { if (e.target.value) setHidden((h) => h.filter((c) => c !== e.target.value as Col)); }}
          className={fieldCls}>
          <option value="">Show column…</option>
          {hidden.map((c) => <option key={c} value={c}>{headerOf(c)}</option>)}
        </select>
        {hidden.length > 0 && <button onClick={() => setHidden([])} className="tt-btn">Show all</button>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {can("create_task") && (
          showQuickAdd ? (
            <span className="flex items-center gap-1.5">
              <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && quickAdd()}
                placeholder="New task title…" autoFocus
                className={`${fieldCls} w-64`} />
              <span className="flex h-8 items-center gap-1 rounded-md border border-transparent px-2 text-muted" title="New tasks always start in the To Do status">
                → {createStatusName}
              </span>
              <button onClick={quickAdd} className="tt-btn-primary tt-btn-sm">Add</button>
              <button onClick={() => setShowQuickAdd(false)} className="tt-btn">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setShowQuickAdd(true)} className="tt-btn-primary tt-btn-sm">
              <IconPlus className="h-3.5 w-3.5" /> Quick add
            </button>
          )
        )}
        {can("export") && (
          <a
            href={`/api/projects/${projectId}/export?format=xlsx${exportQuery}`}
            className="tt-btn"
            title="Download these tasks as a real Excel workbook (.xlsx)"
          >
            <IconDownload className="h-3.5 w-3.5" /> Download Excel
          </a>
        )}
        {can("import") && (
          <label className="tt-btn cursor-pointer">
            <IconUpload className="h-3.5 w-3.5" /> Import
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
          </label>
        )}
        <span className="ml-auto text-muted">
          {loading ? "Loading…" : `${rows.length} task(s)`}{msg && ` · ${msg}`}{error && ` · ${error}`}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md bg-indigo-50 p-1.5 text-xs dark:bg-indigo-950">
          <span className="font-medium">{selected.size} selected</span>
          <select value={bulkPatch} onChange={(e) => setBulkPatch(e.target.value)} className={fieldCls}>
            <option value="">Set field…</option>
            <option value="statusId">Status</option>
            <option value="priorityId">Priority</option>
            <option value="assigneeId">Assignee</option>
          </select>
          {bulkPatch === "statusId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className={fieldCls}>
              <option value="">…</option>
              {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {bulkPatch === "priorityId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className={fieldCls}>
              <option value="">…</option>
              {lookups.priorities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {bulkPatch === "assigneeId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className={fieldCls}>
              <option value="">…</option>
              <option value="none">(unassigned)</option>
              {lookups.members.map((x) => <option key={x.userId} value={x.userId}>{userOptionLabel(x)}</option>)}
            </select>
          )}
          <button onClick={applyBulk} className="tt-btn-primary tt-btn-sm">Apply</button>
          <button onClick={() => setSelected(new Set())} className="tt-btn">Clear</button>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Save current filters as…"
          className={`${fieldCls} w-56`} />
        <button
          onClick={async () => {
            if (!viewName.trim()) return;
            await api(`/api/projects/${projectId}/views`, {
              method: "POST",
              body: JSON.stringify({ name: viewName, scope: "table", config: { fSearch, fAssignee, fAssignedBy, fStatus, fEpic } }),
            });
            setViewName("");
            api<{ views: { id: string; name: string; config: Record<string, string> }[] }>(`/api/projects/${projectId}/views?scope=table`).then((d) => setViews(d.views));
          }}
          className="tt-btn">Save view</button>
        {views.map((v) => (
          <button key={v.id}
            onClick={() => {
              setFSearch(v.config.fSearch ?? "");
              setFAssignee(v.config.fAssignee ?? ""); setFAssignedBy(v.config.fAssignedBy ?? "");
              setFStatus(v.config.fStatus ?? ""); setFEpic(v.config.fEpic ?? "");
            }}
            className="tt-btn" title={`Apply saved view “${v.name}”`}>{v.name}</button>
        ))}
      </div>

      <div className="tt-card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="tt-table text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-8 border-b border-line bg-surface px-2 py-1.5">
                  <input type="checkbox"
                    ref={(el) => { if (el) el.indeterminate = sorted.length > 0 && sorted.some((t) => selected.has(t.id)) && !sorted.every((t) => selected.has(t.id)); }}
                    checked={sorted.length > 0 && sorted.every((t) => selected.has(t.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((t) => t.id)) : new Set())} />
                </th>
                {visible.map((c) => (
                  <th key={c}
                    onClick={() => toggleSort(c)}
                    data-num={RIGHT_COLS.has(c) ? "1" : undefined}
                    className="group sticky top-0 z-10 cursor-pointer whitespace-nowrap border-b border-line bg-surface px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-line/40"
                    style={widths[c] ? { width: widths[c], minWidth: widths[c] } : undefined}>
                    {headerOf(c)}{sort.key === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                    {RO_COLS.has(c) && <span className="ml-1 inline-flex align-middle text-slate-400" title="Read-only column"><IconLock className="h-3 w-3" /></span>}
                    <span
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startResize(c, e); }}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to resize"
                      className="ml-1 inline-block h-3 w-1 cursor-col-resize align-middle text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
                    >|</span>
                  </th>
                ))}
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g, gi) => (
                <Fragment key={g.name || `all-${gi}`}>
                  {g.name && (
                    <tr key={"g" + g.name}>
                      <td colSpan={visible.length + 2} className="border-b border-line bg-line/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {g.name}
                        <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium tabular-nums">{g.items.length}</span>
                      </td>
                    </tr>
                  )}
                  {g.items.map((t) => <TableRow key={t.id} t={t} />)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Click a key to open details. Row colour = status, ● = priority, <IconLock className="inline h-3 w-3 align-text-bottom" /> = read-only.
        Edits save on blur/Enter, cancel on Esc, and sync to the board, timeline and drawer instantly.
      </p>

      <TaskDrawer projectId={projectId} taskId={drawerId} lookups={lookups}
        onClose={() => setDrawerId(null)} onChanged={() => refreshTasks(projectId)} />

      {pendingStatus && (
        <AssignStepDialog
          lookups={lookups}
          statusId={pendingStatus.statusId}
          currentAssigneeId={pendingStatus.assigneeId}
          onCancel={() => setPendingStatus(null)}
          onConfirm={(assigneeId) => {
            const p = pendingStatus;
            setPendingStatus(null);
            void patchTask(projectId, p.taskId, assigneeId ? { statusId: p.statusId, assigneeId } : { statusId: p.statusId })
              .catch((e) => setMsg(e instanceof Error ? e.message : "Move not allowed."));
          }}
        />
      )}
    </div>
  );
}
