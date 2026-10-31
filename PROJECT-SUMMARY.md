## 1. What this is

**TaskTracker** is a self-hosted, Jira-like project & task management web app for a
software team. It covers projects → epics → tasks, a Kanban board, a table
view, a timeline/calendar, per-stage time tracking, role/permission management,
automation rules, notifications, audit logging, and Excel/PDF export.

Single-tenant: one deployment = one organisation. Not multi-tenant SaaS.

- **Repo root:** `...:\GitHub\Task-Tracker`
- **Live URL:** `https://its-task-tracker.vercel.app` — verified healthy on 2026-10-24:
  function region `bom1` (Mumbai), Turso reachable, `/api/auth/me` TTFB ~185 ms.
  The live build is still the **2026-10-25** deployment; the current tree contains newer
  UI/security work that has not been pushed yet.

---

## 2. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js **App Router** (RSC) | `^16.4.0` |
| UI | React | `^19.3.0` |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | `^4.3.3` |
| ORM | Prisma Client with **driver adapters** | `^7.10.0` |
| DB | SQLite (schema provider) — local file **or** remote libSQL/Turso | — |
| DB drivers | `@prisma/adapter-better-sqlite3` (local), `@prisma/adapter-libsql/web` (remote) | `^7.10.0` |
| Auth | Hand-rolled sessions, `bcryptjs` | `^3.0.3` |
| Validation | `zod` | `^4.6.7` |
| Export | `xlsx`, `jspdf` | `^0.18.5`, `^4.2.1` |
| Tests | Vitest | `^5.0.4` |
| Language | TypeScript | `^7.0.2` |
| Hosting | Vercel (Fluid/serverless) + Turso | — |

Important: **Next.js 16 has breaking changes**. `AGENTS.md` says to read
`node_modules/next/dist/docs/` before writing Next-specific code. Do not rely on
pre-16 memory for APIs, conventions and file structure.

---

## 3. Repository layout

```
Task-Tracker/
├── prisma/
│   ├── schema.prisma              # 27 models, provider = "sqlite"
│   ├── migrations/                # 23 committed migrations (source of truth)
│   └── seed.ts                    # demo data; DEMO_PASSWORD = "Demo1234!"
├── prisma.config.ts               # Prisma 7 config: schema path, migrations path, seed
├── scripts/
│   ├── pretest.mjs                # builds scratch SQLite DBs from migrations for tests
│   ├── migrate-turso.mjs          # replays migrations against remote libSQL/Turso
│   ├── copy-local-to-turso.mjs    # copy local dev.db data into Turso
│   ├── create-admin.ts            # create/repair the fixed super-admin
│   ├── crawl-check.mjs            # HTTP crawl smoke check
│   ├── import-check.mjs, sse-check.mjs, _apply-migration.mjs, remove-customer-impact-option.mjs
├── src/
│   ├── app/
│   │   ├── (app)/                 # authenticated shell (layout = sidebar + header)
│   │   │   ├── page.tsx           # Dashboard
│   │   │   ├── admin/{audit,roles,users}/
│   │   │   ├── calendar/
│   │   │   ├── p/[id]/
│   │   │   │   ├── board/ table/ timeline/ reports/ workload/
│   │   │   │   ├── archive/ members/ settings/
│   │   │   ├── profile/
│   │   │   └── users/
│   │   ├── api/                   # 44 route handlers (see §8)
│   │   ├── change-password/  forgot-password/  login/  no-access/
│   │   ├── layout.tsx  globals.css
│   │   └── instrumentation.ts     # server-start timer sweep (unreliable on serverless)
│   ├── components/                # 21 client components
│   ├── hooks/                     # useProject.ts (SSE + polling), useTicker.ts
│   └── lib/                       # 35 server/domain modules (see §5)
├── tests/                         # 19 Vitest files, 256 tests
├── vercel.json                    # { "regions": ["bom1"] }
├── next.config.ts                 # serverExternalPackages + security headers
├── README.md                      # user-facing docs
├── PLAN.md                        # architecture + 16 phases of history/decisions
└── AGENTS.md                      # Next.js 16 agent rules (auto-generated block)
```

---

## 4. Data model (Prisma, 27 models, SQLite)

Grouped by concern:

**Auth / users**
- `User` — email/username (unique), `passwordHash`, `mustChangePassword`,
  `active`, `deletedAt` (soft delete), `isSuperAdmin`, `lockedUntil`, `failedLogins`,
  `theme`, `avatarUrl`, `designation` (**stores a Role id**, resolved live),
  `gender` (optional, one of Male / Female / Other / Prefer not to say),
  `hoursPerDay`, `lastActiveAt`.
