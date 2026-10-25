"use client";

import { useCallback, useSyncExternalStore } from "react";
import { api } from "@/lib/client";

/**
 * The single source of truth for a project's task list (item 7).
 *
 * A tiny module-level store (no new library — plain `useSyncExternalStore`)
 * shared by the Board, Table, Timeline and the task drawer:
 *
 *  - loads `/api/projects/:id/tasks` once per project and caches it,
 *  - every edit goes through `patchTask` → optimistic update → PATCH →
 *    server response replaces the row (or the change is rolled back),
 *  - one SSE subscription per project (the existing `/events` endpoint, with
 *    the same polling fallback as `useLive`) refetches on any change — so
 *    edits made by other users (or from another tab/view) appear instantly,
 *  - refetch also happens on window focus.
 *
 * Views never keep their own copies: they render `useTasks(projectId)` and
 * call the mutation helpers, so a change in the table shows up on the board,
 * timeline and drawer immediately — and vice versa.
 */

export interface TaskRow {
  id: string;
  [k: string]: unknown;
}

export interface TaskStoreState {
  tasks: TaskRow[];
  loading: boolean;
  error: string;
  /** Bumps on every successful load — lets views know to re-read. */
  version: number;
}

const EMPTY: TaskStoreState = { tasks: [], loading: true, error: "", version: 0 };

