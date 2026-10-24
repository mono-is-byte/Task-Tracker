"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * The ONE reusable confirmation dialog for every destructive action (project,
 * task, user, holiday, status column, automation rule …). Callers always name
 * the item and its consequences; the destructive button must be clicked
 * explicitly — nothing is deleted on backdrop click or Escape.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Portaled to <body> (same pattern as NotificationsBell): the task table tints
  // hovered cells with `filter`, and a filter turns the cell into the containing
  // block for position:fixed descendants — without the portal this dialog would
  // be trapped inside the row, clipped by the table's scroll container and
  // flicker while the pointer moves (the "blinking, unusable" delete bug).
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="glass-strong max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg border border-line p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="mb-1 break-words text-sm font-bold">{title}</h4>
        {body && <p className="mb-3 break-words text-xs text-muted">{body}</p>}
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button onClick={onCancel} className="w-full rounded border border-line px-3 py-1.5 text-xs hover:bg-line sm:w-auto">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="w-full rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
