-- Change request Step 1: the Designation catalog becomes free text.
-- User.designation holds the old catalog name for every user that had one;
-- the Designation table itself is kept (no destructive migration).

ALTER TABLE "User" ADD COLUMN "designation" TEXT;

UPDATE "User"
SET "designation" = (SELECT "name" FROM "Designation" WHERE "Designation"."id" = "User"."designationId")
WHERE "designationId" IS NOT NULL;

-- Status -> designation suggestion mapping is now free text too.
CREATE TABLE "StatusDesignationTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusDesignationTag_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StatusDesignationTag_statusId_text_key" ON "StatusDesignationTag"("statusId", "text");

-- Carry the old id-based mapping over as free text.
INSERT INTO "StatusDesignationTag" ("id", "statusId", "text", "createdAt")
SELECT 'sdt' || lower(hex(randomblob(12))), "StatusDesignation"."statusId", "Designation"."name", CURRENT_TIMESTAMP
FROM "StatusDesignation"
JOIN "Designation" ON "Designation"."id" = "StatusDesignation"."designationId";
