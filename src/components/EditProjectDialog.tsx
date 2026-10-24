"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Same rule as the "New project" form + the settings API (uppercase letters/digits). */
const KEY_RE = /^[A-Z0-9]+$/;

/**
 * Change request: "when I edit the project name there should be an option to
 * edit both the project name and the key". This dialog mirrors the New project
 * fields (KEY + Project name) with the project's current values pre-filled.
 * The key prefixes every task key (LVM-12 → NEW-12) because task keys are
 * computed from it, so nothing stored needs migrating. Enter saves, Escape
 * cancels, and Save stays disabled until something actually changed.
 */
export default function EditProjectDialog({
  project,
  busy = false,
  error = "",
  onCancel,
  onSave,
}: {
  project: { key: string; name: string };
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (key: string, name: string) => void;
}) {
  const [key, setKey] = useState(project.key);
  const [name, setName] = useState(project.name);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    keyRef.current?.focus();
    keyRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const nextKey = key.trim().toUpperCase();
  const nextName = name.trim();
  const keyOk = KEY_RE.test(nextKey);
  const valid = keyOk && nextName.length > 0;
  const dirty = nextKey !== project.key || nextName !== project.name;

  // Portaled to <body> (same pattern as ConfirmDialog): the sidebar is a
  // `sticky`/`transform`ed container, so a fixed-position dialog rendered
  // inside it gets trapped in the sidebar's stacking/paint context and
  // overlaps or is clipped on pages other than the board (change request:
  // "working well in board page but on others it overlaps").
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <form
        className="glass-strong max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg border border-line p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && dirty && !busy) onSave(nextKey, nextName);
        }}
      >
        <h4 className="mb-1 text-sm font-bold">Edit project</h4>
        <p className="mb-3 text-xs text-muted">
          Task keys use the project key, so they become <span className="font-mono">{nextKey || "KEY"}-12</span> everywhere.
        </p>
        <label className="mb-2 block">
          <span className="mb-1 block text-xs text-muted">Key</span>
          <input
            ref={keyRef}
            value={key}
            maxLength={10}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="KEY (e.g. MAP)"
            className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-xs text-muted">Project name</span>
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </label>
        {!keyOk && nextKey.length > 0 && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">Key must be uppercase letters/digits (max 10), e.g. MAP.</p>
        )}
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="w-full rounded border border-line px-3 py-1.5 text-xs hover:bg-line sm:w-auto">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !valid || !dirty}
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
