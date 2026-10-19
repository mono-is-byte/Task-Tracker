# TaskTracker

A self-hosted, multi-user task tracker - a lightweight project management tool for small teams.
Kanban boards, an inline-editable table, timeline, workload, calendar and reports, with
per-project roles, field-level permissions, custom workflows and automation.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/tests-197_passing-2ea44f?logo=vitest&logoColor=white)](./tests)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.9-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone & install](#1-clone--install)
  - [2. Configure environment](#2-configure-environment)
  - [3. Set up the database](#3-set-up-the-database)
  - [4. Run the dev server](#4-run-the-dev-server)
  - [Demo data & first login](#demo-data--first-login)
- [Environment Variables](#environment-variables)
- [Running in Production](#running-in-production)
- [Usage](#usage)
  - [Roles at a glance](#roles-at-a-glance)
  - [Key concepts](#key-concepts)
  - [Keyboard shortcuts](#keyboard-shortcuts)
- [Excel Import / Export](#excel-import--export)
- [Testing](#testing)
- [Developer Scripts](#developer-scripts)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

TaskTracker is a single-tenant project and issue tracker intended to be run by a team on
its own infrastructure. It keeps the workflows teams actually need — configurable
statuses, per-project roles, field-level permissions, time tracking and reporting — without
the weight of an enterprise suite.

The app is built on **Next.js 16 (App Router) + Prisma 7 + SQLite (via `better-sqlite3`)**,
so a fresh clone runs with **zero external services**: no database server, no Docker, no
cloud account. The Prisma schema uses only portable types, so a PostgreSQL move is
mainly a datasource-provider change — note the committed migrations are SQLite SQL and
would be regenerated for the new database.

> **Status:** actively developed — 197 automated tests, full server-side permission
> enforcement, and light/dark theming.

---

## Features

### 🗂️ Tasks & work management
- **Board (Kanban)** with drag-and-drop status changes and per-column quick-add.
- **Table view** with inline editing, resizable columns, filters and a task drawer; row
  deletion goes through a confirmation dialog, and the hidden-column + width layout is
  remembered on the device per project (survives reloads).
- **One task store per project** — the Board, Table, Timeline and drawer read and write the
  same rows (optimistic updates, rollback on failure, SSE refresh), so a change in one view
  appears in the others immediately and no duplicate tasks are created.
- **Task drawer** for comments, activity history, links (`blocks` / `relates`), labels,
  custom fields and Git branch.
- **Task Timer** per stage: statuses define a timer role (`NONE` / `TRACK` / `FINAL`) so a
  running segment can be started and stopped, auto-stops when the task moves on, and shows
  total time once the task is Done.
- **Epics, stories** and structured task types (Task / Story / Bug / Epic / Sub-task).
- **Priorities & issue types** are managed per project in Settings — create, edit
  (name / level / colour) and delete with duplicate checks; deleting an option that tasks
  still use asks for a replacement and moves those tasks over, so nothing is left pointing
  at a removed option.

### 📊 Views & reporting
- **Dashboard** with KPI cards (Total / Completed / In progress / Pending / Overdue), a
  completion progress bar, tasks-by-status / priority / member bars, "assigned to me", the
  QA queue, overdue work and a recent-activity feed — all computed from the saved tasks,
  with the whole page exportable to PDF and Excel.
- **Timeline** covering the whole project: a Day / Week / Month zoom plus a **Fit entire project**
  button, a header axis with a today marker, task, timer, start/due dates, estimates and logged
  time in one frozen grid — bars are positioned from each task's start → due date (falling back
  to timer instants), the project range strip shows the configured project dates or the earliest
  start / latest due date, and tasks without dates are still listed instead of breaking the chart.
- **Workload** against per-project and per-user working hours, honouring holidays and
  working-day exceptions.
- **Calendar** (month/week) with a My/All toggle, project and assignee filters, a colour
  legend and PDF export — Friday/Saturday weekly holidays use a light `#fff2f2` tint,
  configured holidays a stronger red, and working-day exceptions light yellow.
- **Holiday management** in Calendar Settings: a single-line add row (name, start, end, type)
  and read-only rows with an **Edit** button that swaps in date/name/type inputs plus Save/Cancel,
  so saved holidays can be updated without an always-visible edit form; duplicates and reversed
  ranges are rejected. "Working-day exception" toggles open the office on a holiday without
  deleting it. (A holiday `description` that was saved earlier stays stored and still shows in
  the calendar tooltip — it is simply no longer edited here.)
- **Reports**: status distribution, open tasks per assignee, a standalone **QA Queue — In
  Testing per Tester** section (own heading and container, grouped by tester with counts, fed by
  the shared task store so status/tester changes appear without a reload), estimate vs actual,
  and overdue — exportable to PDF.
- **Archive** is a filtered view of Done tasks, not a separate store.

### 🔐 Workflow, roles & permissions
- Custom **statuses**, **transitions** and **workflow** per project, editable in Settings:
  the Transitions card is a compact From / To / Allowed-roles table with add and remove
  actions, inline role editing and duplicate/same-status guards (empty roles = every role;
  Admin/PM may always move to any status).
- **Forward-only** status moves with a manager bypass, enforced on the server.
- **Multi-role membership** — a user can hold several roles in one project; effective
  permissions are the union of them.
- **Role × action matrix** and **field-level rules** (`hidden` / `readonly` / `editable`)
  editable by admins; system roles cannot be deleted but are fully editable.
- **Server-side enforcement** on every endpoint (401/403 + a friendly no-access page);
  the UI only hides or disables.
- **Automation rules** driven from Settings (e.g. stamp dates on status change, notify a
  tester or assignee, clear the end date on re-open) — the rules card sits directly below
  Priorities & issue types, and every Settings card shares one heading/helper/spacing pattern
  that stacks cleanly on narrow screens.

### 💬 Collaboration & notifications
- Threaded **comments**, **remarks** and **feedback** per task.
- **Notifications** bell with a live unread counter, task deep links and a Mark-all-read action.
- **Realtime updates** over SSE (`/api/projects/:id/events`) with a 15-second polling
  fallback.

### 🛠️ Administration & security
- **Users** page: create users, edit profiles, upload avatars (`.jpg` / `.jpeg`, ≤ 2 MB),
  and manage project memberships; deletes are soft deletes so history is preserved.
- **Designations** are references to a role from Roles & Permissions and grant no
  permissions by themselves; every picker shows users as `Name - Designation` and the
  Roles page counts the users holding each designation.
- **Assignments and testing** are drawn from the whole user directory: any non-deleted
  user can be an assignee or tester in any project (deactivated accounts stay selectable
  and are labelled *inactive*).
- **Audit log** for logins, failed logins, lockouts, permission changes and resets.
- **Project Members** is one compact card: a one-line add form (user + role), a table with
  avatar, name/designation, role chips and joined date, and removal behind a confirmation
  dialog.
- **Cookie-session auth** with login rate limiting and lockout, absolute/idle expiry,
  remember-me, forced password change on first login, and a self-service **Active
  Sessions** list on the Profile page: the real browser/OS is parsed from the user agent
  (missing parts are labelled unknown — nothing is invented), status and last activity are
  derived from the server timestamps with relative times, the list has its own scroll
  container, and a single session or every other session can be revoked after a
  confirmation.
- The **Profile page** centres one card that groups name/avatar, the email-change flow and
  the password-change form (labelled fields, never the password itself), keeping the
  existing validation, busy states and real backend flow; Active Sessions sits below it.
- **Self-service email change** from the Profile page: the current password re-authenticates the
  change, the address is normalised to lower case and checked against every other account's
  email **and** username, the same user row (id, projects, tasks, sessions) is kept and the
  change is audited. Sign-in with the new address works immediately — this deployment has no
  mail provider, so there is no confirmation link step.
- **Password resets** are admin-triggered by default; with `SMTP_URL` set, a one-hour reset
  token is issued and written to the server log for the operator to deliver (no mailer is
  bundled).
- **Security headers** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`) set in `next.config.ts`.
- No public sign-up — accounts are created by administrators by design.

### 📥 Import / export & localization
- **Excel (.xlsx) export** and **CSV / Excel import** using the exact spreadsheet column names.
- UTF-8 end-to-end with **NFC-normalized, Bangla-safe search** and the Noto Sans Bengali
  font loaded as a fallback for user-entered text.
- **Light / dark theme** persisted per device and per profile.
- **Collapsible sidebar** with one toggle button: on desktop it collapses the navigation to a
  compact icon rail (labels hidden, every link still reachable, hover tooltips, project key
  badges as icons) and expands it back; on phones/tablets the same button opens an overlay
  drawer that closes on navigation and locks background scrolling. The choice is remembered
  per device and restored before first paint (no flicker), and page content smoothly reclaims
  the freed space.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server components, route handlers |
| UI | **React 19** + **Tailwind CSS 4** | CSS-variable theming (`@theme inline`) |
| Language | **TypeScript 7** | Strict mode, `@/*` path alias |
| ORM / DB | **Prisma 7** + **SQLite** (`better-sqlite3` / libSQL) | Local file by default; Turso for serverless hosts |
| Auth | Custom cookie sessions + **bcryptjs** | Opaque tokens, SHA-256 hashed at rest |
| Validation | **Zod 4** | Request/query validation |
| Spreadsheets | **xlsx** | Excel / CSV import and export |
| PDF | **jspdf** | Report and calendar exports |
| Testing | **Vitest 5** | 197 tests across 15 files |
| Tooling | **tsx**, **PostCSS** | Seed runner and CSS pipeline |

---

## Project Structure

```text
Task-Tracker/
├─ prisma/
│  ├─ schema.prisma          # users, projects, tasks, roles, workflow, timer…
│  ├─ seed.ts                # demo data + default roles, statuses, automation
│  └─ migrations/            # committed SQL migrations (source of truth)
├─ scripts/
│  ├─ pretest.mjs            # builds scratch test DBs from migrations (runs on npm test)
│  ├─ _apply-migration.mjs   # applies committed migrations to the dev database
│  ├─ migrate-turso.mjs      # applies committed migrations to a remote Turso DB
│  ├─ copy-local-to-turso.mjs # copies the local SQLite data up to a remote Turso DB
│  ├─ create-admin.ts        # create/repair the fixed super-admin (local or Turso)
│  ├─ crawl-check.mjs        # logs in and crawls every page / API route
│  ├─ import-check.mjs       # CSV/XLSX import smoke check
│  ├─ sse-check.mjs          # realtime (SSE) smoke check
│  └─ remove-customer-impact-option.mjs  # one-off: legacy option-value cleanup
├─ src/
│  ├─ app/
│  │  ├─ (app)/              # authenticated shell
│  │  │  ├─ page.tsx         # dashboard
│  │  │  ├─ calendar/        # month / week calendar
│  │  │  ├─ users/           # user administration
│  │  │  ├─ profile/         # profile, email, password, sessions, avatar
│  │  │  ├─ admin/           # roles & permissions, audit log
│  │  │  └─ p/[id]/          # board, table, timeline, workload,
│  │  │                      # reports, archive, members, settings
│  │  ├─ api/                # route handlers (auth, users, projects, tasks…)
│  │  ├─ login/ · change-password/ · forgot-password/
│  │  └─ layout.tsx · globals.css · error boundaries
│  ├─ components/            # shared UI (task drawer, dialogs, theme toggle…)
│  ├─ hooks/                 # client data hooks (project data + SSE)
│  └─ lib/                   # domain logic (permissions, tasks, workflow,
│                            # timer, calendar, reports, pdf…)
├─ tests/                    # Vitest suites
├─ next.config.ts            # security headers
├─ prisma.config.ts          # Prisma 7 config (datasource URL from env)
└─ .env.example              # environment template
```

---

## Getting Started

### Prerequisites

- **Node.js ≥ 20.9** (required by Next.js 16)
- **npm** (bundled with Node.js)
- No database server needed — SQLite is used for local development

### 1. Clone & install

```bash
git clone https://github.com/mono-is-byte/Task-Tracker.git
cd Task-Tracker
npm install
```

### 2. Configure environment

Copy the template and fill in your own values:

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

Then open `.env` and set at least:

- `DATABASE_URL` — `file:./dev.db` works out of the box.
- `SESSION_SECRET` — a long, random string you generate yourself (e.g.
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).

> 🔒 Never commit `.env`. It is already listed in `.gitignore`; only `.env.example`
> is tracked. See [Environment Variables](#environment-variables) for the full list.

### 3. Set up the database

Apply the committed migrations and seed the demo data:

```bash
npx prisma migrate dev
npm run seed -- --reset
```

- `npx prisma migrate dev` applies the committed migrations from `prisma/migrations/` and
  creates the SQLite database.
- `npm run seed -- --reset` wipes and repopulates the database with demo users, projects
  and tasks. Without `--reset`, the seed skips if users already exist.
- If the Prisma client is not generated automatically during the previous steps, run
  `npx prisma generate`.

### 4. Run the dev server

```bash
npm run dev
```

Open **http://localhost:3000** and sign in with one of the seeded accounts
(see [Demo data & first login](#demo-data--first-login)).

### Demo data & first login

The seed in `prisma/seed.ts` creates a small demo team, three demo projects
(**MAP**, **LVM**, **NM**) with epics, stories and tasks, plus default roles, statuses and
automation rules.

Every seeded account is assigned a **shared, well-known demo password defined in
`prisma/seed.ts`**, and all of them are forced to change it on first sign-in. Use these
accounts for local development only:

- To point the app at your own credentials, create users from **Users** in the app
  (admins issue a one-time temporary password), or edit the seed before running it.
- Before exposing an instance to a network, change or remove the demo accounts and set a
  strong `SESSION_SECRET`.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ (local) | `file:./dev.db` for the local SQLite file; the Prisma CLI also reads this for `migrate`/`seed`. |
| `TURSO_DATABASE_URL` | — | Remote libSQL/Turso URL (`libsql://…`). When set, the running app uses it instead of the local file — required on serverless hosts such as Vercel. |
| `TURSO_AUTH_TOKEN` | — | Turso database token (`turso db tokens create <db>`); required whenever `TURSO_DATABASE_URL` is remote. |
| `SESSION_SECRET` | ✅ | Long random string reserved for signing; sessions themselves are opaque, hashed tokens |
| `APP_URL` | — | Base URL of the app; cookies are marked `Secure` when it starts with `https://` (and always in production) |
| `SMTP_URL` | — | If set, forgot-password issues a one-hour reset token and writes it to the server log for an operator to deliver; if unset, users are told to ask an admin |
| `SMTP_FROM` | — | From address intended for mail delivery — not read by the current build, which logs reset tokens instead of sending mail |

Copy `.env.example` to `.env` and fill in your own values — the template contains
placeholders only.

---

## Running in Production

### Self-hosted (SQLite file)

```bash
npm run build
npm start
```

- `npm start` reads `.env` and serves on **http://localhost:3000** by default.
- Set `PORT` to serve on a different port.
- Any host with a **persistent disk** (VPS, Docker, Railway/Render/Fly with a volume) can
  run this exactly as-is — the database is the `dev.db` file.

### Vercel (SQLite via Turso)

Vercel's filesystem is **read-only** and per-invocation, so a SQLite *file* cannot live
there. The app therefore supports a remote **libSQL/Turso** database — same SQLite dialect,
same migrations, same tests:

1. Create a database at [turso.tech](https://turso.tech) and copy its URL + token:
   ```bash
   turso db create tasktracker
   turso db show tasktracker --url          # libsql://<db>-<org>.turso.io
   turso db tokens create tasktracker       # token
   ```
2. Apply the committed migrations to it (from your machine, once per schema change):
   ```bash
   TURSO_DATABASE_URL="libsql://<db>-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" npm run turso:migrate
   ```
3. Create the first admin user by seeding against Turso:
   ```bash
   TURSO_DATABASE_URL="libsql://<db>-<org>.turso.io" \
   TURSO_AUTH_TOKEN="<token>" npm run seed -- --reset
   ```
   (This writes to the remote database only — the local `dev.db` is untouched.)
   To skip the demo team and create only a fixed super-admin account instead, use
   `npm run admin:create` with the same environment variables (it prints the
   credentials it sets).
   To copy your **existing local data** up to Turso instead — the remote database
   then matches your `dev.db` exactly — run `npm run turso:copy-local` with the
   same environment variables.
4. In **Vercel → Project → Settings → Environment Variables** add:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_URL` (your `https://…` URL) and
   `SESSION_SECRET`. Do **not** set `DATABASE_URL` to a file path on Vercel.
5. **Match the regions.** Vercel Functions default to `iad1` (US East), while a Turso
   database lives in one AWS region — every request/query would then cross the world. The
   committed `vercel.json` sets the function region to `bom1` (Mumbai); keep it equal to the
   Turso database's region (`bom1` ↔ `aws-ap-south-1`, `sin1` ↔ `aws-ap-southeast-1`).
6. Redeploy.

`src/lib/db.ts` picks the libSQL driver when `TURSO_DATABASE_URL` is set and
`better-sqlite3` otherwise, so no code change is needed per environment.

Known serverless limitations:

- **Realtime SSE** is in-process, so it only matters for a single instance; the client
  already falls back to 15-second polling.
- The background **timer sweep** (`instrumentation.ts`) does not run on serverless; timer
  state is still derived on read, so the UI stays correct.

Avatar uploads work on serverless too: the JPEG is stored in the `UserAvatar` table and
served through `/api/users/<id>/avatar`, while local/self-hosted runs keep writing files
under `public/uploads/avatars`.

For a hosted PostgreSQL instead, change the Prisma datasource provider to `postgresql`,
regenerate the SQLite migrations against Postgres, and switch to `@prisma/adapter-pg`.


---

## Usage

1. **Sign in** at `/login` with an account created by an administrator. There is no public
   sign-up.
2. **Dashboard** (`/`) shows your summary, assigned work, QA queue, overdue tasks and
   recent activity.
3. **Open a project** from the sidebar or dashboard to reach its sections: Board, Table,
   Timeline, Workload, Reports, Archive, Members and Settings (the last three are
   permission-gated).
4. **Move work along** by dragging cards on the Board or changing the status in the Table.
   QA roles can advance status without edit rights (status-only changes).
5. **Track time** with the Start/Stop controls on tracked stages; moving a task forward
   auto-stops the running segment.
6. **Admins** manage users at **Users**, roles and field rules at **Admin → Roles &
   Permissions**, and review activity at **Admin → Audit Log**.

Use the **Calendar** (`/calendar`) for a cross-project month/week view — **Calendar
Settings** manages holiday date ranges and working-day exceptions — and the **☀ / 🌙**
toggle for theming.

### Roles at a glance

| Role | Scope | Typical access |
|---|---|---|
| **Super Admin** | Global flag | Everything, everywhere, including Admin pages |
| **Project Manager** | Per project | Full project management: tasks, estimates, workflow, automation, members, reports |
| **Developer** | Per project | Works on assigned tasks; edits own fields, moves status, comments |
| **QA / Tester** | Per project | Advances testing (`Development Done → In Testing → Done`), writes feedback |
| **Viewer / Stakeholder** | Per project | Read-only access to views and reports |

Roles are assigned per project, a member may hold several at once, and every role is
editable in the permission matrix.

### Key concepts

- **Task key** = `{PROJECT}-{serial}` (for example `MAP-12`).
- **Est. Days is always calculated** (`Est. Hours ÷ hours-per-day`) and never typed. The
  default is 8 hours/day, configured per project in Settings; the per-user capacity override
  is no longer edited from the Profile page (the stored value, if any, and the project-level
  setting keep driving every calculation).
- **Archive is a derived view** of Done tasks; re-opening moves tasks back out.
- **Permissions are enforced server-side** on every endpoint, including the status-only
  change rule that lets QA advance work while field edits stay locked.
- **Automation defaults**: Done stamps the end date, In Progress stamps a start date when
  empty, In Testing notifies the tester, and re-open notifies the assignee and clears the
  end date.
- **Realtime** uses SSE with a polling fallback, and the UI is fully usable without it.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>/</kbd> | Focus the table search |
| <kbd>Esc</kbd> | Close the task drawer or an inline editor |
| <kbd>Enter</kbd> | Commit an inline table edit |

---

## Excel Import / Export

From the Table view:

- **⬇ Download Excel (.xlsx)** exports the current (filtered) table view with the
  exact spreadsheet column names (`SL, Epic, User Story, Task title, Story Points, Est. Hours, Est. Days, …`).
- **⬆ Import** accepts your current sheet: `SL` and `Est. Days` are ignored (the serial is
  automatic and the day count is calculated), unknown Epic / Status / Priority / member
  names are reported per row instead of being guessed, missing user stories are created,
  and `Dependency` accepts `PREFIX-N` keys.

---

## Testing

```bash
npm test
```

The suite runs **197 tests across 15 files** with Vitest. A `pretest` step
(`scripts/pretest.mjs`) builds scratch databases under `tests/` from the committed
migration SQL — the dev database is never touched.

Coverage includes the domain rules (Fibonacci story points, Est. Days math, transitions,
working-day capacity with holidays and exceptions), permissions and field rules,
authentication (login/logout, lockout, session expiry, self-service email change with
re-authentication and duplicate/username collisions), session display helpers (device
parsing, status, relative times), project lookup CRUD (duplicate rejection, deleting an
in-use option with task reassignment), timer derivation, calendar and holiday logic (date
ranges, duplicate detection, working-day exceptions), timeline maths (day-key ranges,
project range derivation, zoom scale, axis ticks, bar geometry), QA queue grouping,
dashboard aggregation, PDF generation, user management and Bangla-safe search.

---

## Developer Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite (with scratch DB setup) |
| `npm run seed` | Seed demo data (`npm run seed -- --reset` to wipe first) |
| `npm run admin:create` | Create/repair the fixed super-admin account (local or Turso, per env) |
| `npm run db-push` | `prisma db push` for quick schema sync |
| `npm run turso:migrate` | Apply the committed migrations to the remote Turso database |
| `npm run turso:copy-local` | Copy the local database (`dev.db`) into the remote Turso database, replacing its data |
| `scripts/_apply-migration.mjs` | Apply committed migrations to the dev database |
| `scripts/crawl-check.mjs` | Log in and crawl every page / API route for errors |

---

## Troubleshooting

- **`npm run seed` skips on a used database** — that is by design ("Seed skipped: users
  already exist. Use --reset to reseed."). Run `npm run seed -- --reset` to wipe and
  reseed, or create users inside the app instead.
- **Prisma client out of sync after pulling schema changes** — `npm install` runs
  `prisma generate` for you; if you skipped it, run `npx prisma generate` and restart the
  dev server.
- **Port 3000 is already taken** — serve elsewhere, e.g. `PORT=4000 npm run dev`
  (PowerShell: `$env:PORT=4000; npm run dev`).
- **Tests fail against a stale scratch database** — `pretest` only applies migrations to
  missing or empty `tests/test-*.db` files; delete the stale file(s) and rerun `npm test`
  to rebuild them from the committed migrations.
- **Sign-in fails with a 500 after deploying to Vercel** — Vercel cannot host a SQLite
  *file* (read-only filesystem). Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`, apply the
  migrations with `npm run turso:migrate`, and seed the database — see
  [Vercel (SQLite via Turso)](#vercel-sqlite-via-turso).
- **Sign-in fails on a fresh clone** — make sure `.env` exists and
  `npx prisma migrate dev` has been run from the repository root.

---

## Security Notes

- **Never commit `.env`** or any real credentials. The repository tracks only
  `.env.example`, which contains placeholders.
- Sessions are opaque tokens stored as SHA-256 hashes; `SESSION_SECRET` is the only secret
  the app needs.
- Set `APP_URL` to an `https://` URL in production so cookies are marked `Secure`.
- Login is rate-limited and locks out after repeated failures; administrators can unlock
  accounts and trigger password resets.
- Password reset links are operator-delivered: with `SMTP_URL` set, a one-hour token is
  written to the server log to hand over — no mailer is bundled, and without it resets
  stay admin-triggered.

---

## Roadmap

- [ ] Bundle a mailer (or SMTP relay UI) so password reset links can be delivered directly.
- [ ] Swap the in-process SSE pub/sub for a shared broker to support multiple app instances
      behind a load balancer.
- [ ] Add file storage for task attachments (avatars already work: on disk locally,
      in the database on serverless).
- [ ] Add first-class PostgreSQL deployment docs and an example migration guide.
- [ ] Add a `LICENSE` file and screenshot gallery to the repository.
- [ ] Expand integration tests around the realtime layer.

Known limitations today:

- Mail is **log-only**: with `SMTP_URL` set, reset tokens are written to the server log for
  an operator to deliver.
- Realtime is **in-process**, fine for a single-instance self-hosted deployment.
- XLSX import is capped at 2000 rows per run.
- `middleware.ts` is intentionally not used (deprecated in Next.js 16 in favour of
  `proxy.ts`); auth gating lives in the app layout and API layer, and security headers are
  set in `next.config.ts`.

---

## Contributing

Contributions are welcome.

1. Fork the repository and create a feature branch from `main`.
2. Keep changes consistent with the existing structure and style.
3. Before opening a pull request, make sure everything passes locally:

   ```bash
   npx tsc --noEmit
   npm test
   npm run build
   ```

4. Describe your change clearly and link any related issue.

Please do not commit secrets, `.env` files, or generated databases (`*.db`).

---

## License

Declared as **ISC** in [`package.json`](./package.json). A standalone `LICENSE` file is
not included yet — see the [Roadmap](#roadmap).
