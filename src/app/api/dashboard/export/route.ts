import * as XLSX from "xlsx";
import { requireUser } from "@/lib/api";
import { db, taskKey } from "@/lib/db";
import { dashboardLists, dashboardSummary } from "@/lib/dashboard";
import { listProjectsForUser } from "@/lib/server";

/**
 * Change request: the Dashboard downloads the entire page as PDF + Excel —
 * CSV is gone. This route serves the genuine .xlsx workbook: real data only,
 * one clearly named worksheet per dashboard section (KPIs, distributions and
 * the four lists). The project-wise filter is validated against the viewer's
 * own projects exactly like the page, so the export can never expose data the
 * viewer cannot already see.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get("project") ?? "";
  const projects = await listProjectsForUser(auth.user.id, auth.user.isSuperAdmin);
  const selected = projects.find((p) => p.id === requested) ?? null;
  const projectIds = selected ? [selected.id] : projects.map((p) => p.id);

  const [summary, lists] = await Promise.all([
    dashboardSummary(db, auth.user.id, auth.user.isSuperAdmin, selected?.id),
    dashboardLists(db, auth.user.id, projectIds),
  ]);
  const { assigned, qaQueue, overdue, recent } = lists;

  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: (string | number)[][], widths?: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const taskRow = (t: (typeof assigned)[number]): (string | number)[] => [
    taskKey(t.project.key, t.serial),
    t.title,
    t.status.name,
    t.priority.name,
    t.project.name,
    t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : "",
  ];
  const taskWidths = [12, 44, 16, 12, 26, 12];

  add("Summary", [
    ["Dashboard summary"],
    ["Scope", selected ? `${selected.key} · ${selected.name}` : "All projects"],
    ["Generated", new Date().toISOString()],
    [],
    ["Metric", "Value"],
    ["Total tasks", summary.totals.all],
    ["Completed", summary.totals.done],
    ["Completion %", summary.completionPct],
    ["Open", summary.totals.open],
    ["In progress", summary.totals.inProgress],
    ["Pending", summary.totals.pending],
    ["Overdue", summary.totals.overdue],
    ["My open tasks", summary.myOpen],
    ["My overdue tasks", summary.myOverdue],
    ["Timers running", summary.runningNow],
    ["Timers overdue", summary.timerOverdue],
    ["Projects in view", summary.projectCount],
  ]);

  add("By Status", [["Status", "Tasks"], ...summary.byStatus.map((s) => [s.name, s.count])]);
  add("By Priority", [["Priority", "Tasks"], ...summary.byPriority.map((p) => [p.name, p.count])]);
  add("Per Member", [["Member", "Open tasks"], ...summary.perMember.map((m) => [m.name, m.count])]);
  add("Assigned to me", [["Key", "Task", "Status", "Priority", "Project", "Due"], ...assigned.map(taskRow)], taskWidths);
  add("Waiting for testing", [["Key", "Task", "Status", "Priority", "Project", "Due"], ...qaQueue.map(taskRow)], taskWidths);
  add("Overdue", [["Key", "Task", "Status", "Priority", "Project", "Due"], ...overdue.map(taskRow)], taskWidths);
  add("Recent activity", [
    ["Task", "Title", "Change", "By", "When"],
    ...recent.map((a) => [
      taskKey(a.task.project.key, a.task.serial),
      a.task.title,
      `${a.action}${a.field ? `:${a.field}` : ""}`,
      a.actor?.name ?? "system",
      new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " "),
    ]),
  ], [12, 44, 24, 20, 18]);
  // With a single project selected the sheet mirrors the scoped Summary
  // ("Projects in view: 1"); otherwise it lists every project in view.
  const projectRows: (string | number)[][] = selected
    ? [[selected.key, selected.name]]
    : projects.map((p) => [p.key, p.name]);
  if (projectRows.length) add("Projects", [["Key", "Name"], ...projectRows], [12, 44]);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dashboard-${selected ? selected.key : "all"}.xlsx"`,
    },
  });
}
