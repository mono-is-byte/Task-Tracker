# Changelog

Notable changes to **TaskTracker**, recorded in the spirit of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The repository has no tagged releases yet, so everything below belongs to the current
unreleased development line (whose running record lives in [PLAN.md](./PLAN.md)).
Release sections will be added here as versions are tagged.

## [Unreleased]

### Added

- **Table Description column**: the board description now appears in the Table as a
  **Description** column beside the task title and is always visible (it is excluded from
  the Hide-column picker; stale saved layouts that hid it are cleaned on load).
- **Workflow presets**: Settings → Workflow adds statuses from preset chips only (no manual
  name/category/colour form) and transition flows from preset chips, each with
  `+ Add all missing`; presets remain selectable at any time.
- **Notes Solve**: comments, remarks and feedback gain a **Solve** action that shows a
  display-only `(solved)` marker beside the note; editing the note clears `solvedAt` and
  brings the button back. Persisted as nullable `Comment.solvedAt` (migration
  `20261025130000_comment_solved`).
- **`npm run turso:backup`**: read-only full snapshot of the remote Turso database into a
  verified local SQLite file under `backup/` (row counts + foreign-key check; records
  `_applied_migrations`).
- **Role = Designation with one source of truth**: a user's designation is a Role id
  kept in sync by a single helper (`src/lib/designation.ts`); every screen renders the
  role's live name and shows "No role" when unset. A one-time repair pass
  (`npm run repair:designations`) fixes stale rows.
- **Real workflow enforcement**: a status move is allowed only when an explicit
  transition row exists - transitions are the single source of truth. The forward-only
  rule is gone and bypass is an explicit `bypass_transitions` permission flag (Project
  Manager only by default, editable on the Roles page). Super Admins bypass.
- **Per-status suggested designations** are picked from real roles (multi-select of role
  ids) instead of free text.
- **Field-level rules** (`hidden` / `readonly` / `editable`) are enforced server-side on
  create, edit, bulk and import; hidden fields are stripped from every response.
- **Profile: optional gender + editable username** - gender (Male / Female / Other /
  Prefer not to say) shows in Profile and Users; the username change is
  password-confirmed, audited, rate-limited and checked case-insensitively (soft-deleted
  accounts included). Login still accepts an email **or** a username.
- **Liquid Glass UI** across the whole app (light + dark) built from Tailwind v4 `@theme`
  tokens plus reusable `.glass*` classes, with solid fallbacks for
  `prefers-reduced-transparency` and browsers without `backdrop-filter`, and no motion
  under `prefers-reduced-motion`.
- **Board (Kanban)** with drag-and-drop status changes, per-column quick-add and
  over-limit `WIP!` badges.
- **Table view** with inline editing, filters, sortable and resizable columns, row
  deletion behind a confirmation dialog, and a hidden-column/width layout remembered per
  project and device.
- **Task drawer** for comments, remarks, feedback, activity history, task links
  (`blocks` / `relates`), labels, custom fields and the Git branch.
- **Timeline** over the whole project: Day / Week / Month zoom, **Fit entire project**, a
  today-marker axis, and start → due bars falling back to timer instants.
- **Calendar** (month/week) with a My/All toggle, project and assignee filters, a colour
  legend, holiday tinting and PDF export.
- **Holiday management** in Calendar Settings - add/edit date-range holidays with
  duplicate and reversed-range validation - plus **working-day exceptions** that open the
  office without deleting the holiday.
- **Dashboard** with KPI cards, a completion bar, status/priority/member distributions,
  "assigned to me", the QA queue, overdue work and recent activity - exportable to PDF
  and Excel.
- **Workload** view against per-project and per-user working hours, honouring holidays
  and working-day exceptions.
- **Reports** with status distribution, open tasks per assignee, a standalone
  **QA Queue - In Testing per Tester** section, estimate vs actual and overdue -
  exportable to PDF.
- **Per-project workflow** editing (statuses, transitions with allowed roles) with
  explicit transitions as the single source of truth, a manager bypass and status-only
  moves for QA.
- **Multi-role membership** with union permissions, a role × action matrix and
  field-level rules (`hidden` / `readonly` / `editable`), enforced server-side on every
  endpoint.
- **Automation rules** per project: stamp dates on status change, notify the tester or
  assignee, and clear the end date on re-open.
