-- Phase 3: project hide/unhide — hidden projects are excluded from default lists (home, sidebar).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;
