-- Phase 1 data migration: task creation is PM/Admin only.
-- Existing databases were seeded when Developer also had create_task: true.
-- This aligns system roles with the new rule (only Project Manager keeps create_task).
-- json_remove is a no-op when the key is absent, so this is idempotent/safe.

UPDATE "Role"
SET "permissions" = json_remove("permissions", '$.create_task')
WHERE "isSystem" = true
  AND "name" = 'Developer'
  AND json_extract("permissions", '$.create_task') IS NOT NULL;

UPDATE "Role"
SET "permissions" = json_remove("permissions", '$.create_task')
WHERE "isSystem" = true
  AND "name" IN ('QA / Tester', 'Viewer / Stakeholder')
  AND json_extract("permissions", '$.create_task') IS NOT NULL;
