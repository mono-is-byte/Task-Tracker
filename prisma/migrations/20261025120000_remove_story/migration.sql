-- PHASE 11.1: remove the retired `story` field rule and story references from
-- saved-view JSON so old rows can never break the role editor or saved views.
UPDATE "Role"
SET "fieldRules" = json_remove("fieldRules", '$.story')
WHERE json_valid("fieldRules") AND json_type("fieldRules", '$.story') IS NOT NULL;

UPDATE "SavedView"
SET "config" = json_remove("config", '$.fStory', '$.storyId', '$.filters.storyId', '$.filters.story')
WHERE json_valid("config");

UPDATE "SavedView"
SET "config" = json_set("config", '$.groupBy', 'none')
WHERE json_valid("config") AND json_extract("config", '$.groupBy') = 'story';

UPDATE "SavedView"
SET "config" = json_set("config", '$.fGroup', 'none')
WHERE json_valid("config") AND json_extract("config", '$.fGroup') = 'story';

UPDATE "SavedView"
SET "config" = json_set("config", '$.columns', (
  SELECT json_group_array(value) FROM json_each("SavedView"."config", '$.columns') WHERE value <> 'story'
))
WHERE json_valid("config")
  AND json_type("config", '$.columns') = 'array'
  AND EXISTS (SELECT 1 FROM json_each("SavedView"."config", '$.columns') WHERE value = 'story');

-- DropIndex
DROP INDEX "Story_projectId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Story";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "typeId" TEXT,
    "epicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storyPoints" REAL,
    "estHours" REAL,
    "rdTime" REAL NOT NULL DEFAULT 0,
    "loggedHours" REAL NOT NULL DEFAULT 0,
    "priorityId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" DATETIME,
    "testedById" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "dueAt" DATETIME,
    "startedAt" DATETIME,
    "stoppedAt" DATETIME,
    "overdueNotifiedAt" DATETIME,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "stageEnteredAt" DATETIME,
    "gitBranch" TEXT,
    "labels" TEXT NOT NULL DEFAULT '[]',
    "customValues" TEXT NOT NULL DEFAULT '{}',
    "position" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "IssueType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assignedAt", "assignedById", "assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "storyPoints", "testedById", "title", "totalSeconds", "typeId", "updatedAt") SELECT "assignedAt", "assignedById", "assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "storyPoints", "testedById", "title", "totalSeconds", "typeId", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_statusId_idx" ON "Task"("projectId", "statusId");
CREATE INDEX "Task_projectId_assigneeId_idx" ON "Task"("projectId", "assigneeId");
CREATE INDEX "Task_projectId_assignedById_idx" ON "Task"("projectId", "assignedById");
CREATE UNIQUE INDEX "Task_projectId_serial_key" ON "Task"("projectId", "serial");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
