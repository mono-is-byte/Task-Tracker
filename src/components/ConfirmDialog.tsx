"use client";

import { useEffect } from "react";

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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="mb-1 text-sm font-bold">{title}</h4>
        {body && <p className="mb-3 text-xs text-muted">{body}</p>}
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-line px-3 py-1 text-xs hover:bg-line">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
