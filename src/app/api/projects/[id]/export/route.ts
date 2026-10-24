import { fail, requireMember } from "@/lib/api";
import { db, taskKey } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { TASK_CSV_COLUMNS, estDays } from "@/lib/domain";
import { buildTaskNotes, notesAsLines } from "@/lib/notes";
import * as XLSX from "xlsx";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Table download — change request: Excel only (the CSV option is gone). The
 * workbook keeps the project's canonical task sheet (the file the import
 * expects back) and honours the table's active filters so a filtered view
 * exports exactly what is on screen.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "export");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const fAssignee = url.searchParams.get("assignee") ?? "";
  const fStatus = url.searchParams.get("status") ?? "";
  const fEpic = url.searchParams.get("epic") ?? "";

  const full = await db.task.findMany({
    where: { projectId: id },
    include: {
      status: true, priority: true,
      assignee: { select: { name: true } }, testedBy: { select: { name: true } },
      assignedBy: { select: { name: true, deletedAt: true } },
      epic: true,
      comments: { include: { author: { select: { id: true, name: true, deletedAt: true } } }, orderBy: { createdAt: "asc" } },
      linksFrom: { include: { to: { select: { serial: true } } } },
    },
    orderBy: { serial: "asc" },
  });
  const keyOf = (serial: number) => taskKey(loaded.project.key, serial);
  const byId = new Map(full.map((t) => [t.id, t]));
  // Same filter semantics as the table page's view filters.
  const filtered = full.filter((t) => {
    if (q && !`${keyOf(t.serial)} ${t.title}`.toLowerCase().includes(q)) return false;
    if (fAssignee && (t.assigneeId ?? "") !== fAssignee) return false;
    if (fStatus && t.statusId !== fStatus) return false;
    if (fEpic && (t.epicId ?? "") !== fEpic) return false;
    return true;
  });

  const rows: Record<string, string | number>[] = filtered.map((t) => {
    const notes = buildTaskNotes(t.comments);
    return {
      SL: t.serial,
      Epic: t.epic?.name ?? "",
      "Task title": t.title,
      "Est. Hours": t.estHours ?? "",
      "Est. Days": estDays(t.estHours, loaded.project.hoursPerDay) ?? "",
      Description: t.description ?? "",
      "Comments & notes": notesAsLines(notes).join("\n"),
      Priority: t.priority.name,
      Status: t.status.name,
      "Assigned By": t.assignedBy?.name ?? "",
      Assignee: t.assignee?.name ?? "",
      "Tested By": t.testedBy?.name ?? "",
      "Start Date": fmtDate(t.startDate),
      "End Date": fmtDate(t.endDate),
      "Git Branch": t.gitBranch ?? "",
      Dependency: t.linksFrom.map((l) => {
        const target = byId.get(l.toId);
        return target ? keyOf(target.serial) : "";
      }).filter(Boolean).join(", "),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...TASK_CSV_COLUMNS] });
  // Readable default widths so long titles/descriptions do not hide in cells.
  ws["!cols"] = TASK_CSV_COLUMNS.map((c) => ({
    wch: c === "Task title" || c === "Description" ? 42 : c === "Comments & notes" ? 32 : Math.max(10, c.length + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tasks");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${loaded.project.key}-tasks.xlsx"`,
    },
  });
}
