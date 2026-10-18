"use client";

import { useEffect, useRef, useState } from "react";
import { deleteTask, patchTask } from "@/lib/taskStore";
import ConfirmDialog from "./ConfirmDialog";
import RenameDialog from "./RenameDialog";
import { IconDots, IconPencil, IconTrash } from "./icons";

/**
 * Reusable per-task actions menu (vertical dots): Rename + Delete. Used by
 * board cards, table rows and the task drawer. Callers gate each action with
 * their own permission checks; the API re-checks server-side regardless.
 *
 * Both actions go through the shared task store (`patchTask`/`deleteTask`), so
 * the rename/delete is applied optimistically and every view subscribed to the
 * project (board, table, timeline, drawer) updates from ONE code path - and a
 * failed request rolls the row back instead of leaving a phantom task.
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
  variant = "menu",
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
  /** Change request (table Actions column): show Rename + Delete as icon
   *  buttons instead of the vertical-dots dropdown. The column stays narrow
   *  because the buttons carry no text — the accessible name comes from
   *  aria-label/title. */
  variant?: "menu" | "buttons";
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
      await patchTask(projectId, taskId, { title: name });
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
      await deleteTask(projectId, taskId);
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
      {variant === "buttons" ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {canRename && (
            <button
              type="button"
              aria-label={`Rename ${taskKey ?? "task"}`}
              title={`Rename ${taskKey ?? "task"}`}
              onClick={(e) => { e.stopPropagation(); setRenaming(true); setErr(""); }}
              className="tt-btn tt-btn-sm"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label={`Delete ${taskKey ?? "task"}`}
              title={`Delete ${taskKey ?? "task"}`}
              onClick={(e) => { e.stopPropagation(); setDeleting(true); setErr(""); }}
              className="tt-btn tt-btn-sm text-red-600 dark:text-red-400"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ) : (
        <>
          <button
            type="button"
            aria-label="Task actions"
            title="Task actions"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="rounded px-1 py-0.5 text-muted opacity-70 transition-opacity hover:bg-line hover:opacity-100"
          >
            <IconDots className="h-4 w-4" />
          </button>
          {open && (
            <div
              className={`absolute top-full z-40 mt-1 w-32 rounded border border-line bg-surface py-1 text-xs shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
            >
              {canRename && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setRenaming(true); setErr(""); }}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-line"
                >
                  <IconPencil className="h-3.5 w-3.5" /> Rename
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setDeleting(true); setErr(""); }}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-red-600 hover:bg-line dark:text-red-400"
                >
                  <IconTrash className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </div>
          )}
        </>
      )}
      {/* Both dialogs render themselves through a portal to <body>
          (createPortal in RenameDialog/ConfirmDialog), so they survive the
          table's row re-renders while the pointer moves and never get
          trapped inside a cell/stacking context. */}
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
          body={`"${title}" will be removed from the board, table, reports and calendar, together with its comments and activity history. This cannot be undone.`}
          busy={busy}
          error={err}
          onCancel={() => setDeleting(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
