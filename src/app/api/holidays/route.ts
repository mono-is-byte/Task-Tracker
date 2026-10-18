import { z } from "zod";
import { clientIp, fail, ok, readJson, requireUser, serverError } from "@/lib/api";
import { db } from "@/lib/db";
import { createHoliday, deleteHoliday, listHolidays, updateHoliday, type Failure } from "@/lib/holidays";

/**
 * Holiday management for Calendar -> "Calendar Settings". Holidays are global
 * for everyone (no per-project scope) and Admin-managed. Managing something?
 * `POST` creates a range (start..end inclusive), `PATCH ?id=` edits one and
 * `DELETE ?id=` removes it. Working-day exceptions live in /api/working-days.
 *
 * `date` is accepted as a legacy alias for `startDate` so older callers (and
 * tests) keep working unchanged.
 */

const CreateBody = z.object({
  startDate: z.string().optional(),
  date: z.string().optional(),
  endDate: z.string().nullable().optional(),
  name: z.string().max(120).optional(),
  description: z.string().max(300).optional(),
  type: z.string().max(40).optional(),
});

const PatchBody = CreateBody;

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
    return serverError(e, "Could not load the holidays. The server may need a restart after the database update.");
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) {
    return fail(400, "validation", "A start date (startDate or date) is required; name up to 120, description up to 300 characters.");
  }
  try {
    const res = await createHoliday(db, auth.user, parsed.data, clientIp(req));
    if (!res.ok) return failFrom(res, codeFor(res.status));
    return ok({ holiday: res.holiday }, 201);
  } catch (e) {
    return serverError(e, "Could not save the holiday.");
  }
}

export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "validation", "id query param required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = PatchBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid holiday fields.");
  try {
    const res = await updateHoliday(db, auth.user, id, parsed.data, clientIp(req));
    if (!res.ok) return failFrom(res, codeFor(res.status));
    return ok({ holiday: res.holiday });
  } catch (e) {
    return serverError(e, "Could not update the holiday.");
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "validation", "id query param required.");
  try {
    const res = await deleteHoliday(db, auth.user, id, clientIp(req));
    if (!res.ok) return failFrom(res, codeFor(res.status));
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e, "Could not delete the holiday.");
  }
}
