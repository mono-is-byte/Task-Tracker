"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import { workingDaysBetween } from "@/lib/domain";
import { IconWarning } from "@/components/icons";

interface WTask {
  id: string; key: string; title: string;
  assigneeId: string | null;
  estHours: number | null;
  startDate: string | null; endDate: string | null;
  status: { category: string };
}

function weekStart(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  const day = (c.getDay() + 6) % 7; // Monday first
  c.setDate(c.getDate() - day);
  return c;
}

export default function WorkloadPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups } = useProject(projectId);
  const [tasks, setTasks] = useState<WTask[]>([]);
  // Holiday day keys (ranges already expanded by the API) + working-day
  // exceptions: an exception turns a holiday/weekly holiday back into a
  // working day for capacity, exactly like the calendar shows it.
  const [holDates, setHolDates] = useState<string[]>([]);
  const [exceptions, setExceptions] = useState<string[]>([]);

  useEffect(() => {
    api<{ tasks: WTask[] }>(`/api/projects/${projectId}/tasks?take=1000&archived=false`)
      .then((d) => setTasks(d.tasks)).catch(() => {});
    api<{ dates: string[]; exceptions: string[] }>(`/api/projects/${projectId}/holidays`)
      .then((d) => { setHolDates(d.dates ?? []); setExceptions(d.exceptions ?? []); })
      .catch(() => {});
  }, [projectId]);

  const weeks = useMemo(() => {
    const start = weekStart(new Date());
    return Array.from({ length: 6 }, (_, i) => {
      const s = new Date(start);
      s.setDate(s.getDate() + i * 7);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      return { start: s, end: e };
    });
  }, []);

  if (!lookups) return <p className="text-sm">Loading…</p>;

  // One row per project member, plus anyone with a task assigned in this project
  // (tasks can be assigned to a registered user who is not a project member) —
  // so no assignment is missing from the workload view.
  const assignedIds = new Set(tasks.map((t) => t.assigneeId).filter((id): id is string => Boolean(id)));
  const people = lookups.members.filter((m) => m.isMember || assignedIds.has(m.userId));

  const rows = people.map((mem) => {
    const rate = mem.hoursPerDay ?? lookups.project.hoursPerDay;
    const mine = tasks.filter((t) => t.assigneeId === mem.userId);
    const cells = weeks.map((w) => {
      const overlap = mine.filter((t) => {
        const s = t.startDate ? new Date(t.startDate) : w.start;
        const e = t.endDate ? new Date(t.endDate) : w.end;
        return s <= w.end && e >= w.start;
      });
      const planned = Math.round(overlap.reduce((a, t) => a + (t.estHours ?? 0), 0) * 100) / 100;
      const cap = rate * workingDaysBetween(w.start, w.end, lookups.project.workingDays, holDates, exceptions);
      return { planned, cap, over: planned > cap, n: overlap.length };
    });
    return { mem, cells, total: mine.length };
  });

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold">Workload</h2>
      <p className="mb-2 text-xs text-slate-500">
        Planned hours vs capacity per person per week (Mon–Sun). Undated tasks count toward every overlapping week shown;
        tasks without dates land in the current week. Overload is highlighted.
      </p>
      <div className="overflow-auto rounded border bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="p-2 text-left">Person</th>
              {weeks.map((w) => (
                <th key={w.start.toISOString()} className="p-2 text-left">
                  {w.start.toISOString().slice(0, 10)} → {w.end.toISOString().slice(0, 10)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ mem, cells, total }) => (
              <tr key={mem.userId} className="border-t dark:border-slate-800">
                <td className="p-2 font-semibold">
                  {mem.name}
                  {!mem.isMember && <span className="ml-1 rounded bg-line px-1 text-[10px] font-normal text-muted" title="Assigned to work in this project without project membership">not a member</span>}
                  <br /><span className="font-normal text-slate-500">{total} active task(s)</span>
                </td>
                {cells.map((c, i) => (
                  <td key={i} className={`p-2 ${c.over ? "bg-red-100 font-bold text-red-800 dark:bg-red-950 dark:text-red-200" : ""}`}>
                    {c.planned}h / {c.cap}h{c.over && (
                      <span className="ml-1 inline-flex items-center gap-0.5 align-middle" title="Planned hours exceed the capacity for this week">
                        <IconWarning className="h-3 w-3" /> OVER
                      </span>
                    )} <span className="text-slate-500">({c.n})</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
