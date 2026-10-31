# CLEANUP_REPORT — cleanup, migration & security audit

This file started as the conservative Phase 3 cleanup record (2026-10-24) and now also
holds the 2026-10-31 migration/backup/security audit. Scope: remove only items proven
unused by the codebase, keep every entry point, migration, script and documented option.
Every candidate below was checked with a repo-wide grep across `src/`, `scripts/`,
`prisma/`, `tests/`, `next.config.ts`, `vercel.json` and the docs. "Refs" = number of real
code references found.

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
`INSERT … SELECT` every surviving column, so **kept task data is preserved**).

## Kept (investigated, but used or intentional)

| Item | Why kept |
|------|----------|
| `Priority.level` | Actively used everywhere (settings UI, lookups API, sorting, dashboard). This is the "level-like" column the brief warned about — it is NOT dead. |
| `Task.overdueNotifiedAt`, `Task.gitBranch`, `Task.labels`, `Task.customValues` | All referenced (timer sweep, search/export, labels, custom fields). |
| `WorkingDayException`, `Holiday`, `SavedView`, `AutomationRule`, `Notification`, `CustomField`, `TaskStageTime`, `TaskLink`, `PasswordReset`, `LoginAttempt` | Every model has a live delegate/route; the `db.<model>` scan shows non-zero usage for all of them. |
| All npm dependencies | `@libsql/client`, `@prisma/adapter-*`, `bcryptjs`, `better-sqlite3`, `dotenv`, `jspdf`, `next`, `react`, `react-dom`, `xlsx`, `zod` — each ≥1 real import. None removed. |
| `console.error` sites (`error.tsx`, `global-error.tsx`, `api.ts`, `instrumentation.ts`) | Error boundaries / unhandled-route logging. Intentional. |
| `console.log` in `api/auth/forgot` | Intentional but **gated**: by default it logs a request line (including the account email) but **not** the raw token; the token is printed only when `AUTH_LOG_RESET_TOKEN=1` (local debugging). Never enable it in production. |
| `SMTP_FROM` | Unused by the build but **explicitly documented as such** in README (`not read by the current build`). Left in place to avoid contradicting the docs; flagged here for a future decision. |
| Migration history, `prisma/seed.ts`, `admin:create`, `turso:migrate`, `turso:backup`, `turso:copy-local`, `db-push`, `scripts/pretest.mjs`, `instrumentation.ts`, `next.config.ts`, `vercel.json` | Explicitly out of scope (protected). |
| Unused-file scan (src `*.ts`/`*.tsx`) | Zero dead application files — every non-entry file is imported; the only "unreferenced" hits were Next.js entry points (routes, layouts, `loading.tsx`, `instrumentation.ts`). |

## Needs user confirmation

- `SMTP_FROM`: keep as a documented-but-unused placeholder, or delete it and its
  README row? (Left in place for now.)

## Story feature removed (2026-10-25) — can be re-added later

- Removed the `Story` model, `Task.storyId`, `Epic.stories`, the Story API, UI,
  import/export and tests. Migration: `20261025120000_remove_story`.
- Story Points were removed too: `Task.storyPoints`, `Project.pointScale`,
  `FIBONACCI` / `isFibonacci`, `capacityReport.plannedPoints` and PDF points.
  Migration: `20261025121000_remove_story_points`.
- "Story" remains available as an **issue type** (Task / Story / Bug / Epic / Sub-task).
- Data retained: `backup/stories-export.json` (7 stories, 10 linked tasks).
- To re-add Story later: restore the model/relations/API/UI/import/export/tests and add a
  **new** migration — never edit the applied ones (production already has both).

## Migration & backup safety

- Production Turso is **fully migrated as of 2026-10-31** (23/23, including
  `Comment.solvedAt`); `npm run turso:migrate` was a verified no-op, so no production
  write was made during the audit.
- Before any future migration: `npm run turso:backup` (read-only snapshot under
  `backup/`, row counts + foreign-key check) and verify the file. Restore only if a
  migration fails.
- The migration chain is **append-only** and shared with production: never edit an
  applied migration, always add a new folder. Keep every migration valid on both
  `better-sqlite3` and libSQL/Turso.
- `backup/` is git-ignored and excluded from `tsconfig.json`. Snapshots contain personal
  data (emails, bcrypt password hashes, avatars): keep them local/encrypted, never
  commit or upload them, and delete them when no longer needed.

## Security & exposure audit (2026-10-31)

| Area | Finding / action |
|------|------------------|
| Reset tokens | No longer logged by default. `AUTH_LOG_RESET_TOKEN=1` is the explicit local-debug opt-in (documented in `.env.example`); a leaked token is a working password reset. |
| Forgot-password abuse | `/api/auth/forgot` is rate-limited in-process: 5 requests per identifier + 20 per IP per 15 minutes, with the same generic response when limited (no account enumeration). |
| Secret exposure | 210 tracked files; **no** `.env`, `dev.db`, `backup/` or `public/uploads/` tracked; no real credential values in the working tree or GitHub history. |
| GitHub | Repository `mono-is-byte/Task-Tracker` is **public (source only)**, one branch (`main`), no tags; history never contained `.env` / `dev.db`. |
| Live deployment | `/.env`, `/dev.db`, `/.git/config` → **404**; unauthenticated `/api/auth/me` and `/api/users` → **401**. |
| Backups | `backup/turso-2026-10-31T03-19-25.db` (1.86 MB, 28 tables, 0 FK violations) is sensitive: emails, bcrypt hashes, avatars. Local only, git-ignored. |
| Verification | `tsc --noEmit` clean; `npm test` **256/256 (19 files)**. `npm run build` fails in this environment only on the Google Fonts fetch (network), not on code. |

Remaining risks / follow-ups:

- The rate limiter is **in-process** — per-instance on serverless, best-effort rather than
  a global quota (same model as SSE).
- `clientIp()` trusts the first `x-forwarded-for` value. Vercel overwrites it; a
  self-hosted reverse proxy must do the same or the login/forgot limits can be spoofed.
- Change the demo `admin` password and deactivate demo accounts in production.
- The current tree is **uncommitted/unpushed**; the live site still runs the 2026-10-25
  build. Deploying is the owner's step (no `git`/Vercel CLI in this environment).
- Slow-load / realtime status-refresh work is paused by the owner — do not resume it
  without a new request.