- `UserAvatar` — `bytes` blob + mime; used **only** on read-only filesystems
  (Vercel). Local installs write `public/uploads/` instead.
- `Session` — `tokenHash` (SHA-256 of the cookie), `expiresAt`, `idleExpiresAt`,
  `rememberMe`, `revokedAt`, `ip`, `userAgent`.
- `LoginAttempt` — identifier/ip/success for rate-limit + lockout.
- `PasswordReset`, `AuditLog` (actor, action, entity, meta JSON, ip).

**Organisation**
- `Role` — `permissions` JSON, `fieldRules` JSON, `isSystem`.
- `Project`, `ProjectMember`, `ProjectMemberRole` (many-to-many roles per member).
- `StatusDesignationTag` — which roles may enter a status (`roleId` FK; no free text).

**Work items**
- `Project` has `key`, `hoursPerDay`, `workingDays`, `hidden`, `completed`, settings.
- `Epic`. The `Story` model, `Task.storyId`, `Epic.stories`, `Task.storyPoints` and
  `Project.pointScale` were removed on 2026-10-25 (migrations
  `20261025120000_remove_story`, `20261025121000_remove_story_points`); "Story" remains
  available as an **issue type**. The `Sprint` model and `Story.sprintId` / `Task.sprintId`
  columns were dropped earlier (`20261024182738_drop_legacy_sprint_model`).
- `Task` — `serial` (unique per project → display key `PROJ-123`), type, epic, title,
  description, `estHours`, `rdTime`, `loggedHours`, priority, status, assignee,
  `assignedById`, `assignedAt`, testedBy, dates (`startDate`, `endDate`, `dueAt`), timer
  fields (`startedAt`, `stoppedAt`, `stageEnteredAt`, `totalSeconds`), `gitBranch`,
  `labels` JSON, `customValues` JSON, `position`.
- `TaskStageTime` — one row per Start→Stop segment (per-stage history).
- `TaskLink`, `Comment` (with nullable `solvedAt` for the Solve marker), `Activity`.

**Configuration**
- `Status` (+ `StatusTransition`), `Priority`, `IssueType`, `StatusDesignationTag`,
  `CustomField`, `AutomationRule`, `Notification`, `SavedView`, `Holiday`,
  `WorkingDayException`.

> `Task.serial` is assigned by `taskKey(prefix, serial)` → `PREFIX-<n>` in `src/lib/db.ts`.

---

## 5. Key modules (`src/lib`)

| File | Responsibility |
|---|---|
| `db.ts` | Prisma client singleton + **adapter selection** (local vs Turso), `makeTestClient`, `taskKey` |
| `auth.ts` | Cookie name/TTLs, hashing, sessions, `login`/`logout`, lockout, password/email change, user creation, audit helper |
| `permissions.ts` | `ACTIONS` (20), `TASK_FIELDS`, `mergeRoles`, `getMembership`, field rules, edit checks |
| `server.ts` | `getViewer` (React-cached), `requireViewer`, `loadProject`, `listProjectsForUser`, project context |
| `api.ts` | `requireUser` / `ok` / error helpers for route handlers, same-origin check |
| `tasks.ts` | Task CRUD, board/table ordering, bulk ops, validation |
| `timeline.ts`, `calendar.ts`, `holidays.ts`, `holidayDates.ts` | Timeline/calendar computations, holiday & working-day math |
| `timer.ts`, `timerState.ts`, `timerFormat.ts` | Start/Stop segments, overdue timers, formatting |
| `dashboard.ts` | `dashboardSummary` + `dashboardLists` aggregations |
| `reports.ts`, `completion.ts` | Report payloads, done/category completion rules |
| `workflow.ts`, `workflow-server.ts` | Status transitions, designation gating, assign step |
| `automation.ts` | Rule evaluation (e.g. on status change) |
| `events.ts`, `taskStore.ts` | In-process pub/sub + SSE plumbing |
| `avatar.ts` | Local FS avatar read/write + `avatarApiUrl` |
| `userDirectory.ts` | App-wide assignable-user directory (all non-deleted users) |
| `pdf.ts`, `lookups*.ts`, `members.ts`, `roles.ts`, `users.ts`, `sessionInfo.ts`, `sidebar.ts`, `domain.ts` | Supporting domains |

---

## 6. Auth & security model

