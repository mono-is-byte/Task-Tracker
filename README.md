# TaskTracker

A self-hosted, multi-user task tracker — a lightweight Jira alternative for small teams.
Kanban boards, an inline-editable table, timeline, workload, calendar and reports, with
per-project roles, field-level permissions, custom workflows and automation.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/tests-120_passing-2ea44f?logo=vitest&logoColor=white)](./tests)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.9-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-ISC-blue)](#license)

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
cloud account. The Prisma schema uses only portable types, so switching to PostgreSQL
later means changing the datasource provider, setting `DATABASE_URL`, and running
`prisma migrate deploy`.

> **Status:** actively developed — 120 automated tests, full server-side permission
> enforcement, and light/dark theming.

---

## Features

### 🗂️ Tasks & work management
- **Board (Kanban)** with drag-and-drop status changes and per-column quick-add.
- **Table view** with inline editing, resizable columns, filters and a task drawer.
- **Task drawer** for comments, activity history, links (`blocks` / `relates`), labels,
  custom fields and Git branch.
- **Task Timer** per stage: statuses define a timer role (`NONE` / `TRACK` / `FINAL`) so a
  running segment can be started and stopped, auto-stops when the task moves on, and shows
  total time once the task is Done.
- **Epics, stories** and structured task types (Task / Story / Bug / Epic / Sub-task).

### 📊 Views & reporting
- **Dashboard** with summary stats, tasks-by-status / priority / member bars, "assigned to
  me", the QA queue, overdue work and a recent-activity feed.
- **Timeline** with task, timer, start/due dates, estimates, logged time and duration bars.
- **Workload** against per-project and per-user working hours.
- **Calendar** (month/week) with a My/All toggle, project and assignee filters, holiday
  highlighting and PDF export.
- **Reports**: status distribution, open tasks per assignee, QA queue, estimate vs actual,
  and overdue — exportable to PDF.
- **Archive** is a filtered view of Done tasks, not a separate store.

### 🔐 Workflow, roles & permissions
- Custom **statuses**, **transitions** and **workflow** per project, editable in Settings.
- **Forward-only** status moves with a manager bypass, enforced on the server.
- **Multi-role membership** — a user can hold several roles in one project; effective
  permissions are the union of them.
- **Role × action matrix** and **field-level rules** (`hidden` / `readonly` / `editable`)
  editable by admins; system roles cannot be deleted but are fully editable.
- **Server-side enforcement** on every endpoint (401/403 + a friendly no-access page);
  the UI only hides or disables.
- **Automation rules** driven from Settings (e.g. stamp dates on status change, notify a
  tester or assignee, clear the end date on re-open).

### 💬 Collaboration & notifications
- Threaded **comments**, **remarks** and **feedback** per task.
- **Notifications** bell with per-user preferences.
- **Realtime updates** over SSE (`/api/projects/:id/events`) with a 15-second polling
  fallback.

### 🛠️ Administration & security
- **Users** page: create users, edit profiles, upload avatars (`.jpg` / `.jpeg`, ≤ 2 MB),
  and manage project memberships; deletes are soft deletes so history is preserved.
- **Designations** are free-text job titles that grant no permissions.
- **Audit log** for logins, failed logins, lockouts, permission changes and resets.
- **Cookie-session auth** with login rate limiting and lockout, absolute/idle expiry,
  remember-me, forced password change on first login, and a self-service session list.
- **Password resets** are admin-triggered by default, or token-based when SMTP is configured.
- **Security headers** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`) set in `next.config.ts`.
- No public sign-up — accounts are created by administrators by design.

### 📥 Import / export & localization
- **CSV / XLSX export** and **Excel import** using the exact spreadsheet column names.
- UTF-8 end-to-end with **NFC-normalized, Bangla-safe search** and the Noto Sans Bengali
  font loaded as a fallback for user-entered text.
- **Light / dark theme** persisted per device and per profile.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server components, route handlers |
| UI | **React 19** + **Tailwind CSS 4** | CSS-variable theming (`@theme inline`) |
| Language | **TypeScript 7** | Strict mode, `@/*` path alias |
| ORM / DB | **Prisma 7** + **SQLite** (`better-sqlite3` adapter) | Portable schema, Postgres-ready |
| Auth | Custom cookie sessions + **bcryptjs** | Opaque tokens, SHA-256 hashed at rest |
| Validation | **Zod 4** | Request/query validation |
| Spreadsheets | **xlsx** | Excel / CSV import and export |
| PDF | **jspdf** | Report and calendar exports |
| Testing | **Vitest 5** | 120 tests across 10 files |
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
│  ├─ crawl-check.mjs        # logs in and crawls every page / API route
│  ├─ import-check.mjs       # CSV/XLSX import smoke check
│  └─ sse-check.mjs          # realtime (SSE) smoke check
├─ src/
│  ├─ app/
│  │  ├─ (app)/              # authenticated shell
│  │  │  ├─ page.tsx         # dashboard
│  │  │  ├─ calendar/        # month / week calendar
│  │  │  ├─ users/           # user administration
│  │  │  ├─ profile/         # profile, capacity, sessions, avatar
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
git clone https://github.com/monowarulislam-byte/Task-Tracker.git
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
| `DATABASE_URL` | ✅ | `file:./dev.db` for SQLite; a `postgresql://…` URL after switching providers |
| `SESSION_SECRET` | ✅ | Long random string used for signing; sessions themselves are opaque, hashed tokens |
| `APP_URL` | — | Base URL of the app; enables `Secure` cookies when set to `https://…` |
| `SMTP_URL` | — | If set, forgot-password issues emailed reset links; if unset, resets are admin-triggered |
| `SMTP_FROM` | — | From address used for reset emails when `SMTP_URL` is set |

Copy `.env.example` to `.env` and fill in your own values — the template contains
placeholders only.

---

## Running in Production

```bash
npm run build
npm start
```

- `npm start` reads `.env` and serves on **http://localhost:3000** by default.
- Set `PORT` to serve on a different port.
- For a hosted database, change the Prisma datasource provider to `postgresql`, set
  `DATABASE_URL`, and run `npx prisma migrate deploy`.

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

Use the **Calendar** (`/calendar`) for a cross-project month/week view, and the
**☀ / 🌙** toggle for theming.

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
  default is 8 hours/day, configurable per project (Settings) and per user (Profile →
  capacity override).
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

- **⬇ CSV / ⬇ XLSX** export use the exact spreadsheet column names
  (`SL, Epic, User Story, Task title, Story Points, Est. Hours, Est. Days, …`).
- **⬆ Import** accepts your current sheet: `SL` and `Est. Days` are ignored (the serial is
  automatic and the day count is calculated), unknown Epic / Status / Priority / member
  names are reported per row instead of being guessed, missing user stories are created,
  and `Dependency` accepts `PREFIX-N` keys.

---

## Testing

```bash
npm test
```

The suite runs **120 tests across 10 files** with Vitest. A `pretest` step
(`scripts/pretest.mjs`) builds scratch databases under `tests/` from the committed
migration SQL — the dev database is never touched.

Coverage includes the domain rules (Fibonacci story points, Est. Days math, transitions),
permissions and field rules, authentication (login/logout, lockout, session expiry),
timer derivation, calendar and holiday logic, dashboard aggregation, PDF generation,
user management and Bangla-safe search.

---

## Developer Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite (with scratch DB setup) |
| `npm run seed` | Seed demo data (`npm run seed -- --reset` to wipe first) |
| `npm run db-push` | `prisma db push` for quick schema sync |
| `scripts/_apply-migration.mjs` | Apply committed migrations to the dev database |
| `scripts/crawl-check.mjs` | Log in and crawl every page / API route for errors |

---

## Security Notes

- **Never commit `.env`** or any real credentials. The repository tracks only
  `.env.example`, which contains placeholders.
- Sessions are opaque tokens stored as SHA-256 hashes; `SESSION_SECRET` is the only secret
  the app needs.
- Set `APP_URL` to an `https://` URL in production so cookies are marked `Secure`.
- Login is rate-limited and locks out after repeated failures; administrators can unlock
  accounts and trigger password resets.
- Password reset emails require a configured SMTP relay. Without one, resets are
  admin-triggered — no mailer is bundled.

---

## Roadmap

- [ ] Bundle a mailer (or SMTP relay UI) so password reset links can be delivered directly.
- [ ] Swap the in-process SSE pub/sub for a shared broker to support multiple app instances
      behind a load balancer.
- [ ] Add local file storage for task attachments (avatars are already stored locally).
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

Released under the **ISC License**, as declared in [`package.json`](./package.json).
