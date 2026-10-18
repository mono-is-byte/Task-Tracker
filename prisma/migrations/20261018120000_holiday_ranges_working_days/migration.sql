-- Holiday date ranges + working-day exceptions (Change request: Calendar).
--
-- Additive and data-preserving: every existing Holiday row stays exactly as it
-- is and keeps behaving as a single-day holiday (endDate stays NULL).
--
--   * Holiday.endDate      - last day of the range (inclusive); NULL = one day
--   * Holiday.description  - optional free text
--   * Holiday.type         - optional label: public | festival | office | other
--   * WorkingDayException  - the office is open on that date even if it is a
--                            weekly holiday (Fri/Sat) or a configured holiday.
--                            The Holiday row itself is never modified, so
--                            removing an exception restores the holiday status.

ALTER TABLE "Holiday" ADD COLUMN "endDate" DATETIME;
ALTER TABLE "Holiday" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Holiday" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'public';

CREATE TABLE "WorkingDayException" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "WorkingDayException_date_key" ON "WorkingDayException"("date");
