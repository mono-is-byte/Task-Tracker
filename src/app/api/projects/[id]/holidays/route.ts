import { ok, requireMember, serverError } from "@/lib/api";
import { db } from "@/lib/db";
import { holidayKeysInRange } from "@/lib/holidays";
import { dayKey } from "@/lib/calendar";

/**
 * Project holiday feed - used by the Workload page to exclude holidays from
 * capacity. Holidays are global for everyone (item 1), so this is simply the
 * full holiday list; add/edit/delete lives in Calendar -> "Calendar Settings".
 *
 * `dates` expands every range into individual day keys and `exceptions` lists
 * the working-day exceptions, so capacity maths can apply the same precedence
 * as the calendar: an exception makes a date a working day again.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "1970-01-01";
  const to = url.searchParams.get("to") ?? "2999-12-31";
  try {
    const [expanded, holidays] = await Promise.all([
      holidayKeysInRange(db, from, to),
      db.holiday.findMany({ orderBy: { date: "asc" } }),
    ]);
    return ok({
      holidays: holidays.map((h) => ({
        id: h.id,
        startDate: dayKey(h.date),
        endDate: h.endDate ? dayKey(h.endDate) : dayKey(h.date),
        name: h.name,
        type: h.type,
      })),
      dates: expanded.holidays,
      exceptions: expanded.exceptions,
    });
  } catch (e) {
    return serverError(e, "Could not load the project holidays.");
  }
}
