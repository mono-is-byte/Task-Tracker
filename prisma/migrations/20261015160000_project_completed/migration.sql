-- Change request Phase 2: a project is "completed" when it has >= 1 task and every
-- task sits in a final (category "done") status. Drives the sidebar's Completed
-- Projects section; 0 tasks never counts as completed.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing projects whose tasks are all done start out completed.
UPDATE "Project" SET "isCompleted" = 1
WHERE EXISTS (SELECT 1 FROM "Task" WHERE "Task"."projectId" = "Project"."id")
  AND NOT EXISTS (
    SELECT 1 FROM "Task" JOIN "Status" ON "Task"."statusId" = "Status"."id"
    WHERE "Task"."projectId" = "Project"."id" AND "Status"."category" <> 'done'
  );
