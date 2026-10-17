"use client";

import { useEffect, useRef, useState } from "react";

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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <form
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !busy) onSave(value.trim());
        }}
      >
        <h4 className="mb-2 text-sm font-bold">{title}</h4>
        <input
          ref={inputRef}
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          className="mb-2 w-full rounded border border-line bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-line px-3 py-1 text-xs hover:bg-line">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
