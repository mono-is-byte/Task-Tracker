-- Phase 2: Status → Designation mapping (suggestion list for the status-change "Assign to" step).

-- CreateTable
CREATE TABLE "StatusDesignation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusId" TEXT NOT NULL,
    "designationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusDesignation_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusDesignation_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StatusDesignation_statusId_designationId_key" ON "StatusDesignation"("statusId", "designationId");
CREATE INDEX "StatusDesignation_designationId_idx" ON "StatusDesignation"("designationId");
