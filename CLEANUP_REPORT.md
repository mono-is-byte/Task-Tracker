# CLEANUP_REPORT â€” Phase 3 (conservative, evidence-based)

Scope: remove only items proven unused by the codebase, keep every entry point,
migration, script and documented option. Every candidate below was checked with a
repo-wide grep across `src/`, `scripts/`, `prisma/`, `tests/`, `next.config.ts`,
`vercel.json` and the docs. "Refs" = number of real code references found.

## Removed

| # | Item | Kind | Evidence (refs) | Risk | Decision |
|---|------|------|-----------------|------|----------|
| 1 | `Sprint` model (+ `Sprint_projectId_key_key` index) | DB table | 0 references in `src/`; seed only listed it in a tolerant dynamic wipe list | Low - no route, no UI, no query ever touched it; the table was empty in the local DB | **Removed** |
| 2 | `Project.sprints` relation | DB relation | tied to #1 | Low | **Removed** |
| 3 | `Story.sprintId` + `Story.sprint` | DB column/FK | tied to #1 | Low | **Removed** |
| 4 | `Task.sprintId` + `Task.sprint` + `@@index([projectId, sprintId])` | DB column/FK/index | tied to #1 | Low | **Removed** |
| 5 | `getAllowedTransitions()` in `src/lib/permissions.ts` | dead code | 1 ref (its own definition); `isTransitionAllowed` is still used by tests, so only the async wrapper went | Low | **Removed** |
| 6 | `SESSION_SECRET` env var | docs/config | 0 references in `src/`; only `.env.example` + `README.md` | Low | **Removed** from `.env.example` and all README mentions; text reworded (sessions are opaque hashed tokens, no signing secret needed) |
| 7 | `"Sprint"` entry in `prisma/seed.ts` wipe list | dead entry | n/a (the seed looks delegates up dynamically) | Low | **Removed** with the model |

Migration: `20261024182738_drop_legacy_sprint_model` (SQLite table rebuilds that
`INSERT â€¦ SELECT` every surviving column, so **kept task/story data is preserved**).

## Kept (investigated, but used or intentional)

| Item | Why kept |
|------|----------|
| `Priority.level` | Actively used everywhere (settings UI, lookups API, sorting, dashboard). This is the "level-like" column the brief warned about â€” it is NOT dead. |
| `Story.status`, `Story.position` | Read/written by `src/app/api/projects/[id]/stories/route.ts` and used for ordering. |
| `Task.overdueNotifiedAt`, `Task.gitBranch`, `Task.labels`, `Task.customValues` | All referenced (timer sweep, search/export, labels, custom fields). |
| `WorkingDayException`, `Holiday`, `SavedView`, `AutomationRule`, `Notification`, `CustomField`, `TaskStageTime`, `TaskLink`, `PasswordReset`, `LoginAttempt` | Every model has a live delegate/route; the `db.<model>` scan shows non-zero usage for all of them. |
| All npm dependencies | `@libsql/client`, `@prisma/adapter-*`, `bcryptjs`, `better-sqlite3`, `dotenv`, `jspdf`, `next`, `react`, `react-dom`, `xlsx`, `zod` â€” each â‰¥1 real import. None removed. |
| `console.error` sites (`error.tsx`, `global-error.tsx`, `api.ts`, `instrumentation.ts`) | Error boundaries / unhandled-route logging. Intentional. |
| `console.log` in `api/auth/forgot` | Intentional: this deployment logs reset tokens (no mail transport). Documented in README. |
| `SMTP_FROM` | Unused by the build but **explicitly documented as such** in README (`not read by the current build`). Left in place to avoid contradicting the docs; flagged here for a future decision. |
| Migration history, `prisma/seed.ts`, `admin:create`, `turso:migrate`, `turso:copy-local`, `db-push`, `scripts/pretest.mjs`, `instrumentation.ts`, `next.config.ts`, `vercel.json` | Explicitly out of scope (protected). |
| Unused-file scan (src `*.ts`/`*.tsx`) | Zero dead application files â€” every non-entry file is imported; the only "unreferenced" hits were Next.js entry points (routes, layouts, `loading.tsx`, `instrumentation.ts`). |

## Needs user confirmation

- `SMTP_FROM`: keep as a documented-but-unused placeholder, or delete it and its
  README row? (Left in place for now.)
- `Story.status` / `Story.position`: genuinely used today, but only by the Stories
  API â€” confirm the Stories feature itself is still wanted before any deeper cut.

## Story feature removed (2026-10-25) - will re-add later
- Removed Story model, Task.storyId, Epic.stories, Story API, UI, import/export, tests.
- Migration: 20261025120000_remove_story.
- Data retained: backup/stories-export.json (7 stories, 10 linked tasks).
- To re-add Story later: restore Story model, Task.storyId, Epic.stories, API routes, UI, import/export, tests; reapply migration in reverse or new migration.
- Story Points also removed: Task.storyPoints, Project.pointScale, FIBONACCI/isFibonacci, capacityReport.plannedPoints, PDF points. Migration: 20261025121000_remove_story_points.
