"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { useLive, useProject } from "@/hooks/useProject";
import TaskDrawer from "@/components/TaskDrawer";

interface Task {
  id: string; key: string; title: string;
  storyPoints: number | null; estHours: number | null;
  status: { name: string; color: string };
  assignee: { name: string } | null;
  endDate: string | null;
}

export default function ArchivePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [search, setSearch] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const liveTick = useLive(projectId);

  async function load() {
    try {
      const q = new URLSearchParams({ archived: "true", take: "1000" });
      if (search) q.set("search", search);
      const d = await api<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks?${q}`);
      setTasks(d.tasks);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Load failed.");
    }
  }

  useEffect(() => { load(); }, [search, liveTick]);
  if (!lookups) return <p className="text-sm">Loading…</p>;
  const canArchive = lookups.membership.perms.manage_archive === true || lookups.membership.isSuperAdmin;

  async function reopen(id: string) {
    // Re-open = move to the Re-open status if available, else first non-done status
    const target = lookups!.statuses.find((s) => s.name === "Re-open") ?? lookups!.statuses.find((s) => s.category !== "done");
    if (!target) {
      setMsg("No open status configured.");
      return;
    }
    try {
      await api(`/api/projects/${projectId}/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ statusId: target.id }) });
      setMsg("Task re-opened (moved out of Done).");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Re-open failed.");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-bold">Archive — Completed Tasks ({tasks.length})</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search archive…"
          className="rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Done tasks appear here automatically (archive is a filtered view, not a second table).
        {!canArchive && " Your role cannot re-open archived tasks."}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {tasks.map((t) => (
          <li key={t.id} className="task-row-done flex items-center gap-2 rounded border bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900"
            style={{ background: `${t.status.color}14` }}>
            <span className="font-mono text-xs text-slate-500">{t.key}</span>
            <button onClick={() => setDrawerId(t.id)} className="flex-1 truncate text-left hover:underline">{t.title}</button>
            <span className="text-xs text-slate-500">
              {t.storyPoints != null ? `◈${t.storyPoints} ` : ""}{t.estHours != null ? `⏱${t.estHours}h ` : ""}
              {t.assignee?.name ?? ""} {t.endDate ? `· done ${t.endDate.slice(0, 10)}` : ""}
            </span>
            {canArchive && <button onClick={() => reopen(t.id)} className="rounded border px-1 text-xs">Re-open</button>}
          </li>
        ))}
      </ul>
      <TaskDrawer projectId={projectId} taskId={drawerId} lookups={lookups} onClose={() => setDrawerId(null)} onChanged={load} />
    </div>
  );
}