- Cookie `tt_session`, **HttpOnly**, `SameSite=Lax`, `Secure` in production.
  Value = random token; DB stores only `sha256(token)`.
- TTLs: session **12h**, "remember me" **30d**, **idle 2h** (`idleExpiresAt`).
- Login: identifier = email **or** username; `bcryptjs` verify; **5 failures / 15 min**
  → 15-minute lockout; `LoginAttempt` rows feed the counter.
- `mustChangePassword` → every authenticated request redirects to `/change-password`.
- Soft-deleted users (`deletedAt`) cannot log in; their history stays as text.
- `SESSION_SECRET` was **removed** (Phase 3): it was never referenced in `src/` —
  sessions are DB-backed, no JWT signing.
- Security headers in `next.config.ts` (HSTS, `X-Frame-Options: DENY`, nosniff,
  referrer-policy, permissions-policy, CSP-ish defaults).
- Mutating API calls go through a same-origin check in `src/lib/api.ts`.
- `AuditLog` records auth, admin and destructive actions.
- Forgot-password: 5 requests per identifier + 20 per IP per 15 minutes (in-process
  fixed window, `src/lib/rateLimit.ts`) with the same generic response, so it cannot be
  used to enumerate accounts. The raw reset token is **not logged by default**;
  `AUTH_LOG_RESET_TOKEN=1` is a local-debug opt-in only.
- The limiter is per-instance (like SSE) and `clientIp()` trusts the first
  `x-forwarded-for`; Vercel overwrites that header, but a self-hosted proxy must too.

---

## 7. Permissions & workflows

- **20 actions**: `view_project`, `create_task`, `edit_task_all`, `edit_task_own`,
  `delete_task`, `change_status`, `edit_estimates`, `change_priority`, `assign`,
  `manage_epics`, `manage_fields`, `manage_workflow`, `manage_automation`,
  `view_reports`, `export`, `import`, `manage_members`, `manage_archive`, `comment`,
  `bypass_transitions`.
- Roles are **editable rows** (`Role.permissions` JSON), not hard-coded. A user can
  hold several roles per project; `mergeRoles` unions permissions and takes the most
  permissive field rule.
- **Field-level rules**: `hidden` / `readonly` / `editable` per task field.
- **Super Admin** bypasses all checks (`getMembership` returns an all-true membership).
- **Designation** on `User` is a Role id; renaming the role updates every display
  (`src/lib/designation.ts` is the single sync/repair helper).
- Workflow: `Status` rows per project + a `StatusTransition` graph that is the **single
  source of truth** — a move is allowed only when an explicit transition row exists (no
  forward-only rule). `StatusDesignationTag` (role ids) gates who may *enter* a status;
  the "Assign step" dialog runs when a transition requires assignment. Bypass is the
  explicit `bypass_transitions` permission (Project Manager only by default); Super
  Admins always bypass. See §10 for the migration/backup rules.

---

## 8. HTTP surface

**Pages (19)** — all under `(app)` require a session; all are dynamic (SSR):
`/` (dashboard), `/calendar`, `/users`, `/profile`, `/admin/{users,roles,audit}`,
`/p/[id]/{board,table,timeline,reports,workload,archive,members,settings}`,
plus public `/login`, `/forgot-password`, `/change-password`, `/no-access`.

**API (44 route handlers)** grouped:
- Auth: `POST /api/auth/login|logout|forgot|change-password`, `GET /api/auth/me`,
  `GET/DELETE /api/auth/sessions`.
- Projects: `/api/projects`, `/api/projects/[id]` (+ `settings`, `members`,
  `workflow`, `fields`, `lookups`, `epics`, `automation`, `views`,
  `activity`, `export`, `import`, `holidays`).
- Tasks: `/api/projects/[id]/tasks`, `.../tasks/bulk`, `.../tasks/[taskId]`
  (+ `comments`, `links`, `timer`).
- Realtime: `/api/events`, `/api/projects/[id]/events` (SSE).
- Everything else: `/api/calendar`, `/api/holidays`, `/api/working-days`,
  `/api/notifications`, `/api/dashboard/export`, `/api/profile`,
  `/api/profile/email`, `/api/users`, `/api/users/[id]`, `/api/users/[id]/avatar`,
  `/api/users/[id]/projects`, `/api/admin/{roles,audit}`.

---

## 9. Domain rules worth knowing

- **Completion** is category-based (`todo` / `inprogress` / `done`), not "status
  name == Done". Dashboard, board, table and calendar all read the same helpers.
