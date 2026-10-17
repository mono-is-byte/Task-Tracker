"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import ConfirmDialog from "./ConfirmDialog";
import RenameDialog from "./RenameDialog";

/**
 * Reusable per-task actions menu ("⋯"): Rename + Delete. Used by board cards,
 * table rows and the task drawer. Callers gate each action with their own
 * permission checks; the API re-checks server-side regardless.
 */
export default function TaskMenu({
  projectId,
  taskId,
  taskKey,
  title,
  canRename,
  canDelete,
  onChanged,
  onDeleted,
  align = "right",
}: {
  projectId: string;
  taskId: string;
  taskKey?: string;
  title: string;
  canRename: boolean;
  canDelete: boolean;
  /** Called after a successful rename (refresh the list). */
  onChanged?: () => void;
  /** Called after a successful delete; defaults to onChanged. */
  onDeleted?: () => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!canRename && !canDelete) return null;

  async function doRename(name: string) {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: name }),
      });
      setRenaming(false);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" });
      setDeleting(false);
      (onDeleted ?? onChanged)?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Task actions"
        title="Task actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded px-1 text-muted opacity-70 hover:bg-line hover:opacity-100"
      >
        ⋯
      </button>
      {open && (
        <div
          className={`absolute top-full z-40 mt-1 w-32 rounded border border-line bg-surface py-1 text-xs shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {canRename && (
            <button
              type="button"
              onClick={() => { setOpen(false); setRenaming(true); setErr(""); }}
              className="block w-full px-2 py-1 text-left hover:bg-line"
            >
              ✎ Rename
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => { setOpen(false); setDeleting(true); setErr(""); }}
              className="block w-full px-2 py-1 text-left text-red-600 hover:bg-line dark:text-red-400"
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}
      {renaming && (
        <RenameDialog
          title={`Rename ${taskKey ?? "task"}`}
          initialValue={title}
          maxLength={300}
          busy={busy}
          error={err}
          onCancel={() => setRenaming(false)}
          onSave={doRename}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${taskKey ?? "this task"}?`}
          body={`“${title}” will be removed from the board, table, reports and calendar, together with its comments and activity history. This cannot be undone.`}
          busy={busy}
          error={err}
          onCancel={() => setDeleting(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
