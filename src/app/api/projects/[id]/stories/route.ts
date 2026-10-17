import { z } from "zod";
import { fail, ok, readJson, requireMember } from "@/lib/api";
import { db } from "@/lib/db";

const StoryBody = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20000).nullable().optional(),
  epicId: z.string().nullable().optional(),
  status: z.string().max(20).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const stories = await db.story.findMany({
    where: { projectId: id },
    include: {
      epic: { select: { id: true, name: true, color: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { position: "asc" },
  });
  return ok({ stories });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = StoryBody.safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Story title is required.");
  const count = await db.story.count({ where: { projectId: id } });
  const story = await db.story.create({
    data: {
      projectId: id, title: parsed.data.title.trim(),
      description: parsed.data.description ?? null,
      epicId: parsed.data.epicId ?? null,
      status: parsed.data.status ?? "open", position: count,
    },
  });
  return ok({ story }, 201);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const storyId = url.searchParams.get("storyId");
  if (!storyId) return fail(400, "validation", "storyId query param required.");
  const { value, error } = await readJson(req);
  if (error) return error;
  const parsed = StoryBody.partial().safeParse(value);
  if (!parsed.success) return fail(400, "validation", "Invalid story fields.");
  const n = await db.story.updateMany({ where: { id: storyId, projectId: id }, data: parsed.data });
  if (n.count === 0) return fail(404, "not_found", "Story not found.");
  return ok({ updated: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "manage_epics");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const storyId = url.searchParams.get("storyId");
  if (!storyId) return fail(400, "validation", "storyId query param required.");
  await db.task.updateMany({ where: { storyId, projectId: id }, data: { storyId: null } });
  await db.story.deleteMany({ where: { id: storyId, projectId: id } });
  return ok({ deleted: true });
}
