"use client";

import { useMemo, useState } from "react";
import { suggestedForStatus } from "@/lib/workflow";
import { userOptionLabel } from "@/lib/memberLabel";
import Avatar from "@/components/Avatar";
import type { Lookups } from "@/hooks/useProject";

interface Props {
  lookups: Lookups;
  statusId: string; // target status the user picked
  currentAssigneeId?: string | null;
  onConfirm: (assigneeId: string | null) => void; // null = skip (status change only)
  onCancel: () => void;
}

/**
 * "Assign to" step shown during a status change:
 * members whose (free-text) designation matches the new status's suggestion
 * list come first, everyone else stays selectable, and the step can be skipped
 * entirely.
 */
export default function AssignStepDialog({ lookups, statusId, currentAssigneeId, onConfirm, onCancel }: Props) {
  const [picked, setPicked] = useState<string | null>(currentAssigneeId ?? null);

  const status = lookups.statuses.find((s) => s.id === statusId);
  const { suggested, others } = useMemo(
    () => suggestedForStatus(lookups.members, status?.designationTags ?? []),
    [lookups.members, status],
  );

  const row = (m: Lookups["members"][number], isSuggested: boolean) => {
    const label = userOptionLabel(m);
    return (
      <button
        key={m.userId}
        onClick={() => setPicked(m.userId === picked ? null : m.userId)}
        title={label}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition ${
          picked === m.userId
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
            : "hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        }`}
      >
        <Avatar name={m.name} url={m.avatarUrl} size={20} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {isSuggested && (
          <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Suggested
          </span>
        )}
        {m.userId === currentAssigneeId && (
          <span className="shrink-0 text-[10px] text-slate-400">(current)</span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Assign to"
        className="w-full max-w-sm rounded-lg border bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="mb-1 font-semibold">
          Move to {status?.name ?? "status"} — assign to…
        </h4>
        <p className="mb-3 text-xs text-slate-500">
          {suggested.length > 0
            ? "Users whose designation matches this status's suggestion list are shown first."
            : "Pick a user, or skip to move the task without changing its assignee."}
        </p>

        <div className="mb-2 max-h-60 space-y-1 overflow-auto">
          {suggested.map((m) => row(m, true))}
          {others.length > 0 && suggested.length > 0 && (
            <p className="pt-1 text-[10px] uppercase tracking-wide text-slate-400">Other users</p>
          )}
          {others.map((m) => row(m, false))}
          {suggested.length === 0 && others.length === 0 && (
            <p className="text-xs text-slate-400">No users available.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border px-3 py-1 text-sm dark:border-slate-700">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(picked === currentAssigneeId ? null : picked)}
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white"
          >
            {picked ? "Move & assign" : "Skip — just move"}
          </button>
        </div>
      </div>
    </div>
  );
}
