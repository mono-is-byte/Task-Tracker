-- PHASE 4 backfill: existing tasks had no "assigned by" tracking.
--
-- 1) Verifiable history: when the most recent assignee change recorded in
--    Activity (field = 'assigneeId') matches the task's CURRENT assignee, copy
--    that change's actor + timestamp onto the task.
-- 2) Every remaining task that still has an assignee gets
--    assignedAt = createdAt (the best available evidence) and keeps
--    assignedById = NULL — the app has no creator/reporter column, and the UI
--    shows "—" rather than a fake name.
--
-- Idempotent: re-running produces the same values (empty scratch DBs used by
-- scripts/pretest.mjs have no rows, so this is a no-op there).

UPDATE "Task"
SET "assignedById" = (
      SELECT a."actorId" FROM "Activity" a
      WHERE a."taskId" = "Task"."id" AND a."field" = 'assigneeId'
      ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1
    ),
    "assignedAt" = (
      SELECT a."createdAt" FROM "Activity" a
      WHERE a."taskId" = "Task"."id" AND a."field" = 'assigneeId'
      ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1
    )
WHERE "assigneeId" IS NOT NULL
  AND (
    SELECT a."after" FROM "Activity" a
    WHERE a."taskId" = "Task"."id" AND a."field" = 'assigneeId'
    ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1
  ) = "assigneeId";

UPDATE "Task"
SET "assignedAt" = "createdAt"
WHERE "assigneeId" IS NOT NULL AND "assignedAt" IS NULL;
