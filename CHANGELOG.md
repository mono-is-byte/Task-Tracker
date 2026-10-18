# Changelog

Notable changes to **TaskTracker**, recorded in the spirit of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The repository has no tagged releases yet, so everything below belongs to the current
unreleased development line (whose running record lives in [PLAN.md](./PLAN.md)).
Release sections will be added here as versions are tagged.

## [Unreleased]

### Added

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
- **Holiday management** in Calendar Settings — add/edit date-range holidays with
  duplicate and reversed-range validation — plus **working-day exceptions** that open the
  office without deleting the holiday.
- **Dashboard** with KPI cards, a completion bar, status/priority/member distributions,
  "assigned to me", the QA queue, overdue work and recent activity — exportable to PDF
  and Excel.
- **Workload** view against per-project and per-user working hours, honouring holidays
  and working-day exceptions.
- **Reports** with status distribution, open tasks per assignee, a standalone
  **QA Queue — In Testing per Tester** section, estimate vs actual and overdue —
  exportable to PDF.
- **Per-project workflow** editing (statuses, transitions with allowed roles) with
  forward-only enforcement, a manager bypass and status-only moves for QA.
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
  import using the exact spreadsheet column names, per-row reporting of unknown values,
  automatic user-story creation and `PREFIX-N` dependency keys.
- **Theming and shell**: light/dark theme persisted per device and profile without a
  first-paint flash, a collapsible sidebar (desktop icon rail, mobile overlay drawer) and
  a shared icon set.
- **Bangla-safe search**: NFC-normalized, case-folded matching with the Noto Sans Bengali
  font loaded as a fallback.

### Changed

- Board, Table, Timeline and Reports share **one task store per project** — optimistic
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

- **Fresh-database seeding** no longer crashes: writes to columns that no longer exist
  were removed, and seeded designations now reference role ids.
- Quick-created and edited tasks render fully — create/update responses return the
  complete serialized row instead of leaving stale chips in Board/Table.
- **Project Settings no longer blanks** when a single card's fetch is forbidden; each
  section loads on its own.
- Deleting a project option (priority / issue type) that tasks still use asks for a
  replacement and moves those tasks in the same server-side request.

### Removed

- **Sprints** from the UI and API (the underlying tables are kept — no data was
  destroyed).
- **WIP-limit editing** from Settings; stored limits still drive the board's over-limit
  badges.
- Legacy `Designation` / `StatusDesignation` tables and the write-only `User.locale` /
  `User.notifyPrefs` columns (migration
  `20261019000000_drop_legacy_designation_structures`).
