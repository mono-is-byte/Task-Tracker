import { ok, requireUser } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const notifications = await db.notification.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return ok({ notifications, unread: notifications.filter((n) => !n.read).length });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  await db.notification.updateMany({ where: { userId: auth.user.id, read: false }, data: { read: true } });
  return ok({ read: true });
}