- **Overdue** = open task with `dueAt` in the past (per project timezone/holiday rules).
- **Timers**: `startedAt` = first ever Start (never reset); `stageEnteredAt` = open
  segment; `totalSeconds` = closed segments; `TaskStageTime` = per-stage history.
  A running timer past its due point counts as "timer overdue".
- **Working days / holidays**: `Holiday` supports ranges; `WorkingDayException`
  overrides a project's standard week; used by timeline, calendar, workload, reports.
- **Board** columns are statuses ordered by `position`; drag = `change_status` +
  transition check. **Table** and **Board** share the same store and refresh together.
- **Exports**: XLSX (`xlsx`) and PDF (`jspdf`), client-side downloads from API payloads.

---

## 10. Database & deployment

### Local (default)
```
DATABASE_URL="file:./dev.db"
```
Adapter: `PrismaBetterSqlite3`. `prisma.config.ts` always points the **CLI**
(migrate/generate/seed) at this local file, because Prisma Migrate cannot talk to
Turso over HTTP.

### Production (Vercel)
Vercel's filesystem is **read-only**, so a SQLite *file* cannot work → login pages
500'd. The app therefore supports a remote **libSQL/Turso** database:

```
TURSO_DATABASE_URL="libsql://<db>-<org>.turso.io"
TURSO_AUTH_TOKEN="..."
APP_URL="https://<app>.vercel.app"
```
`src/lib/db.ts` picks the adapter at runtime; `usesRemoteSqlite` exposes the choice
(used by the avatar route: DB blob vs local file). Remote adapter is imported from
`@prisma/adapter-libsql/web` — **no native module**, safe on serverless.

Migrations:
```powershell
$env:TURSO_DATABASE_URL="libsql://..."
$env:TURSO_AUTH_TOKEN="..."
npm run turso:backup      # read-only snapshot → backup/turso-<timestamp>.db (verified)
npm run turso:migrate     # replays prisma/migrations, tracks _applied_migrations, idempotent
npm run seed -- --reset   # demo data (wipes first)
```

As of **2026-10-31** production Turso is **23/23 migrated** (including
`Comment.solvedAt`); a verification run reported "database is already up to date".
`turso:backup` copies all 28 tables, verifies row counts and foreign keys, and is
git-ignored; the file contains personal data and password hashes, so treat it as sensitive.
`turso:migrate` reads `.env` (plain Node + `dotenv`), while `next dev` reads
`.env.development.local` first - see §11.

### Region alignment (performance critical)
`vercel.json` pins the function region to **`bom1` (Mumbai)** to match the Turso DB in
**`aws-ap-south-1` (Mumbai)**. Vercel's default is `iad1` (US East); with a Bangladesh
user base that added ~220 ms to *every* dynamic request, on top of ~13 DB round trips
per dashboard. If the DB ever moves, the function region must move with it
(`bom1` ↔ `aws-ap-south-1`, `sin1` ↔ `aws-ap-southeast-1`).

---

## 11. Local development

```powershell
npm install
Copy-Item .env.example .env      # then edit if needed
npx prisma migrate deploy        # or: npx prisma migrate dev
npm run seed -- --reset
npm run dev                      # http://localhost:3000
```

Demo login: `admin` (or `admin@demo.local`) / **`Demo1234!`** — all seeded users share
that password and are forced to change it on first login. Other demo users:
`pm`, `saju`, `shovon`, `sumit`, `apon`, `viewer`.

> **Local vs remote credentials:** `.env.development.local` sets empty `TURSO_*` values so
> `next dev` stays on `dev.db`; `.env` keeps the real Turso credentials used by
> `turso:migrate` / `turso:backup` (plain Node scripts read `.env`, not the Next.js
> development override).

