import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

const FIELD_TYPES = ["text", "longtext", "number", "date", "select", "multiselect", "user", "checkbox", "url"] as const;

const Body = z.object({
  name: z.string().min(1).max(80),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string().max(100)).optional(),
  required: z.boolean().optional(),
  showIn: z.array(z.enum(["table", "card", "form"])).optional(),
  roleVisibility: z.record(z.string(), z.enum(["hidden", "readonly", "editable"])).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const fields = await db.customField.findMany({ where: { projectId: id }, orderBy: { position: "asc" } });
  return ok({
    fields: fields.map((f) => ({
      id: f.id, name: f.name, fieldType: f.fieldType,
      options: JSON.parse(f.options), required: f.required,
      showIn: JSON.parse(f.showIn), roleVisibility: JSON.parse(f.roleVisibility),
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_fields");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Field name and type are required.");
  const count = await db.customField.count({ where: { projectId: id } });
  try {
    const field = await db.customField.create({
      data: {
        projectId: id, name: parsed.data.name.trim(), fieldType: parsed.data.fieldType,
        options: JSON.stringify(parsed.data.options ?? []),
        required: parsed.data.required ?? false,
        showIn: JSON.stringify(parsed.data.showIn ?? ["table", "card", "form"]),
        roleVisibility: JSON.stringify(parsed.data.roleVisibility ?? {}),
        position: count,
      },
    });
    publish(id, "fields_changed", {});
    return ok({ field }, 201);
  } catch {
    return fail(409, "conflict", "Custom field name already exists.");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_fields");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const fieldId = url.searchParams.get("fieldId");
  if (!fieldId) return fail(400, "validation", "fieldId required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.partial().safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid field patch.");
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.options !== undefined) data.options = JSON.stringify(parsed.data.options);
  if (parsed.data.showIn !== undefined) data.showIn = JSON.stringify(parsed.data.showIn);
  if (parsed.data.roleVisibility !== undefined) data.roleVisibility = JSON.stringify(parsed.data.roleVisibility);
  const n = await db.customField.updateMany({ where: { id: fieldId, projectId: id }, data });
  if (n.count === 0) return fail(404, "not_found", "Field not found.");
  publish(id, "fields_changed", {});
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_fields");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const fieldId = url.searchParams.get("fieldId");
  if (!fieldId) return fail(400, "validation", "fieldId required.");
  await db.customField.deleteMany({ where: { id: fieldId, projectId: id } });
  publish(id, "fields_changed", {});
  return ok({ deleted: true });
}
