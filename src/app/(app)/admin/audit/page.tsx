"use client";

import { useEffect, useState } from "react";

interface Log {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: string;
  ip: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  async function load(action = "") {
    const res = await fetch(`/api/admin/audit?take=200${action ? `&action=${action}` : ""}`);
    if (!res.ok) {
      if (res.status === 403) window.location.href = "/no-access";
      return;
    }
    const j = await res.json();
    setLogs(j.data.logs);
    setActions(j.data.actions);
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Audit Log</h1>
      <div className="mb-2 flex gap-2 text-sm">
        <select value={filter} onChange={(e) => { setFilter(e.target.value); load(e.target.value); }}
          className="rounded border p-1 dark:border-slate-700 dark:bg-slate-800">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {/* Item 8: capped height + sticky header so a 200-row log never grows the page. */}
      <div className="scroll-thin max-h-[420px] overflow-auto rounded border bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50 text-left dark:bg-slate-800">
            <tr><th className="p-2">Time</th><th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Entity</th><th className="p-2">Meta</th><th className="p-2">IP</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t dark:border-slate-800">
                <td className="whitespace-nowrap p-2">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="p-2">{l.actor ? `${l.actor.name} (${l.actor.email})` : "—"}</td>
                <td className="p-2 font-mono">{l.action}</td>
                <td className="p-2 font-mono">{l.entity ?? ""} {l.entityId?.slice(0, 8) ?? ""}</td>
                <td className="max-w-xs truncate p-2 font-mono text-slate-500" title={l.meta}>{l.meta}</td>
                <td className="p-2">{l.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
