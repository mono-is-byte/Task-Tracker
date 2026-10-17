-- Task timer (Phase: Task Timer) — nullable columns, no backfill needed.
ALTER TABLE "Task" ADD COLUMN "scheduledStartAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "stoppedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "autoStarted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "dueNotifiedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "overdueNotifiedAt" DATETIME;
