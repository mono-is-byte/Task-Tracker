import { fail, ok, requireMember } from "@/lib/api";
import { db, taskKey } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TASK_CSV_COLUMNS, estDays } from "@/lib/domain";
import * as XLSX from "xlsx";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "export");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();

  const full = await db.task.findMany({
    where: { projectId: id },
    include: {
      status: true, priority: true,
      assignee: { select: { name: true } }, testedBy: { select: { name: true } },
      epic: true, story: true,
      comments: { where: { kind: "remark" }, orderBy: { createdAt: "asc" } },
      linksFrom: { include: { to: { select: { serial: true } } } },
    },
    orderBy: { serial: "asc" },
  });
  const keyOf = (serial: number) => taskKey(loaded.project.key, serial);
  const byId = new Map(full.map((t) => [t.id, t]));

  const rows: Record<string, string | number>[] = full.map((t) => ({
    SL: t.serial,
    Epic: t.epic?.name ?? "",
    "User Story": t.story?.title ?? "",
    "Task title": t.title,
    "Story Points": t.storyPoints ?? "",
    "Est. Hours": t.estHours ?? "",
    "Est. Days": estDays(t.estHours, loaded.project.hoursPerDay) ?? "",
    Description: t.description ?? "",
    Priority: t.priority.name,
    Status: t.status.name,
    Assignee: t.assignee?.name ?? "",
    "Start Date": fmtDate(t.startDate),
    "End Date": fmtDate(t.endDate),
    Remarks: t.comments.map((c) => c.body).join("\n---\n"),
    "Git Branch": t.gitBranch ?? "",
    "Tested By": t.testedBy?.name ?? "",
    Dependency: t.linksFrom.map((l) => {
      const target = byId.get(l.toId);
      return target ? keyOf(target.serial) : "";
    }).filter(Boolean).join(", "),
    Feedback: "",
  }));

  // Feedback comments appended per task
  const feedbacks = await db.comment.findMany({
    where: { task: { projectId: id }, kind: "feedback" },
    orderBy: { createdAt: "asc" },
  });
  const fbByTask = new Map<string, string[]>();
  for (const f of feedbacks) {
    const arr = fbByTask.get(f.taskId) ?? [];
    arr.push(f.body);
    fbByTask.set(f.taskId, arr);
  }
  for (let i = 0; i < rows.length; i++) {
    rows[i].Feedback = (fbByTask.get(full[i].id) ?? []).join("\n---\n");
  }

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...TASK_CSV_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tasks");
  if (format === "xlsx") {
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${loaded.project.key}-tasks.xlsx"`,
      },
    });
  }
  const csv = XLSX.utils.sheet_to_csv(ws);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${loaded.project.key}-tasks.csv"`,
    },
  });
}