| Script | Purpose |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` / `start` | Production build / serve |
| `npm test` | Vitest (runs `scripts/pretest.mjs` first) |
| `npm run seed -- --reset` | Wipe + demo data |
| `npm run admin:create` | Create/repair super-admin |
| `npm run turso:migrate` | Migrations → Turso |
| `npm run turso:backup` | Read-only verified snapshot of Turso → `backup/` |
| `npm run turso:copy-local` | Copy `dev.db` data → Turso |
| `npm run db-push` | `prisma db push` (quick sync, no migration file) |

---

## 12. Testing

- Vitest, node environment, **19 files / 256 tests**.
- `scripts/pretest.mjs` builds throwaway SQLite databases **from the committed
  migrations** (not `db push`), so tests validate the migration chain.
- Tests use `makeTestClient(url)` from `src/lib/db.ts`.
- Coverage areas: auth, permissions, projects, tasks, calendar, holidays, lookups,
  labels, reports, session info, timeline, timer, users, domain, pdf, rate limiting.
- Current status: `tsc --noEmit` clean, 256/256 pass. `next build` is blocked in this
  environment only by the Google Fonts fetch (network), not by code.

**Rule: never edit an applied migration.** Add a new timestamped migration instead,
otherwise `turso:migrate` and `pretest.mjs` diverge.

---

## 13. Conventions & gotchas

1. **Next 16** — read `node_modules/next/dist/docs/` before using Next APIs. `params`
   and `searchParams` are Promises in App Router APIs; route handlers are `async`.
2. **Prisma 7 + driver adapters** — there is no `url` in `datasource`; the client is
   built with an adapter. Use `db` from `src/lib/db.ts`; use `makeTestClient` in tests.
3. **`prisma generate` after schema changes** — the generated client is not committed;
   forgetting it produces `Property 'x' does not exist on type 'PrismaClient'`.
4. **Local npm install on Windows** — `better-sqlite3@13` ships no `install` script, so
   npm falls back to `node-gyp rebuild` and fails without Python/MSVC. A temporary
   `^12.11.1` was used for verification; `package.json` was restored to `^13.0.3`
   afterwards. Vercel (Linux) installs it fine.
5. **`SESSION_SECRET` was removed** (Phase 3) — sessions are opaque and DB-backed, so do
   not assume signed cookies.
6. **Avatars** — local installs write files under `public/uploads/`; serverless stores
   bytes in `UserAvatar` and serves them from `/api/users/[id]/avatar` with a
   versioned, immutable, CDN-cacheable URL.
7. **SSE on serverless** — in-process pub/sub means events only reach clients hitting
   the same instance; clients fall back to **15 s polling** (`useProject.ts`). The
   connection is recycled after ~5 min, causing repeated invocations.
8. **`instrumentation.ts` timer sweep** — unreliable on serverless; timers are also
   derived lazily on read.
9. **Git** — the repository exists (`.git`), but the `git` CLI is **not on PATH** in
   this environment. All current work may be **uncommitted**.
10. **Bangla UI strings** are user-authored content in seed data/reports; keep them.
11. **Environment split** — `.env.development.local` (empty `TURSO_*`) keeps local dev on
    `dev.db`; `.env` holds the real Turso credentials for `turso:migrate` / `turso:backup`.
    Never commit either file.
12. **Backups are sensitive** — `backup/turso-*.db` contains emails, bcrypt hashes and
    avatars; `backup/` is git-ignored. Do not upload/share; delete when done.
13. **The GitHub repo is public** — source only. The 2026-10-31 audit found no real
    credential in 210 tracked files or in history, but never force-add `.env`, `dev.db`,
    backups or uploads.
14. **Rate limiting is in-process** — `src/lib/rateLimit.ts` is per instance (like SSE); on
    serverless it is best-effort, not a global quota.

---

## 14. Current state (2026-10-31)

- **Phase 16 (2026-10-25 → 10-31) — drawer/table/members/workflow/solve + security:**
  - Drawer header: epic badge + issue type + editable title, task menu + **Close (Esc)**;
    the project name was removed. **Assigned by** moved into Properties and is
    `assign`-gated (server-enforced).
  - Notes **Solve**: `Comment.solvedAt`, display-only `(solved)` marker, edit clears it;
    migration `20261025130000_comment_solved` is applied locally and on Turso.
  - Workflow Settings: presets-only statuses, transition presets + `+ Add all missing`;
    GET 500 fixed (`StatusDesignationTag.text` → `roleId`), PATCH `designationRoleIds`
    fixed, POST returns real errors.
  - Table: **Description** column always visible beside the title; Epic filter/column
    removed (`Group: Epic` and the Excel Epic field remain); stale layouts cleaned.
  - Members: single **Role / Designation** column. Project header: project role/designation.
  - Security: reset-token logging opt-in (`AUTH_LOG_RESET_TOKEN`), forgot-password rate
    limit, exposure audit (no secrets in git/GitHub; live 404/401), Turso verified 23/23,
    `npm run turso:backup` added.
  - Verification: `tsc --noEmit` clean; **256/256 tests (19 files)**; local dev on `dev.db`.
- Phase 14: Vercel + Turso serverless support (`db.ts` dual adapter, `migrate-turso.mjs`,
  `prisma.config.ts`, env docs, README/PLAN).
- Phase 15: latency work — `vercel.json` region `bom1`, React-`cache`d `getViewer`,
  parallel `loadProject` first queries, `s-maxage` on avatars.
- `UserAvatar` model + migration `20261019120000_user_avatar` + DB-backed avatar route
  (applied to Turso; production is 23/23 as of 2026-10-31).
- **Refactor Phases 0–4 (2026-10-25)**:
  - Phase 0 — safety backup in `backup/pre-refactor/` (`backup/` is git-ignored and
    excluded from `tsconfig.json`).
  - Phase 1 — Role = Designation (one sync helper, live names, one-time repair),
    transitions as the single source of truth, `bypass_transitions` bypass flag,
    role-id "suggest designations", server-side field-rule + hidden-field enforcement.
    Migration `20261024180634_role_designation_and_transition_enforcement`.
  - Phase 2 — `User.gender`; editable, password-confirmed username.
    Migration `20261024182114_add_user_gender`.
  - Phase 3 — removed the unused `Sprint` model/columns, `getAllowedTransitions()` and
    `SESSION_SECRET`; evidence in `CLEANUP_REPORT.md`.
    Migration `20261024182738_drop_legacy_sprint_model`.
  - Phase 4 — **Liquid Glass** visual layer in `globals.css` (tokens + `.glass*`
    classes); light + dark, reduced-motion/-transparency and no-`backdrop-filter`
    fallbacks.
  - Verification after the refactor: `prisma generate`, `tsc`, **212 tests at the time**
    (suite is now 256), build — all green. All three migrations are applied to Turso
    (production 23/23 on 2026-10-31).

Verified live on `https://its-task-tracker.vercel.app` (2026-10-24):