interface ProjectEntry {
  state: TaskStoreState;
  listeners: Set<() => void>;
  loading: Promise<void> | null;
  es: EventSource | null;
  poll: ReturnType<typeof setInterval> | null;
  focusHandler: (() => void) | null;
  refs: number;
  debounce: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, ProjectEntry>();

function entryFor(projectId: string): ProjectEntry {
  let e = entries.get(projectId);
  if (!e) {
    e = {
      state: EMPTY, listeners: new Set(), loading: null,
      es: null, poll: null, focusHandler: null, refs: 0, debounce: null,
    };
    entries.set(projectId, e);
  }
  return e;
}

function setState(projectId: string, patch: Partial<TaskStoreState>) {
  const e = entryFor(projectId);
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((l) => l());
}

/** Fetch the full list (the server serializes timer state per row). */
export async function refreshTasks(projectId: string): Promise<void> {
  const e = entryFor(projectId);
  if (e.loading) return e.loading;
  const p = (async () => {
    try {
      const d = await api<{ tasks: TaskRow[] }>(`/api/projects/${projectId}/tasks?take=1000`);
      setState(projectId, { tasks: d.tasks, loading: false, error: "", version: e.state.version + 1 });
    } catch (err) {
      setState(projectId, {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load tasks.",
      });
    } finally {
      e.loading = null;
    }
  })();
  e.loading = p;
  return p;
}

/** Debounced refetch (SSE bursts → one reload). */
function scheduleRefresh(projectId: string) {
  const e = entryFor(projectId);
  if (e.debounce) return;
  e.debounce = setTimeout(() => {
    e.debounce = null;
    void refreshTasks(projectId);
  }, 250);
}

function ensureLive(projectId: string) {
  const e = entryFor(projectId);
  if (e.es || e.poll) return;
  const fire = () => scheduleRefresh(projectId);
  try {
    const es = new EventSource(`/api/projects/${projectId}/events`);
    es.onmessage = fire;
    es.onerror = () => {
      // SSE failed → polling fallback (same behaviour as useLive).
      es.close();
      e.es = null;
      if (!e.poll) e.poll = setInterval(fire, 15000);
    };
    e.es = es;
  } catch {
    e.poll = setInterval(fire, 15000);
  }
  e.focusHandler = () => void refreshTasks(projectId);
  window.addEventListener("focus", e.focusHandler);
}

function releaseLive(projectId: string) {
  const e = entryFor(projectId);
  e.es?.close();
  e.es = null;
  if (e.poll) clearInterval(e.poll);
  e.poll = null;
  if (e.focusHandler) window.removeEventListener("focus", e.focusHandler);
  e.focusHandler = null;
  if (e.debounce) clearTimeout(e.debounce);
  e.debounce = null;
}

/** Optimistically merge a patch into one row (no network). */
function mergeTask(projectId: string, id: string, patch: Record<string, unknown>) {
  const e = entryFor(projectId);
  e.state = {
    ...e.state,
    tasks: e.state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  e.listeners.forEach((l) => l());
}

/** Optimistically add / replace / remove rows. */
function upsertTask(projectId: string, task: TaskRow) {
  const e = entryFor(projectId);
  const exists = e.state.tasks.some((t) => t.id === task.id);
  e.state = {
    ...e.state,
    tasks: exists ? e.state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) : [...e.state.tasks, task],
  };
  e.listeners.forEach((l) => l());
}

export function removeTask(projectId: string, id: string) {
  const e = entryFor(projectId);
  e.state = { ...e.state, tasks: e.state.tasks.filter((t) => t.id !== id) };
  e.listeners.forEach((l) => l());
}

/**
 * Optimistic PATCH: the row updates instantly everywhere, the server call
 * runs in the background and its response (serialized task) replaces the
 * optimistic row; on failure the previous state is restored and the error
 * rethrown so the caller can show it / revert its own input.
 */
export async function patchTask(
  projectId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<TaskRow> {
  const e = entryFor(projectId);
  const before = e.state.tasks;
  mergeTask(projectId, id, patch);
  try {
    const d = await api<{ task: TaskRow }>(`/api/projects/${projectId}/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (d?.task) upsertTask(projectId, d.task);
    return d.task;
  } catch (err) {
    setState(projectId, { tasks: before }); // roll back the optimistic change
    throw err;
  }
}

/** Create a task; the server row is inserted into the store. */
export async function createTask(projectId: string, body: Record<string, unknown>): Promise<TaskRow> {
  const d = await api<{ task: TaskRow }>(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (d?.task) upsertTask(projectId, d.task);
  return d.task;
}

/** Delete a task; removed optimistically, restored on failure. */
export async function deleteTask(projectId: string, id: string): Promise<void> {
  const e = entryFor(projectId);
  const before = e.state.tasks;
  removeTask(projectId, id);
  try {
    await api(`/api/projects/${projectId}/tasks/${id}`, { method: "DELETE" });
  } catch (err) {
    setState(projectId, { tasks: before });
    throw err;
  }
}

/** Timer start/stop — the serialized task from the response replaces the row. */
export async function timerAction(projectId: string, id: string, action: "start" | "stop"): Promise<void> {
  const d = await api<{ task: TaskRow }>(`/api/projects/${projectId}/tasks/${id}/timer`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  if (d?.task) upsertTask(projectId, d.task);
}

/** Subscribe a component to a project's task list. */
export function useTasks(projectId: string): TaskStoreState & { refresh: () => void } {
  const e = entryFor(projectId);

  const subscribe = useCallback((cb: () => void) => {
    const entry = entryFor(projectId);
    entry.listeners.add(cb);
    entry.refs += 1;
    ensureLive(projectId);
    if (entry.state === EMPTY || (entry.state.loading && !entry.loading)) void refreshTasks(projectId);
    return () => {
      entry.listeners.delete(cb);
      entry.refs -= 1;
      if (entry.refs <= 0) releaseLive(projectId);
    };
  }, [projectId]);

  const getSnapshot = useCallback(() => entryFor(projectId).state, [projectId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  void e;

  const refresh = useCallback(() => { void refreshTasks(projectId); }, [projectId]);
  return { ...state, refresh };
}

/** The store row for one task (kept in sync; undefined while loading). */
export function useTaskRow(projectId: string, id: string | null): TaskRow | undefined {
  const { tasks } = useTasks(projectId);
  return id ? tasks.find((t) => t.id === id) : undefined;
}
