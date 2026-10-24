/*
  Warnings:

  - You are about to drop the `Sprint` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `sprintId` on the `Story` table. All the data in the column will be lost.
  - You are about to drop the column `sprintId` on the `Task` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Sprint_projectId_key_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Sprint";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "epicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Story_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Story_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Story" ("description", "epicId", "id", "position", "projectId", "status", "title") SELECT "description", "epicId", "id", "position", "projectId", "status", "title" FROM "Story";
DROP TABLE "Story";
ALTER TABLE "new_Story" RENAME TO "Story";
CREATE INDEX "Story_projectId_idx" ON "Story"("projectId");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "typeId" TEXT,
    "storyId" TEXT,
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
    CONSTRAINT "Task_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "storyId", "storyPoints", "testedById", "title", "totalSeconds", "typeId", "updatedAt") SELECT "assigneeId", "createdAt", "customValues", "description", "dueAt", "endDate", "epicId", "estHours", "gitBranch", "id", "labels", "loggedHours", "overdueNotifiedAt", "position", "priorityId", "projectId", "rdTime", "serial", "stageEnteredAt", "startDate", "startedAt", "statusId", "stoppedAt", "storyId", "storyPoints", "testedById", "title", "totalSeconds", "typeId", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_statusId_idx" ON "Task"("projectId", "statusId");
CREATE INDEX "Task_projectId_assigneeId_idx" ON "Task"("projectId", "assigneeId");
CREATE UNIQUE INDEX "Task_projectId_serial_key" ON "Task"("projectId", "serial");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
