"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Audit Log — PHASE 6.
 *
 * The server caps the table at the newest 25 rows (`AUDIT_RETENTION`) and prunes
 * the rest inline, so this page is a plain "latest events" list: no pagination,
 * no "load more", no page 2. Rows are compact and the panel scrolls on its own,
 * so all 25 fit a normal window.
 *
 * Entity ids are resolved to readable labels server-side ("user: Administrator"),
 * and `meta` shows as a one-line summary that expands to the full JSON on click.
 */

interface Log {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  entityLabel: string | null;
  meta: string;
  ip: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

const META_LIMIT = 40;

function short(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > META_LIMIT ? `${s.slice(0, META_LIMIT)}…` : s;
}

/** One-line, human-readable summary of a stored meta blob ("name: old → new"). */
function metaSummary(meta: string): string {
  try {
    const value = JSON.parse(meta) as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length === 0) return "no changes recorded";
    return keys
      .map((k) => {
        const v = value[k];
        if (Array.isArray(v) && v.length === 2) return `${k}: ${short(v[0])} → ${short(v[1])}`;
        if (v && typeof v === "object") return `${k}: {…}`;
        return `${k}: ${short(v)}`;
      })
      .join("  ·  ");
  } catch {
    return short(meta);
  }
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [limit, setLimit] = useState(25);
  const [filter, setFilter] = useState("");

  const load = useCallback(async (action: string) => {
    const res = await fetch(`/api/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`);
    if (!res.ok) {
      if (res.status === 403) window.location.href = "/no-access";
      return;
    }
    const j = await res.json();
    setLogs(j.data.logs);
    setActions(j.data.actions);
    if (typeof j.data.limit === "number") setLimit(j.data.limit);
  }, []);

  useEffect(() => { void load(""); }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Audit Log</h1>
        <span className="text-[11px] text-muted">Showing the latest {limit} events</span>
      </div>
      <div className="mb-2 flex gap-2 text-sm">
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); void load(e.target.value); }}
          className="tt-input max-w-xs"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {/* One scroll container: sticky head, compact rows, no empty tail. */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-surface-strong">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-strong text-left">
            <tr>
              <th className="p-2 font-semibold">Time</th>
              <th className="p-2 font-semibold">Actor</th>
              <th className="p-2 font-semibold">Action</th>
              <th className="p-2 font-semibold">Entity</th>
              <th className="p-2 font-semibold">Change</th>
              <th className="p-2 font-semibold">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-line align-top hover:bg-line/40">
                <td className="whitespace-nowrap p-2 tabular-nums">
                  {new Date(l.createdAt).toLocaleString(undefined, {
                    year: "numeric", month: "short", day: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </td>
                <td className="break-all p-2">{l.actor ? `${l.actor.name} (${l.actor.email})` : "—"}</td>
                <td className="break-all p-2 font-mono">{l.action}</td>
                <td className="p-2">
                  {l.entityLabel ?? (l.entity ? `${l.entity} ${l.entityId?.slice(0, 8) ?? ""}` : "—")}
                </td>
                <td className="max-w-md p-2 text-muted">
                  <details>
                    <summary className="cursor-pointer truncate" title={l.meta}>{metaSummary(l.meta)}</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">{l.meta}</pre>
                  </details>
                </td>
                <td className="whitespace-nowrap p-2 font-mono">{l.ip ?? "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted">No audit events yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
