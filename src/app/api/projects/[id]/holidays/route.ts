import { ok, requireMember } from "@/lib/api";
import { db } from "@/lib/db";

/**
 * Project holiday feed — used by the Workload page to exclude holidays from
 * capacity. Holidays are global for everyone (item 1), so this is simply the
 * full holiday list; add/edit/delete lives in Calendar → "Calendar Settings".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const holidays = await db.holiday.findMany({ orderBy: { date: "asc" } });
  return ok({ holidays });
}
