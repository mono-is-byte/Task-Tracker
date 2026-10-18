-- Optimization audit: drop legacy designation structures.
--
-- Designation + StatusDesignation: zero references in application code,
-- tests, scripts or seed — the only remaining links were the Prisma
-- relations between these two tables and Status. Their rows were already
-- copied into StatusDesignationTag by migration 20261015190000 (free-text
-- designation suggestions), which is the live model used by the workflow
-- API, the Assign step and the tests. No migration or seed ever inserted
-- rows into these two tables, so every database created through
-- migrations has them empty.
DROP TABLE "StatusDesignation";
DROP TABLE "Designation";

-- User.locale / User.notifyPrefs: each written exactly once (signup /
-- profile update) and never read by any API, UI, report or background
-- job — the app has no i18n and no per-user notification toggles, so the
-- features these columns were added for never landed. Same class as the
-- earlier dead-column drops (designationId, scheduledStartAt,
-- autoStarted, dueNotifiedAt, IssueType.icon, Holiday.projectId).
ALTER TABLE "User" DROP COLUMN "locale";
ALTER TABLE "User" DROP COLUMN "notifyPrefs";
