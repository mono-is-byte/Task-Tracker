-- Change request (round 2).
--
-- Item 2 — the designation becomes a REFERENCE to a role: `User.designation`
-- now stores the Role id instead of a free-text job title. Existing free-text
-- values are matched (case-insensitively) against role names; anything that
-- matches no role is cleared so the dropdown shows it as "no designation".
UPDATE "User"
SET "designation" = (
  SELECT "Role"."id" FROM "Role" WHERE lower("Role"."name") = lower("User"."designation")
);

-- Item 4 — the raw issue-type key ("bug" etc.) was rendered next to the label
-- in exactly one place; it is now label-only everywhere, so the column goes.
ALTER TABLE "IssueType" DROP COLUMN "icon";

-- Item 5 — the one-off START timer role collapses into TRACK: every
-- time-tracked column now uses the manual Start/Stop flow.
UPDATE "Status" SET "timerRole" = 'TRACK' WHERE "timerRole" = 'START';

-- Item 5 — dead legacy timer columns (never read/written since the cumulative
-- timer landed; no indexes or foreign keys, plain DROP COLUMN).
ALTER TABLE "Task" DROP COLUMN "scheduledStartAt";
ALTER TABLE "Task" DROP COLUMN "autoStarted";
ALTER TABLE "Task" DROP COLUMN "dueNotifiedAt";

-- Item 2 — dead legacy designation catalog link on the user (its Prisma index
-- must go first; the column itself has no other dependants).
DROP INDEX IF EXISTS "User_designationId_idx";
ALTER TABLE "User" DROP COLUMN "designationId";

-- Item 1 — holidays are global for everyone: existing project-scoped holidays
-- become global, then the per-project column and its foreign key are removed
-- by rebuilding the table (the standard SQLite dance).
UPDATE "Holiday" SET "projectId" = NULL;
CREATE TABLE "new_Holiday" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" DATETIME NOT NULL,
  "name" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_Holiday" ("id", "date", "name")
  SELECT "id", "date", "name" FROM "Holiday";
DROP TABLE "Holiday";
ALTER TABLE "new_Holiday" RENAME TO "Holiday";
