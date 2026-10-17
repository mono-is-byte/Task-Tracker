import { z } from "zod";
import { fail, ok, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { fetchCalendarData, widenRange } from "@/lib/calendar";

// Phase 4: cross-project calendar feed. Scope = the user's projects
// (superadmin: all); hidden projects stay included for their members.
const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
});

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const q = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    projectId: q.get("projectId") || undefined,
    assigneeId: q.get("assigneeId") || undefined,
  });
  if (!parsed.success) return fail(400, "validation", "from and to (YYYY-MM-DD) are required.");
  if (parsed.data.from > parsed.data.to) return fail(400, "validation", "from must not be after to.");
  let range;
  try {
    range = widenRange(parsed.data.from, parsed.data.to);
  } catch (e) {
    return fail(400, "validation", e instanceof Error ? e.message : "Invalid date.");
  }
  try {
    const data = await fetchCalendarData(db, auth.user, {
      from: range.from,
      to: range.to,
      projectId: parsed.data.projectId,
      assigneeId: parsed.data.assigneeId === "me" ? auth.user.id : parsed.data.assigneeId,
    });
    return ok(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid calendar request.";
    if (msg === "No access to this project.") return fail(403, "forbidden", msg);
    return fail(400, "validation", msg);
  }
}