- **Task timer** per stage with `NONE` / `TRACK` / `FINAL` timer roles, derived state and
  auto-stop when the task moves on.
- **Notifications** bell with an unread counter, task deep links and mark-all-read.
- **Realtime updates** over SSE (`/api/projects/:id/events`) with a 15-second polling
  fallback.
- **Cookie-session auth**: opaque tokens stored as SHA-256 hashes, login rate limiting
  and lockout, absolute/idle expiry, remember-me, forced password change on first login,
  a self-service **Active Sessions** list with single/other revocation, and self-service
  email and password changes.
- **Administration**: users directory with avatars and soft deletes, designations that
  reference roles, and an audit log for logins, lockouts, permission changes and resets.
- **Import / export**: Excel (.xlsx) export of the filtered table view plus CSV/Excel
  import using the exact spreadsheet column names, per-row reporting of unknown values
  and `PREFIX-N` dependency keys.
- **Theming and shell**: light/dark theme persisted per device and profile without a
  first-paint flash, a collapsible sidebar (desktop icon rail, mobile overlay drawer) and
  a shared icon set.
- **Bangla-safe search**: NFC-normalized, case-folded matching with the Noto Sans Bengali
  font loaded as a fallback.
- **Serverless / Turso support**: the app talks to a remote libSQL/Turso database when
  `TURSO_DATABASE_URL` is set; `npm run turso:migrate` replays the committed migrations
  there idempotently, and `npm run admin:create` creates or repairs a fixed super-admin
  account on whichever database the environment selects; `npm run turso:copy-local`
  copies an existing local `dev.db` up to Turso, replacing the remote data.
- **Serverless avatars**: when the filesystem is read-only, the uploaded JPEG is
  stored in the database (`UserAvatar` table) and served from
  `/api/users/<id>/avatar`; local installs keep writing `public/uploads/avatars`.

### Changed

- **Table Epic removal**: the `All epics` filter and the Epic column are gone from the
  Table; `Group: Epic` and the Excel export keep their Epic field. Old saved layouts that
  hid `epic` are sanitised on load.
- **Members page**: Designation and project roles are merged into one **Role / Designation**
  column (project roles first, designation fallback, case/space-insensitive de-duplication).
- **Project header**: the badge beside the project name now shows the viewer's project
  role(s) or designation (falling back to the global role only when neither exists) instead
  of `Super Admin` / `Team member`.
- **Task drawer header**: epic badge, issue type and editable title, with the task menu and
  **Close (Esc)**; the project name is no longer shown. **Assigned by** moved into
  Properties, and assigning/reassigning/claiming requires the `assign` permission
  (server-enforced).
- **Table and board time columns** now show **Development time** (tracked in the
  “In Progress” stage), **Testing time** (tracked in “In Testing”) and their **Total time**;
  board cards show only the times relevant to their column - Development in In Progress /
  Development Done, all three from In Testing onwards. The old Start time, Due time and
  Timer columns are gone.
- **Workflow denials on the board** now revert the drag and raise a toast (the API
  answers 403), and columns a task cannot legally move to are dimmed as a hint.
- **Settings → Workflow** shows **live role names** in the suggestion and transition
  pickers, and help text that matches the enforced rules.
- **Comments "viewers may comment"** is keyed off permissions instead of the
  `Viewer / Stakeholder` role name.
- Board, Table, Timeline and Reports share **one task store per project** - optimistic
  updates with rollback and SSE refresh, so a change in one view appears in the others
  immediately.
- **Designations** became references to Roles & Permissions roles instead of a separate
  catalog; pickers render users as `Name - Designation` and the Roles page counts
  holders.
- **Assignees and testers** are drawn from the whole user directory (any non-deleted
  user), not just project members; deactivated accounts stay selectable and are labelled
  *inactive*.
- **Est. Days** is always calculated (`Est. Hours ÷ hours-per-day`, configured per
  project); the `SL` and `Est. Days` columns are ignored on import.
- The **Profile page** centres a single card (name/avatar, email change, password change)
  with Active Sessions below it; the per-user capacity override is no longer edited there
  (stored values and project settings still drive capacity maths).
- **Settings** is a stack of per-section cards (priorities & issue types, automation
  rules, workflow, transitions, members) sharing one heading/helper/spacing pattern that
  stacks on narrow screens.
