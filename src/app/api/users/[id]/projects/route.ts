import { fail, ok, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { userProjectsSummary } from "@/lib/users";

/**
 * Step 2: the per-user project lists behind the Users page "View projects"
 * modal. `assigned` = projects with at least one task not in a final status,
 * `solved` = projects with at least one final (done) task; a project can be in
 * both. Admin/PM may view any user (a PM is scoped to their own projects),
 * a normal user only themselves — enforced in userProjectsSummary.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const result = await userProjectsSummary(
    db,
    { id: auth.user.id, isSuperAdmin: auth.user.isSuperAdmin },
    id,
  );
  if (!result.ok) return fail(result.status, "rejected", result.error);
  return ok({ assigned: result.assigned, solved: result.solved });
}
