import { z } from "zod";
import { clientIp, fail, ok, readJson, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { createHoliday, deleteHoliday, listHolidays, updateHoliday, type Failure } from "@/lib/holidays";

/**
 * Holiday management for Calendar → "Calendar Settings". Holidays are global
 * for everyone (no per-project scope) and Admin-managed. The workload page
 * keeps reading holidays through the project-scoped GET route.
 */

const CreateBody = z.object({
  date: z.string(),
  name: z.string().max(120).optional(),
});

const PatchBody = z.object({
  date: z.string().optional(),
  name: z.string().max(120).optional(),
});

function failFrom(res: Failure, code: string): Response {
  return fail(res.status, code, res.error);
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  return ok(await listHolidays(db, auth.user));
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = CreateBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "date is required; name may be up to 120 characters.");
  const res = await createHoliday(db, auth.user, parsed.data, clientIp(req));
  if (!res.ok) return failFrom(res, res.status === 403 ? "forbidden" : "validation");
  return ok({ holiday: res.holiday }, 201);
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
  const res = await updateHoliday(db, auth.user, id, parsed.data, clientIp(req));
  if (!res.ok) return failFrom(res, res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "validation");
  return ok({ holiday: res.holiday });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "validation", "id query param required.");
  const res = await deleteHoliday(db, auth.user, id, clientIp(req));
  if (!res.ok) return failFrom(res, res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "validation");
  return ok({ deleted: true });
}
