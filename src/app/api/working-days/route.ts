import { z } from "zod";
import { clientIp, fail, ok, readJson, requireUser, serverError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  addWorkingDayException,
  listHolidays,
  removeWorkingDayException,
  type Failure,
} from "@/lib/holidays";

/**
 * Working-day exceptions ("Office Open"): a date stays a working day even if it
 * is a Friday/Saturday or a configured holiday. Admin-managed, global - same
 * scope as the holidays themselves:
 *
 *   POST   { date, note? }   mark a date as a working day (idempotent)
 *   DELETE ?date=YYYY-MM-DD  remove it, restoring the original holiday status
 *   GET                      the full holiday list incl. exceptions (same
 *                            payload as /api/holidays, for convenience)
 */

const CreateBody = z.object({
  date: z.string(),
  note: z.string().max(300).optional(),
});

function failFrom(res: Failure, code: string): Response {
  return fail(res.status, code, res.error);
}

function codeFor(status: number): string {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "validation";
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  try {
    return ok(await listHolidays(db, auth.user));
  } catch (e) {
    return serverError(e, "Could not load the working-day exceptions.");
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "A date (YYYY-MM-DD) is required.");
  try {
    const res = await addWorkingDayException(db, auth.user, parsed.data, clientIp(req));
    if (!res.ok) return failFrom(res, codeFor(res.status));
    return ok({ exception: res.exception }, 201);
  } catch (e) {
    return serverError(e, "Could not mark the date as a working day.");
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const date = new URL(req.url).searchParams.get("date");
  if (!date) return fail(400, "validation", "date query param required.");
  try {
    const res = await removeWorkingDayException(db, auth.user, date, clientIp(req));
    if (!res.ok) return failFrom(res, codeFor(res.status));
    return ok({ removed: true });
  } catch (e) {
    return serverError(e, "Could not restore the holiday status for this date.");
  }
}
