import { fail, ok, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { loadProject } from "@/lib/server";
import { ctxFromLoad, createTask } from "@/lib/tasks";
import * as XLSX from "xlsx";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findByName<T extends { id: string; name: string }>(arr: T[], name: string): T | undefined {
  const q = name.trim().toLowerCase();
  return arr.find((x) => x.name.toLowerCase() === q);
}

// CSV/XLSX import. Columns match TASK_CSV_COLUMNS so the current Excel sheet imports directly.
// SL and Est. Days are ignored (auto serial / always calculated).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "import");
  if ("response" in auth) return auth.response;
  const loaded = await loadProject(id, auth.user.id, auth.user.isSuperAdmin);
  if (!loaded) return fail(404, "not_found", "Project not found.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "validation", "Upload a file as form field 'file'.");
  const buf = Buffer.from(await file.arrayBuffer());
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return fail(400, "validation", "Could not parse file. Upload CSV or XLSX.");
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rows.length === 0) return fail(400, "validation", "No rows found in file.");
  if (rows.length > 2000) return fail(400, "validation", "Too many rows (max 2000 per import).");

  const ctx = ctxFromLoad(loaded.project, auth.membership, auth.user.id);
  const { statuses, priorities, members, epics } = loaded;

  const created: string[] = [];
  const errors: { row: number; error: string }[] = [];
  const pendingLinks: { fromSerial: number; depKeys: string[] }[] = [];
  const serialByKey = new Map<string, string>(); // PREFIX-N → taskId (existing + new)

  const existing = await db.task.findMany({ where: { projectId: id }, select: { id: true, serial: true } });
  for (const t of existing) serialByKey.set(`${loaded.project.key}-${t.serial}`, t.id);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 2; // header row = 1
    try {
      const title = str(r["Task title"] ?? r["Title"]);
      if (!title) throw new Error("Task title is required.");
      const epicName = str(r["Epic"]);
      const epic = epicName ? findByName(epics, epicName) : undefined;
      if (epicName && !epic) throw new Error(`Unknown Epic "${epicName}". Create it first.`);
      // PHASE 11.1: old "Story"/"User Story"/"Parent story" columns are ignored.
      const statusName = str(r["Status"]) || "To Do";
      const status = findByName(statuses, statusName);
      if (!status) throw new Error(`Unknown Status "${statusName}".`);
      const priorityName = str(r["Priority"]) || "Medium";
      const priority = findByName(priorities, priorityName);
      if (!priority) throw new Error(`Unknown Priority "${priorityName}".`);
      const assigneeName = str(r["Assignee"]);
      const assignee = assigneeName
        ? members.find((m) => m.name.toLowerCase() === assigneeName.toLowerCase() || m.username.toLowerCase() === assigneeName.toLowerCase())
        : undefined;
      if (assigneeName && !assignee) throw new Error(`Unknown Assignee "${assigneeName}".`);
      const testerName = str(r["Tested By"]);
      const tester = testerName
        ? members.find((m) => m.name.toLowerCase() === testerName.toLowerCase() || m.username.toLowerCase() === testerName.toLowerCase())
        : undefined;
      if (testerName && !tester) throw new Error(`Unknown Tested By "${testerName}".`);

      const task = await createTask(db, ctx, {
        title,
        description: str(r["Description"]) || undefined,
        estHours: num(r["Est. Hours"]),
        priorityId: priority.id,
        statusId: status.id,
        assigneeId: assignee?.userId ?? null,
        testedById: tester?.userId ?? null,
        startDate: str(r["Start Date"]) || null,
        endDate: str(r["End Date"]) || null,
        gitBranch: str(r["Git Branch"]) || null,
        epicId: epic?.id ?? null,
      });
      created.push(task.id);
      const fresh = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      serialByKey.set(`${loaded.project.key}-${fresh.serial}`, task.id);

      const remarks = str(r["Remarks"]);
      if (remarks) {
        await db.comment.create({ data: { taskId: task.id, authorId: auth.user.id, kind: "remark", body: remarks } });
      }
      const feedback = str(r["Feedback"]);
      if (feedback) {
        await db.comment.create({ data: { taskId: task.id, authorId: auth.user.id, kind: "feedback", body: feedback } });
      }
      const dep = str(r["Dependency"]);
      if (dep) {
        pendingLinks.push({ fromSerial: fresh.serial, depKeys: dep.split(/[,;\s]+/).filter(Boolean) });
      }
    } catch (e) {
      errors.push({ row: rowNo, error: e instanceof Error ? e.message : "Failed" });
    }
  }

  let links = 0;
  for (const p of pendingLinks) {
    const fromId = serialByKey.get(`${loaded.project.key}-${p.fromSerial}`);
    if (!fromId) continue;
    for (const key of p.depKeys) {
      const toId = serialByKey.get(key.toUpperCase());
      if (toId && toId !== fromId) {
        try {
          await db.taskLink.create({ data: { fromId, toId, kind: "blocks" } });
          links++;
        } catch { /* duplicate */ }
      }
    }
  }

  return ok({ created: created.length, links, errors: errors.slice(0, 50), errorCount: errors.length });
}
