-- Change request Step 4: cumulative stage timer.
-- Status.timerRole: NONE (pause stage — the initial "To Do" and "Re-open"),
-- START (the one stage with the Start button — "In Progress"), TRACK (other
-- intermediates — counting continues), FINAL (Done — stops and freezes the total).

ALTER TABLE "Status" ADD COLUMN "timerRole" TEXT NOT NULL DEFAULT 'TRACK';

-- Legacy layout mapping: first column and reopen-like names pause, the
-- "In Progress" column starts, every done-category column finishes.
UPDATE "Status" SET "timerRole" = 'NONE' WHERE "position" = 0;
UPDATE "Status" SET "timerRole" = 'NONE' WHERE lower(replace(replace("name", '-', ''), ' ', '')) IN ('reopen', 'todo', 'tobedone', 'backlog');
UPDATE "Status" SET "timerRole" = 'START' WHERE lower("name") = 'in progress';
UPDATE "Status" SET "timerRole" = 'FINAL' WHERE "category" = 'done';

ALTER TABLE "Task" ADD COLUMN "totalSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "stageEnteredAt" DATETIME;

-- Best-effort carry-over of legacy timers (SQLite julianday returns days).
UPDATE "Task"
SET "totalSeconds" = CAST((julianday("stoppedAt") - julianday("startedAt")) * 86400 AS INTEGER)
WHERE "startedAt" IS NOT NULL AND "stoppedAt" IS NOT NULL AND "stoppedAt" > "startedAt";
UPDATE "Task" SET "stageEnteredAt" = "startedAt" WHERE "startedAt" IS NOT NULL AND "stoppedAt" IS NULL;

CREATE TABLE "TaskStageTime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "enteredAt" DATETIME NOT NULL,
    "leftAt" DATETIME,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TaskStageTime_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskStageTime_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TaskStageTime_taskId_idx" ON "TaskStageTime"("taskId");
