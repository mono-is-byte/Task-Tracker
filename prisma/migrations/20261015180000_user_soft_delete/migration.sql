-- Change request Phase 4: soft delete for users. A deleted user keeps their
-- comments and activity history, but cannot log in, is unassigned from all
-- tasks and loses every project membership. Nullable, no backfill needed.
ALTER TABLE "User" ADD COLUMN "deletedAt" DATETIME;