# TaskTracker

Self-hosted, multi-user task tracker (lightweight Jira replacement): Kanban + table + timeline + calendar,
workload, reports, per-project roles & field-level permissions, custom workflows and automation.

Stack: **Next.js 16 (App Router) + Prisma 7 + SQLite (better-sqlite3)** — zero-config local run.
The schema uses only portable types; switching to Postgres later means changing the Prisma provider,
setting `DATABASE_URL`, and running `prisma migrate deploy`.

## Quick start (Windows PowerShell)

```powershell
# 1. install
npm install

# 2. env
Copy-Item .env.example .env -Force
# then edit .env: set a long random SESSION_SECRET

# 3. database + seed demo data
npx prisma migrate dev
npx tsx prisma/seed.ts --reset

# 4. run
npm run dev        # http://localhost:3000
```

Production:

```powershell
npm run build
npm start          # reads .env, http://localhost:3000 (set PORT=xxxx to change)
```

## Environment

| Var | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | yes | `file:./dev.db` for SQLite; `postgresql://…` after switching provider |
| `SESSION_SECRET` | yes | long random string (used for any future signed tokens; sessions are opaque) |
| `APP_URL` | no | base URL, enables `Secure` cookies when `https://` |
| `SMTP_URL` / `SMTP_FROM` | no | if set, forgot-password issues emailed reset links; if unset, resets are admin-triggered |

Never commit `.env`. See `.env.example`.

## Seeded logins (demo password for all: `Demo1234!`)

You must change the password on first login (enforced).

| Login (email or username) | Name | Access |
|---|---|---|
| `admin` | Administrator | Super Admin (everything) |
| `pm` | Farhana Karim | Project Manager in all projects |
| `saju` | Md. Saju Ahmed | Developer |
| `shovon` | Md. Muktaruzzaman Shovon | Developer |
| `sumit` | Sumit Chandra Shovan | QA / Tester |
| `apon` | Tazbir Mahmud Apon | QA / Tester |
| `viewer` | Rahim Uddin | Viewer / Stakeholder (read-only) |

Seeded projects: **MAP** (Map Integration), **LVM** (Letter View Management), **NM** (Net Metering),
with epics, ~20 tasks with mixed statuses, Bangla user stories, and hours-only tasks.

## Managing users & roles

- **Users page** (sidebar; visible to Admin/PM): create users (a temp password is shown once — pass it
  to the user; they must change it on first login), edit profiles/designations, upload avatars
  (.jpg/.jpeg ≤ 2 MB), manage project memberships. Delete is a soft delete — tasks are unassigned,
  history is kept. Admin-only: deactivate, Super Admin toggle, password reset.
- **Users → Designations**: manage the designation catalog (Admin). A designation never grants roles;
  the members modal only shows a suggested role hint.
- **Project → Members**: add users to a project with a role (a user can be Developer in one
  project and Viewer in another).
- **Admin → Roles & Permissions**: edit the role × action matrix and per-field hidden/readonly/editable
  rules. System roles can't be deleted, but everything about them is editable.
- **Admin → Audit Log**: logins, failed logins, lockouts, role/permission changes, resets.

No public sign-up exists by design.

## Key concepts

- **Task key** = `{PROJECT}-{serial}` (e.g. `MAP-12`).
- **Est. Days is always calculated** (`Est. Hours ÷ hours-per-day`), never typed. Hours/day defaults to 8,
  configurable per project (Settings) and per user (Profile → capacity override).
- **Archive is a filtered view** of Done tasks, not a second table; re-open moves tasks back out.
- **Permissions are enforced server-side** on every endpoint (401/403 + friendly no-access page);
  the UI only hides/disables. QA can move status without edit rights (status-only change rule).
- **Automation** (editable in Settings): Done stamps End=today; In Progress stamps Start=today when empty;
  In Testing notifies Tested By; Re-open notifies Assignee and clears End Date.
- **Realtime**: SSE at `/api/projects/:id/events` with 15s polling fallback.
- Shortcuts: `/` focuses table search, `Esc` closes the task drawer.
- Bangla: UTF-8 end-to-end, NFC-normalized search, Noto Sans Bengali font, EN/বাং UI toggle.

## Excel import/export

Table view → ⬇ CSV / ⬇ XLSX exports use the exact Excel column names
(`SL, Epic, User Story, Task title, Story Points, Est. Hours, Est. Days, …`).
⬆ Import accepts your current sheet: `SL`/`Est. Days` are ignored (auto serial / calculated),
unknown Epic/Status/Priority/member names are reported per row instead of guessed,
missing User Stories are created, `Dependency` accepts `PREFIX-N` keys.

## Tests

```powershell
npm test            # vitest: 120 tests (domain, permissions, auth/service on scratch DBs)
```

Scratch DBs (`tests/test-*.db`) are built from the committed migration SQL by `scripts/pretest.mjs`
— the dev database is never touched. Service tests cover: login/logout, lockout + admin unlock,
session absolute/idle expiry, role × action enforcement, field-level rules, Fibonacci validation,
Est. Days math, transitions per role, automation end-date stamp, derived archive, capacity math,
sprint carry-over, Bangla search.

## Notes / known gaps

- Mail is log-only: with `SMTP_URL` set, reset tokens are printed to the server log for the operator
  to deliver (no mailer bundled — plug in your SMTP relay UI of choice).
- Realtime is in-process pub/sub (fine for single-instance self-hosting; use sticky sessions if
  you run multiple instances behind a proxy).
- File uploads for avatars are URL-only (no local file storage yet); XLSX import caps at 2000 rows/run.
- `middleware.ts` was intentionally avoided (deprecated in Next 16 in favour of `proxy.ts`);
  auth gating lives in the app layout + API layer, security headers in `next.config.ts`.
