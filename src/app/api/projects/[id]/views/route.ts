import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || undefined;
  const views = await db.savedView.findMany({
    where: { projectId: id, userId: auth.user.id, ...(scope ? { scope } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    views: views.map((v) => ({ id: v.id, name: v.name, scope: v.scope, config: JSON.parse(v.config) })),
  });
}

const Body = z.object({
  name: z.string().min(1).max(80),
  scope: z.string().max(20).optional(),
  config: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = Body.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Name and config required.");
  const view = await db.savedView.create({
    data: {
      projectId: id, userId: auth.user.id,
      name: parsed.data.name.trim(), scope: parsed.data.scope ?? "table",
      config: JSON.stringify(parsed.data.config),
    },
  });
  return ok({ view: { id: view.id, name: view.name } }, 201);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const viewId = url.searchParams.get("viewId");
  if (!viewId) return fail(400, "validation", "viewId required.");
  await db.savedView.deleteMany({ where: { id: viewId, projectId: id, userId: auth.user.id } });
  return ok({ deleted: true });
}