| Probe | Result |
|---|---|
| `/login` (static) | 200, TTFB ~175 ms, `X-Vercel-Cache: HIT` |
| `/api/auth/me` (dynamic, no cookie) | 401, TTFB ~185 ms, `X-Vercel-Id: bom1::bom1::…` |
| `POST /api/auth/login` (unknown user) | 401 (not 500) → Turso lookup works; ~210 ms warm, ~410 ms cold |

The region fix is confirmed working: dynamic TTFB dropped from ~390 ms (function in
`iad1`) to ~185 ms (function in `bom1`, next to the Turso database).

Open items:
- **Push & deploy:** the current tree (drawer/table/members/workflow/Solve + security
  hardening) is uncommitted/unpushed; the live site still serves the 2026-10-25 build.
  Deploying is the owner's step (no `git`/Vercel CLI in this environment).
- Change the demo `admin` password and deactivate demo accounts in production.
- Optional: disable SSE on serverless (polling-only) to cut function invocations.
- **Paused by the owner (2026-10-31):** slow data load / realtime status-refresh work.
  Do not start it without a new request.

---

## 15. How to work on this project

1. Run `npm test` and `node node_modules/typescript/bin/tsc --noEmit` before and after
   changes; `npm run build` before declaring success.
2. For schema work: edit `prisma/schema.prisma` → new migration folder → `prisma generate`.
3. Keep the **SQLite dialect** and the migration chain intact; remote Turso must remain a
   drop-in.
4. Server components fetch data directly via `src/lib/*`; mutations go through
   `/api/*` route handlers with `requireUser` + permission checks. Follow that split.
5. Every project-scoped page starts with `loadProject()` and uses the returned
   `ProjectContext` (project, membership, perms, field rules).
6. Respect the naming and structure of `src/lib` domain modules rather than adding
   ad-hoc queries in components.
7. When touching deployment, keep `vercel.json` region and the Turso region aligned.
8. **Back up before migrating:** run `npm run turso:backup` before `npm run turso:migrate`
   or any schema/data change against Turso, and verify the snapshot exists. Never edit an
   applied migration; add a new one (the chain is append-only and shared with production).
9. **Never commit sensitive files:** `.env`, `.env.development.local`, `dev.db`,
   `backup/` and `public/uploads/` stay local and git-ignored. The GitHub repository is
   public - check `git status` before staging anything.
10. **Server permissions are the source of truth:** assign/claim, field edits and workflow
    moves must be enforced in the API, not only hidden in the UI. Use
    `requireProjectPermission` / `getMembership` and the `ACTIONS` flags.
11. **Keep SQLite/Turso compatibility:** use portable Prisma types and migrations that run
    on both `better-sqlite3` and libSQL; no provider-specific SQL or native-only APIs.
12. **Do not restart paused work** (realtime status refresh / slow-load investigation)
    without an explicit request from the owner.
