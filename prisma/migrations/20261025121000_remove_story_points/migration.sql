-- PHASE 11.1 follow-up: story points are removed from the product. Drop the
-- retired field rule so old role JSON stays harmless.
UPDATE "Role"
SET "fieldRules" = json_remove("fieldRules", '$.storyPoints')
WHERE json_valid("fieldRules") AND json_type("fieldRules", '$.storyPoints') IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hoursPerDay" REAL NOT NULL DEFAULT 8,
    "workingDays" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "bannerNote" TEXT,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("bannerNote", "createdAt", "description", "hoursPerDay", "id", "isCompleted", "isHidden", "key", "name", "settings", "updatedAt", "workingDays") SELECT "bannerNote", "createdAt", "description", "hoursPerDay", "id", "isCompleted", "isHidden", "key", "name", "settings", "updatedAt", "workingDays" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "typeId" TEXT,
    "epicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
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
INSERT INTO "new_Task" ("assignedAt", "assignedById", "assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "testedById", "title", "totalSeconds", "typeId", "updatedAt") SELECT "assignedAt", "assignedById", "assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "testedById", "title", "totalSeconds", "typeId", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_statusId_idx" ON "Task"("projectId", "statusId");
CREATE INDEX "Task_projectId_assigneeId_idx" ON "Task"("projectId", "assigneeId");
CREATE INDEX "Task_projectId_assignedById_idx" ON "Task"("projectId", "assignedById");
CREATE UNIQUE INDEX "Task_projectId_serial_key" ON "Task"("projectId", "serial");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
