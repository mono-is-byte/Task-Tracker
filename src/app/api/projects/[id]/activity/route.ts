import { ok, requireMember } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 200), 1000);
  const since = url.searchParams.get("since");
  const activities = await db.activity.findMany({
    where: {
      task: { projectId: id },
      ...(since ? { createdAt: { gte: new Date(since) } } : {}),
    },
    include: {
      task: { select: { id: true, serial: true, title: true, statusId: true, estHours: true, storyPoints: true } },
      actor: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  return ok({ activities, projectKey: project.key });
}
