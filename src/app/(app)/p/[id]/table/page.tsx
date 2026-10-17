"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, fmtDate } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import { useTicker } from "@/hooks/useTicker";
import { useTasks, patchTask, createTask, timerAction, refreshTasks, type TaskRow } from "@/lib/taskStore";
import { fmtDateTime, fmtDur, timerChipClass, timerSummary } from "@/lib/timerFormat";
import { memberLabel } from "@/lib/memberLabel";
import Avatar from "@/components/Avatar";
import TaskDrawer from "@/components/TaskDrawer";
import TaskMenu from "@/components/TaskMenu";
import AssignStepDialog from "@/components/AssignStepDialog";

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
 * logged hours, total time, start time, created/updated) are read-only and
 * visually marked with 🔒. Status changes reuse the board's rules including
 * the Assign step and the stage-timer bookkeeping (server-side).
 */

type Task = TaskRow & {
  serial: number; key: string; title: string; description: string | null;
  estHours: number | null; estDays: number | null; rdTime: number; loggedHours: number;
  statusId: string; status: { name: string; color: string; category: string; timerRole: string };
  priorityId: string; priority: { name: string; color: string };
  assigneeId: string | null; assignee: { id: string; name: string; avatarUrl: string | null } | null;
  testedById: string | null; testedBy: { id: string; name: string } | null;
  epicId: string | null; epic: { id: string; name: string } | null;
  storyId: string | null; story: { id: string; title: string } | null;
  typeId: string | null; type: { id: string; name: string } | null;
  labels: string[]; customValues: Record<string, unknown>;
  startDate: string | null; endDate: string | null; dueAt: string | null;
  startedAt: string | null; stoppedAt: string | null; stageEnteredAt: string | null; totalSeconds: number | null;
  timerState: string; timerWorkedMs: number | null; timerRemainingMs: number | null; timerOverdueMs: number | null;
  createdAt: string; updatedAt: string;
};

const BASE_COLS = [
  "key", "title", "status", "assignee", "priority", "type", "testedBy",
  "dueAt", "startDate", "endDate", "estHours", "estDays", "rdTime", "labels",
  "epic", "story", "description",
  "timerStart", "timerDue", "timerState", "timerActual",
  "loggedHours", "createdAt", "updatedAt",
] as const;
type BaseCol = (typeof BASE_COLS)[number];
type Col = BaseCol | `cf:${string}`;
/** Hidden by default (still available via "Hide column…"/show list). */
const DEFAULT_HIDDEN: Col[] = ["description", "rdTime", "createdAt", "updatedAt"];

const RO_COLS = new Set<Col>(["key", "estDays", "loggedHours", "timerStart", "timerActual", "createdAt", "updatedAt"]);

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
  if (status === "saved") return <span className="ml-1 text-[10px] text-green-600 dark:text-green-400" title="Saved">✓</span>;
  return <span className="ml-1 text-[10px] text-red-600 dark:text-red-400" title="Save failed — the cell was reverted">⚠</span>;
}

const cellInput =
  "w-full min-w-20 rounded border border-transparent bg-transparent p-0.5 hover:border-slate-300 focus:border-slate-400 dark:hover:border-slate-600 dark:focus:border-slate-500";

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
  options: { id: string; name: string; hint?: string }[];
  onCommit: (v: unknown) => Promise<unknown>;
  col: Col;
  renderOption?: (o: { id: string; name: string }) => string;
}) {
  const { status, run } = useCellCommit(onCommit);
  return (
    <span className="flex items-center">
      <select value={value ?? ""} title={options.find((o) => o.id === value)?.hint}
        onChange={(e) => { if ((value ?? "") !== e.target.value) void run(e.target.value || null); }}
        onKeyDown={(e) => moveCellFocus(e, col)}
        className={`${cellInput} max-w-44`}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.id}>{renderOption ? renderOption(o) : o.name}</option>)}
      </select>
      <CellStatus status={status} />
    </span>
  );
}

