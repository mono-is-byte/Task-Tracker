"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Small reusable rename dialog (project / task). Enter saves, Escape cancels. */
export default function RenameDialog({
  title,
  initialValue,
  maxLength = 120,
  busy = false,
  error = "",
  onCancel,
  onSave,
}: {
  title: string;
  initialValue: string;
  maxLength?: number;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Portaled to <body> (same pattern as NotificationsBell): the task table tints
  // hovered cells with `filter`, and a filter turns the cell into the containing
  // block for position:fixed descendants — without the portal this dialog would
  // be trapped inside the row, clipped by the table's scroll container and
  // flicker while the pointer moves (the "blinking, unusable" rename bug).
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <form
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !busy) onSave(value.trim());
        }}
      >
        <h4 className="mb-2 break-words text-sm font-bold">{title}</h4>
        <input
          ref={inputRef}
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          className="mb-2 w-full rounded border border-line bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="w-full rounded border border-line px-3 py-1.5 text-xs hover:bg-line sm:w-auto">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="w-full rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
