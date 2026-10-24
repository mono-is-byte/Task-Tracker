-- Phase 1: Role = designation + real workflow enforcement (data migration).
--
-- 1. StatusDesignationTag moves from free text to Role ids. Rows whose text
--    matches an existing role name (case/space-insensitive) are kept; the rest
--    are dropped because a suggestion that is not a real role can never match a
--    member's roles. This preserves every meaningful row.
-- 2. Project Manager gets the explicit `bypass_transitions` permission flag.
--    Workflow bypass is no longer derived from `manage_workflow` / role names.
-- 3. One-time repair: a user's primary designation must be one of the project
--    roles they actually hold. Users with memberships but a stale designation
--    (e.g. "Developer" after being assigned "IT Support Executive") are moved to
--    their first held role. Users with no memberships are left untouched.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_StatusDesignationTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusDesignationTag_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusDesignationTag_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "new_StatusDesignationTag" ("id", "statusId", "roleId", "createdAt")
SELECT t."id", t."statusId", r."id", t."createdAt"
FROM "StatusDesignationTag" t
JOIN "Role" r ON lower(trim(r."name")) = lower(trim(t."text"));

DROP TABLE "StatusDesignationTag";
ALTER TABLE "new_StatusDesignationTag" RENAME TO "StatusDesignationTag";

CREATE INDEX "StatusDesignationTag_roleId_idx" ON "StatusDesignationTag"("roleId");
CREATE UNIQUE INDEX "StatusDesignationTag_statusId_roleId_key" ON "StatusDesignationTag"("statusId", "roleId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 2. Explicit transition bypass, set only for the Project Manager role.
UPDATE "Role"
SET "permissions" = json_set("permissions", '$.bypass_transitions', json('true'))
WHERE lower(trim("name")) = lower('Project Manager');

-- 3. Repair stale designations from the real project roles.
UPDATE "User"
SET "designation" = (
  SELECT pc."roleId"
  FROM "ProjectMemberRole" pc
  JOIN "ProjectMember" p ON p."id" = pc."memberId"
  JOIN "Role" r ON r."id" = pc."roleId"
  WHERE p."userId" = "User"."id"
  ORDER BY r."name" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "ProjectMemberRole" pc
  JOIN "ProjectMember" p ON p."id" = pc."memberId"
  WHERE p."userId" = "User"."id"
)
AND (
  "designation" IS NULL
  OR "designation" NOT IN (
    SELECT pc."roleId"
    FROM "ProjectMemberRole" pc
    JOIN "ProjectMember" p ON p."id" = pc."memberId"
    WHERE p."userId" = "User"."id"
  )
);
