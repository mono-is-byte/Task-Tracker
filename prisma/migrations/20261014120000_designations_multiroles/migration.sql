-- Phase 1: Designations + many-to-many project-member roles.

-- CreateTable: Designation (a job-title label only; grants no permissions)
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "suggestedRole" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable: User gains a nullable designation reference
ALTER TABLE "User" ADD COLUMN "designationId" TEXT;

-- CreateTable: join table replacing the single ProjectMember.roleId
CREATE TABLE "ProjectMemberRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMemberRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProjectMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copy existing single-role assignments into the join table (data migration)
INSERT INTO "ProjectMemberRole" ("id", "memberId", "roleId", "createdAt")
SELECT lower(hex(randomblob(12))), "id", "roleId", CURRENT_TIMESTAMP
FROM "ProjectMember";

-- Rebuild ProjectMember without roleId (SQLite requires a table rewrite)
CREATE TABLE "ProjectMember_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "ProjectMember_new" ("id", "projectId", "userId", "createdAt")
SELECT "id", "projectId", "userId", "createdAt" FROM "ProjectMember";
DROP TABLE "ProjectMember";
ALTER TABLE "ProjectMember_new" RENAME TO "ProjectMember";

-- Recreate indexes that were dropped with the old table
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");
CREATE UNIQUE INDEX "ProjectMemberRole_memberId_roleId_key" ON "ProjectMemberRole"("memberId", "roleId");
CREATE INDEX "ProjectMemberRole_roleId_idx" ON "ProjectMemberRole"("roleId");
CREATE INDEX "User_designationId_idx" ON "User"("designationId");