/** Labels: multi-select popover over every label used in the project. */
function LabelsCell({ value, allLabels, onCommit, col }: { value: string[]; allLabels: string[]; onCommit: (v: unknown) => Promise<unknown>; col: Col }) {
  const { status, run } = useCellCommit(onCommit);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>(value);
  useEffect(() => { setPicked(value); }, [value]);
  const toggle = (l: string) =>
    setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const commit = () => {
    setOpen(false);
    const next = [...new Set(picked)].sort();
    if (JSON.stringify(next) !== JSON.stringify([...value].sort())) void run(next);
  };
  return (
    <span className="relative flex items-center">
      <button onClick={() => setOpen((v) => !v)} onKeyDown={(e) => moveCellFocus(e, col)}
        className={`${cellInput} cursor-pointer text-left`} title="Edit labels">
        {value.length ? value.join(", ") : <span className="text-slate-400">—</span>}
      </button>
      <CellStatus status={status} />
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-56 rounded border border-line bg-surface p-2 shadow-lg">
          {allLabels.map((l) => (
            <label key={l} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={picked.includes(l)} onChange={() => toggle(l)} />{l}
            </label>
          ))}
          <span className="mt-1 flex gap-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="new label"
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) { toggle(draft.trim()); setDraft(""); }
                if (e.key === "Escape") setOpen(false);
              }}
              className="w-full rounded border p-0.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
          </span>
          <span className="mt-1 flex justify-end gap-1">
            <button onClick={() => setOpen(false)} className="rounded border px-1 text-[10px]">Cancel</button>
            <button onClick={commit} className="rounded bg-indigo-600 px-1 text-[10px] text-white">Save</button>
          </span>
        </span>
      )}
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
  const [stories, setStories] = useState<{ id: string; title: string }[]>([]);

  const [fSearch, setFSearch] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fEpic, setFEpic] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "serial", dir: 1 });
  const [groupBy, setGroupBy] = useState("");
  const [hidden, setHidden] = useState<Col[]>(DEFAULT_HIDDEN);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickStatus, setQuickStatus] = useState("");
  const [bulkPatch, setBulkPatch] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [views, setViews] = useState<{ id: string; name: string; config: Record<string, string> }[]>([]);
  const [viewName, setViewName] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingStatus, setPendingStatus] = useState<{ taskId: string; statusId: string; assigneeId: string | null } | null>(null);

  // Live counting for running timers (item 5).
  const anyRunning = rows.some((t) => t.timerState === "running" || t.timerState === "overdue");
  const now = useTicker(anyRunning);

  useEffect(() => {
    api<{ stories: { id: string; title: string }[] }>(`/api/projects/${projectId}/stories`)
      .then((d) => setStories(d.stories)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
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
        case "loggedHours": return t.loggedHours ?? -1;
        case "status": return (lookups?.statuses ?? []).findIndex((s) => s.id === t.statusId);
        case "priority": return (lookups?.priorities ?? []).findIndex((p) => p.id === t.priorityId);
        case "assignee": return t.assignee?.name ?? "";
        case "testedBy": return t.testedBy?.name ?? "";
        case "type": return t.type?.name ?? "";
        case "epic": return t.epic?.name ?? "";
        case "story": return t.story?.title ?? "";
        case "labels": return (t.labels ?? []).join(",");
        case "startDate": return t.startDate ?? "";
        case "endDate": return t.endDate ?? "";
        case "dueAt": case "timerDue": return t.dueAt ?? "";
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
  }, [rows, sort, fSearch, fAssignee, fStatus, fEpic, lookups]);

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

  const allLabels = useMemo(
    () => [...new Set(rows.flatMap((t) => (Array.isArray(t.labels) ? t.labels : [])))].sort(),
    [rows],
  );

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
    return c === "key" || c === "timerStart" || c === "timerActual" || c === "loggedHours" || c === "createdAt" || c === "updatedAt"
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
      await createTask(projectId, {
        title: quickTitle.trim(),
        ...(quickStatus ? { statusId: quickStatus } : {}),
      });
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
    return (
      <tr className={t.status.category === "done" ? "task-row-done border-t dark:border-slate-800" : "border-t dark:border-slate-800"}
        style={{ background: `${t.status.color}14` }}>
        <td className="p-1"><input type="checkbox" checked={selected.has(t.id)}
          onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} /></td>
        {visible.map((c) => (
          <td key={c} data-col={c} className="whitespace-nowrap p-1 align-top"
            style={widths[c] ? { width: widths[c], minWidth: widths[c] } : undefined}>
            {cell(t, c)}
          </td>
        ))}
        <td className="whitespace-nowrap p-1">
          <TaskMenu
            projectId={projectId}
            taskId={t.id}
            taskKey={t.key}
            title={t.title}
            canRename={canManageRow(t)}
            canDelete={canDeleteTask}
            onChanged={() => refreshTasks(projectId)}
            onDeleted={() => refreshTasks(projectId)}
          />
        </td>
      </tr>
    );
  });

  function cell(t: Task, c: Col) {
    // Read-only computed/system columns are visibly marked (🔒).
    if (RO_COLS.has(c)) {
      switch (c) {
        case "key":
          return (
            <span className="font-mono" title={`${t.key} — read-only`} onClick={() => setDrawerId(t.id)} style={{ cursor: "pointer" }}>
              {t.key}
            </span>
          );
        case "estDays": return <span className="text-slate-500" title="Computed from est. hours — read-only">{t.estDays ?? "—"} 🔒</span>;
        case "loggedHours": return <span className="text-slate-500" title="Logged hours — read-only">{t.loggedHours ? `${t.loggedHours}h` : "—"} 🔒</span>;
        case "timerStart": return <span className="text-slate-500" title={`First Start click — read-only`}>{fmtDateTime(t.startedAt)} 🔒</span>;
        case "timerActual":
          return <span className="text-slate-500" title="Total tracked time — read-only">{t.timerState === "not_started" ? "—" : fmtDur(t.timerWorkedMs)} 🔒</span>;
        case "createdAt": return <span className="text-slate-500" title="Created — read-only">{new Date(t.createdAt).toLocaleDateString()} 🔒</span>;
        case "updatedAt": return <span className="text-slate-500" title="Last updated — read-only">{new Date(t.updatedAt).toLocaleDateString()} 🔒</span>;
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
          ? <SelectCell col={c} value={t.assigneeId} options={lk.members.map((x) => ({ id: x.userId, name: memberLabel(x) }))}
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
          ? <SelectCell col={c} value={t.testedById} options={lk.members.map((x) => ({ id: x.userId, name: memberLabel(x) }))}
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
      case "story":
        return rule("story") === "editable" || canManageRow(t)
          ? <SelectCell col={c} value={t.storyId} options={stories.map((s) => ({ id: s.id, name: s.title }))}
              onCommit={(v) => commit(t, { storyId: v })} />
          : (t.story?.title ?? "—");
      case "labels":
        return canManageRow(t) || can("edit_task_all")
          ? <LabelsCell value={Array.isArray(t.labels) ? t.labels : []} allLabels={allLabels} col={c}
              onCommit={(v) => commit(t, { labels: v })} />
          : (Array.isArray(t.labels) ? t.labels.join(", ") : "—");
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
                className="rounded border border-blue-300 px-1 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950">
                ▶ Start
              </button>
            )}
            {showStop && (
              <button onClick={() => void timerAction(projectId, t.id, "stop").catch((e) => setMsg(e instanceof Error ? e.message : "Timer failed."))}
                title="Stop the timer (work on this stage is done)"
                className="rounded border border-red-300 px-1 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">
                ⏸ Stop
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
          if (vis === "readonly") return <span className="text-slate-500" title="Read-only">{String(cfVal ?? "—")} 🔒</span>;
          const cfSet = (v: unknown) =>
            commit(t, { customValues: { ...(t.customValues ?? {}), [f.id]: v } });
          return (
            <CustomFieldCell fieldType={f.fieldType} options={f.options} value={cfVal}
              members={lk.members.map((x) => ({ userId: x.userId, name: x.name }))} col={c}
              onCommit={cfSet} />
          );
        }
        return null;
    }
  }

  const headers: Record<BaseCol, string> = {
    key: "SL / Key", title: "Task title", status: "Status", assignee: "Assignee", priority: "Priority",
    type: "Issue type", testedBy: "Tested By", dueAt: "Due", startDate: "Start", endDate: "End",
    estHours: "Est. Hrs", estDays: "Est. Days", rdTime: "R&D Hrs", labels: "Labels",
    epic: "Epic", story: "Parent story", description: "Description",
    timerStart: "Start time", timerDue: "Due time", timerState: "Timer", timerActual: "Total time",
    loggedHours: "Logged", createdAt: "Created", updatedAt: "Updated",
  };
  const headerOf = (c: Col) => c.startsWith("cf:")
    ? (lookups.customFields.find((f) => f.id === c.slice(3))?.name ?? "Custom")
    : headers[c as BaseCol];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        <input id="table-search" value={fSearch} onChange={(e) => setFSearch(e.target.value)} placeholder="Search tasks… ( / to focus )"
          className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className="max-w-56 rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">All assignees</option>
          {lookups.members.map((x) => <option key={x.userId} value={x.userId}>{memberLabel(x)}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">All statuses</option>
          {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={fEpic} onChange={(e) => setFEpic(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">All epics</option>
          {lookups.epics.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">No grouping</option>
          <option value="epic">Group: Epic</option>
          <option value="assignee">Group: Assignee</option>
          <option value="status">Group: Status</option>
        </select>
        <select
          value="" onChange={(e) => { if (e.target.value) setHidden((h) => h.includes(e.target.value as Col) ? h : [...h, e.target.value as Col]); }}
          className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">Hide column…</option>
          {visible.map((c) => <option key={c} value={c}>{headerOf(c)}</option>)}
        </select>
        <select
          value="" onChange={(e) => { if (e.target.value) setHidden((h) => h.filter((c) => c !== e.target.value as Col)); }}
          className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">Show column…</option>
          {hidden.map((c) => <option key={c} value={c}>{headerOf(c)}</option>)}
        </select>
        {hidden.length > 0 && <button onClick={() => setHidden([])} className="rounded border px-1">Show all</button>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {can("create_task") && (
          showQuickAdd ? (
            <span className="flex gap-1">
              <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && quickAdd()}
                placeholder="New task title…" autoFocus
                className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
              <select value={quickStatus} onChange={(e) => setQuickStatus(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
                <option value="">(default status)</option>
                {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={quickAdd} className="rounded bg-indigo-600 px-2 font-semibold text-white">Add</button>
              <button onClick={() => setShowQuickAdd(false)} className="rounded border px-2">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setShowQuickAdd(true)} className="rounded bg-indigo-600 px-2 py-1 font-semibold text-white">+ Quick add</button>
          )
        )}
        {can("export") && (
          <>
            <a href={`/api/projects/${projectId}/export?format=csv`} className="rounded border px-2 py-1">⬇ CSV</a>
            <a href={`/api/projects/${projectId}/export?format=xlsx`} className="rounded border px-2 py-1">⬇ XLSX</a>
          </>
        )}
        {can("import") && (
          <label className="cursor-pointer rounded border px-2 py-1">⬆ Import
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
          </label>
        )}
        <span className="ml-auto text-slate-500">
          {loading ? "Loading…" : `${rows.length} task(s)`}{msg && ` · ${msg}`}{error && ` · ${error}`}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-1 rounded bg-indigo-50 p-1 text-xs dark:bg-indigo-950">
          {selected.size} selected
          <select value={bulkPatch} onChange={(e) => setBulkPatch(e.target.value)} className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
            <option value="">Set field…</option>
            <option value="statusId">Status</option>
            <option value="priorityId">Priority</option>
            <option value="assigneeId">Assignee</option>
          </select>
          {bulkPatch === "statusId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="rounded border p-1 dark:bg-slate-800">
              <option value="">…</option>
              {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {bulkPatch === "priorityId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="rounded border p-1 dark:bg-slate-800">
              <option value="">…</option>
              {lookups.priorities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {bulkPatch === "assigneeId" && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="rounded border p-1 dark:bg-slate-800">
              <option value="">…</option>
              <option value="none">(unassigned)</option>
              {lookups.members.map((x) => <option key={x.userId} value={x.userId}>{memberLabel(x)}</option>)}
            </select>
          )}
          <button onClick={applyBulk} className="rounded bg-indigo-600 px-2 py-0.5 font-semibold text-white">Apply</button>
          <button onClick={() => setSelected(new Set())} className="rounded border px-2 py-0.5">Clear</button>
        </div>
      )}

      <div className="mb-2 flex items-center gap-1 text-xs">
        <input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Save current filters as…"
          className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800" />
        <button
          onClick={async () => {
            if (!viewName.trim()) return;
            await api(`/api/projects/${projectId}/views`, {
              method: "POST",
              body: JSON.stringify({ name: viewName, scope: "table", config: { fSearch, fAssignee, fStatus, fEpic } }),
            });
            setViewName("");
            api<{ views: { id: string; name: string; config: Record<string, string> }[] }>(`/api/projects/${projectId}/views?scope=table`).then((d) => setViews(d.views));
          }}
          className="rounded border px-2 py-0.5">Save view</button>
        {views.map((v) => (
          <button key={v.id}
            onClick={() => {
              setFSearch(v.config.fSearch ?? "");
              setFAssignee(v.config.fAssignee ?? ""); setFStatus(v.config.fStatus ?? ""); setFEpic(v.config.fEpic ?? "");
            }}
            className="rounded border px-2 py-0.5">📌 {v.name}</button>
        ))}
      </div>

      <div className="overflow-auto rounded border bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="p-1"><input type="checkbox"
                checked={sorted.length > 0 && sorted.every((t) => selected.has(t.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((t) => t.id)) : new Set())} /></th>
              {visible.map((c) => (
                <th key={c}
                  onClick={() => toggleSort(c)}
                  className="group cursor-pointer whitespace-nowrap p-1 text-left hover:underline"
                  style={widths[c] ? { width: widths[c], minWidth: widths[c] } : undefined}>
                  {headerOf(c)}{sort.key === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  {RO_COLS.has(c) && <span title="Read-only column"> 🔒</span>}
                  <span
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startResize(c, e); }}
                    onClick={(e) => e.stopPropagation()}
                    title="Drag to resize"
                    className="ml-1 inline-block h-3 w-1 cursor-col-resize align-middle text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
                  >|</span>
                </th>
              ))}
              <th className="p-1 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g, gi) => (
              <Fragment key={g.name || `all-${gi}`}>
                {g.name && <tr key={"g" + g.name}><td colSpan={visible.length + 2} className="bg-slate-100 p-1 font-semibold dark:bg-slate-800">{g.name} ({g.items.length})</td></tr>}
                {g.items.map((t) => <TableRow key={t.id} t={t} />)}
              </Fragment>
            ))}
            {/* Quick "+ New task" row at the bottom of the table. */}
            {can("create_task") && (
              <tr className="border-t border-dashed dark:border-slate-800">
                <td className="p-1">＋</td>
                <td colSpan={visible.length} className="p-1">
                  <span className="flex items-center gap-1">
                    <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(); }}
                      placeholder="New task title… (Enter to add)"
                      className="w-full max-w-md rounded border border-transparent bg-transparent p-0.5 hover:border-slate-300 dark:hover:border-slate-600" />
                    <select value={quickStatus} onChange={(e) => setQuickStatus(e.target.value)}
                      className="rounded border border-transparent bg-transparent p-0.5 hover:border-slate-300 dark:hover:border-slate-600">
                      <option value="">(default status)</option>
                      {lookups.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => void quickAdd()} disabled={!quickTitle.trim()}
                      className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50">
                      Add
                    </button>
                  </span>
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Click a key to open details. Row colour = status, ● = priority, 🔒 = read-only.
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