- Table and board interactions polished: icon-only row actions, an Edit-project dialog
  that is portaled and works on every page, calendar tasks spanning start → end, and a
  project menu that closes on any outside click.

### Fixed

- **npm 11 `install-scripts` advisory**: `package.json` now records `allowScripts` for the
  reviewed native/install dependencies (`better-sqlite3`, `@prisma/engines`, `esbuild`,
  `prisma`, `core-js`), so Vercel builds no longer list them as unreviewed. The field is
  advisory in npm 11; the scripts still run.
- **Workflow API**: `GET /api/projects/[id]/workflow` no longer 500s (it selected the
  retired `StatusDesignationTag.text`; it now returns `designationRoleIds`), and PATCH no
  longer ignores role suggestions (`designationTags` → `designationRoleIds`). POST returns
  real duplicate / same-status / cross-project errors.
- **Stale table layouts** that hid the retired `epic` column (or the always-visible
  `description`) are cleaned on load, so the Hide/Show-column pickers never show blank
  options.
- **Fresh-database seeding** no longer crashes: writes to columns that no longer exist
  were removed, and seeded designations now reference role ids.
- Quick-created and edited tasks render fully - create/update responses return the
  complete serialized row instead of leaving stale chips in Board/Table.
- **Project Settings no longer blanks** when a single card's fetch is forbidden; each
  section loads on its own.
- Deleting a project option (priority / issue type) that tasks still use asks for a
  replacement and moves those tasks in the same server-side request.

### Security

- **Reset-token logging is opt-in**: the forgot-password route logs only that a reset was
  requested; `AUTH_LOG_RESET_TOKEN=1` enables raw-token logging for local debugging only.
- **Forgot-password rate limit**: 5 requests per identifier and 20 per IP per 15 minutes
  (`src/lib/rateLimit.ts`, in-process; per-instance on serverless), with the same generic
  response so the limiter cannot be used to enumerate accounts.
- **Exposure audit (2026-10-31)**: 210 tracked files contain no real `.env` values and no
  `.env` / `dev.db` / `backup/` / `public/uploads/` files; the GitHub history (one branch,
  no tags) never contained them. The repository is public (source only). Live `/.env`,
  `/dev.db`, `/.git/config` → 404; unauthenticated `/api/auth/me` and `/api/users` → 401.
- **Production Turso verified fully migrated** (23/23, `Comment.solvedAt` present), so the
  current tree is schema-safe to deploy. `npm run turso:backup` takes a verified read-only
  snapshot first.
- **Backup files are sensitive**: `backup/turso-*.db` holds emails, bcrypt password hashes
  and avatars. It is git-ignored and local-only; never commit, upload or share it.

### Removed

- **Story feature and Story Points** (2026-10-25): the `Story` model, `Task.storyId`,
  `Epic.stories`, the Story API/UI/import/export and `Task.storyPoints` /
  `Project.pointScale` (migrations `20261025120000_remove_story`,
  `20261025121000_remove_story_points`). "Story" remains available as an **issue type**;
  retained story data lives in `backup/stories-export.json`.
- **Dead code and one-off scripts**: removed unused components/helpers/re-exports
  (`IconSearch`, `todayISO`, `setUserDesignation`, `holidayOverlapsRange`,
  `onSidebarChange`, `getTask`, `useTaskMutations`, `useTaskStoreLifecycle`, plus
  unreferenced types/constants and stale auth/server re-exports) and the undocumented
  `check-contrast.mjs` / `merge-local-to-turso.mjs` scripts. Documented CLI scripts are
  unchanged; type-check, the 256-test suite and the production build stay green.
- **Sprints** completely: the `Sprint` table plus `Story.sprintId` and `Task.sprintId`
  (migration `20261024182738_drop_legacy_sprint_model`), the unused
  `getAllowedTransitions()` helper, and the never-read `SESSION_SECRET` env var (removed
  from `.env.example` and the docs). See `CLEANUP_REPORT.md`.
- **WIP-limit editing** from Settings; stored limits still drive the board's over-limit
  badges.
- Legacy `Designation` / `StatusDesignation` tables and the write-only `User.locale` /
  `User.notifyPrefs` columns (migration
  `20261019000000_drop_legacy_designation_structures`).
