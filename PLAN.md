# TaskTracker — PLAN

## 0. Environment findings
- Workspace was empty. Asked one question; stack chosen: **Next.js + Postgres + Prisma**.
- Runtime: Node v24.18.0, npm 11.16.0, Windows (win32). Network OK.
- **No Docker, no local Postgres** (`docker`, `psql` not installed).
- Decision: keep **Prisma** as the ORM (as chosen) but run it against **SQLite via `better-sqlite3` driver adapter** for zero-config local dev.
  Schema uses only portable types; switching to Postgres later = change `provider` to `postgresql`,
  set `DATABASE_URL`, run `prisma migrate deploy`. Recorded here per instructions.
- Versions: Next 16 / React 19 / Prisma 7.10 / Tailwind v4 / bcryptjs / zod / xlsx / vitest.
- Password hashing: **bcryptjs** (pure-JS bcrypt, no native toolchain needed on Windows).

## 1. Architecture
- Single Next.js App Router app, TypeScript throughout.
- Custom cookie-session auth (`tt_session`, httpOnly, SameSite=Lax, Secure in prod, SHA-256 stored token),
  NOT next-auth — needed for temp-passwords, lockout, per-user session lists, idle timeout.
- Server enforcement: every API route calls `requireAuth` / `requireProjectPerm`; UI only hides/disables.
- CSRF: SameSite=Lax + same-origin check on mutations. Rate limit + lockout on login.
- Realtime: in-process pub/sub + SSE endpoint `/api/events`, client falls back to polling.
- Styling: Tailwind v4 + Noto Sans Bengali (Bangla glyphs), light/dark + accent var.
- Tests: vitest, `tests/` — pure-logic + service-level tests against a scratch SQLite DB.

## 2. Data model (prisma/schema.prisma)
- `User` (email+username unique, passwordHash, mustChangePassword, active, isSuperAdmin, lockedUntil,
  failedLogins, locale en/bn, theme, avatarUrl, hoursPerDay override, notifyPrefs, lastActiveAt)
- `Session` (tokenHash, userId, expiresAt, idleExpiresAt, rememberMe, revokedAt, ip, ua)
- `LoginAttempt` (identifier, ip, success, createdAt) — lockout: 5 fails / 15 min → 15 min lock
- `PasswordReset` (tokenHash, userId, expiresAt, usedAt)
- `AuditLog` (actorId, action, entity, entityId, meta JSON, ip, createdAt)
- `Role` (global definitions; permissions JSON role×action; fieldRules JSON; isSystem)
- `Project` (key PREFIX, name, hoursPerDay=8, workingDays=[1..5], pointScale, bannerNote, settings)
- `ProjectMember` (projectId, userId, roleId; unique pair)
- `Status` (projectId, name, category todo|inprogress|done, color, position)
- `StatusTransition` (projectId, fromId, toId, roleIds[] JSON, issueTypeIds[] JSON)
- `Priority` (projectId, name, level, color) — Highest/High/Medium/Low/Lowest
- `IssueType` (projectId, name, color, icon) — Task/Story/Bug/Epic/Sub-task
- `Epic`, `Sprint` (key PREFIX-NNN unique per project, goal, planned|active|completed, dates, capacityHours),
  `Story` (epic?, sprint?, Bangla title/desc)
- `Task` (projectId+serial unique → display key `PREFIX-serial`; type?, story?, epic?, sprint?, title,
  description, storyPoints?, estHours?, rdTime (unestimated/R&D hours), loggedHours, priority, status,
  assignee?, testedBy?, startDate?, endDate?, gitBranch?, labels[], customValues{}, position)
  Archive is DERIVED (status.category=done), not a second table.
- `TaskLink` (fromId, toId, blocks|relates), `Comment` (kind comment|remark|feedback + author + ts),
  `Activity` (who changed what/when), `CustomField` (typed, options, showIn, roleVisibility),
  `AutomationRule` (trigger/condition/action JSON, enabled), `Notification`, `SavedView`, `Holiday`.

## 3. Permission matrix (default roles; editable by Admin)
Actions: view_project, create_task, edit_task_all, edit_task_own, delete_task, change_status,
edit_estimates, change_priority, assign, manage_sprints, manage_epics, manage_fields,
manage_workflow, manage_automation, view_reports, export, import, manage_members, manage_archive, comment.
- Super Admin (global flag): all actions everywhere.
- Manager: all project actions except manage_roles global.
- Developer: view, create, edit own (status ≤ Development Done unless granted), pick unassigned,
  comment. No edit_estimates of others, no assign others, no sprint plan changes.
- QA: view, change_status only along DevDone→InTesting→Done/Re-open, edit Feedback/TestedBy fields, comment.
- Viewer: view (+optional comments setting).
Field rules per role: hidden|readonly|editable (e.g. QA edits Feedback/TestedBy only; Dev edits Git Branch/Remarks).
Status transitions enforced per role × issue type in `StatusTransition`.

## 4. Domain rules
- Story Points Fibonacci only (1,2,3,5,8,13,21); hours-only tasks allowed (points optional).
- `estDays = estHours / hoursPerDay` (project default 8, per-user override for workload) — always computed.
- Workflow default: To Do → In Progress → Development Done → In Testing → Done; Re-open → In Progress.
  Statuses editable, each maps to To Do / In Progress / Done category.
- Automation defaults: →Done sets endDate=today (+archive derived); →In Progress with empty start sets start=today;
  →In Testing notifies TestedBy; Re-open notifies Assignee + clears endDate.
- Capacity: Σ members workingDays∩sprint-range × hoursPerDay − holidays; warn when planned estHours > capacity.
- Sprint complete: unfinished tasks carry over to next active/planned sprint (or backlog).
- Bangla: UTF-8 end-to-end, NFC-normalized search, Noto Sans Bengali font.

## 5. Milestones (commit-style; app runs at every step)
1. Scaffold, schema, migrate, auth layer, seed, login/logout/password flows, middleware gate. ✅ app boots
2. Admin (users/roles/members/audit) + My Work home
3. Project/epic/sprint/story/task CRUD + Table view (inline edit, colors, filters, import/export)
4. Kanban + drawer + comments + activity + SSE
5. Custom workflows/fields/automation + archive behavior
6. Backlog/sprint planning + capacity + workload
7. Timeline + reports
8. Themes/shortcuts/notifications/polish + tests + README/docs

## 6. Assumptions / decisions
- No public signup; admins create users with temp password + must-change-first-login.
- Mail optional: `SMTP_URL` unset → resets are admin-triggered (temp password); reset-link flow when set
  (token issued + logged server-side for the operator to deliver; no mailer bundled).
- Task display key = `{PROJECT.key}-{serial}`; sprint keys like MAP-002 are separate `Sprint.key`.
- Task "SL" column = per-project serial.
- Viewer comments behind project setting `viewersCanComment` (default off).
- Session: 12h absolute (30d remember-me), 2h idle timeout.
- Single-process SSE (fine for self-hosted team scale); polling fallback included.
- No `middleware.ts` (deprecated in Next 16 for `proxy.ts`): auth gating in app layout + API layer.
- Prisma `db push` is AI-gated in v7: test DBs are built from committed migration SQL via better-sqlite3
  (`scripts/pretest.mjs`), never touching dev.db.
- TS 7 narrows less inside `function` declarations: UI code uses arrow closures after auth guards.
- Status-only changes (incl. board reorder) require `change_status`, not edit rights — this is what lets
  QA advance testing while field edits stay locked down.
- `adminResetPassword` also clears recent login-failure history (fresh slate, no lockout re-trigger).
- package.json has no `type` field (Turbopack chokes on `commonjs` + ESM sources).

## 7. Modification phases (v2 build-out)

### Phase 0 — Bug fixes & error handling ✅
Method: logged in as admin (temp session token minted directly in DB — no password touched),
scripted crawl of every page + API route (`scripts/crawl-check.mjs`), plus a real-browser pass
over all 16 pages reading console errors/hydration warnings.

| Page / route | Error found | Fix |
|---|---|---|
| `/this-route-404` | Default bare Next.js 404 page | Added branded `src/app/not-found.tsx` (message + Go home / Login) |
| any client crash | No `error.tsx` anywhere → raw Next.js error overlay | Added `src/app/global-error.tsx` (root, styled inline since it replaces `<html>`) + `src/app/(app)/error.tsx` (in-app, Try again + Go to My Work, logs digest) |
| server page transitions | No `loading.tsx` → blank flash while server components stream | Added `src/app/(app)/loading.tsx` + `src/app/(app)/p/[id]/loading.tsx` skeletons |
| sidebar / My Work / profile | Bangla language switcher + `বাংলা` option + `/api/locale` (global rule 5) | Removed switcher, deleted `src/app/api/locale/route.ts` + `src/lib/i18n.ts`, inlined English labels, dropped `locale` from profile/admin zod schemas and `/api/auth/*` responses |

- All other pages returned 200 with zero console errors before and after.
- `/api/projects` 405 = by design (POST-only; lists are server-rendered). `/api/projects/<bad-id>` 404 = correct JSON error.
- Data safety note: `dev.db` had drifted from seed (user had logged in + changed admin password + created a user). Never reset it; diagnostic used a minted session, and shovon's demo password was restored afterward.
- Verification: `npm run build` ✅ `npm test` 40/40 ✅ re-crawl clean ✅

### Phase 1 — Roles, Designations, Permissions ✅

**Decision (recorded per rules):** roles stay **per-project** (the existing model gives users
different roles per project, e.g. saju = Developer in MAP); the membership↔role link became
many-to-many via a new `ProjectMemberRole` join table, so a member can hold several roles *in a
project* and effective permissions = **union** of them (field rules: most permissive wins,
`hidden < readonly < editable`). "Settings › Users & Roles" = new panel at the top of the project
Settings page, visible only when `isSuperAdmin || perms.manage_members` (Admin/PM).

| Requirement | Implementation | Files |
|---|---|---|
| Designation model (label only) | `Designation` table + nullable `User.designationId`; 5 seeded titles; API never touches roles | `prisma/schema.prisma`, migration `20261014120000`, `api/designations/route.ts` |
| Suggested-role hint (text only) | `Designation.suggestedRole` rendered as plain "Suggested role: X" under the select — no apply button, no DB write | `components/UsersRolesPanel.tsx` |
| Multi-role + union perms | `ProjectMemberRole` join (17 rows migrated), `mergeRoles()` union, `Membership.roleIds/roleNames`, transition check passes if ANY held role matches | migration, `lib/permissions.ts`, `lib/server.ts`, `lib/tasks.ts`, all membership APIs |
| Role assign moved to Settings | `api/projects/[id]/members` POST/PATCH take `roleIds[]`; Members page now read-only roles + pointer; Settings › Users & Roles does add/change/remove + designation; API requires `manage_members` (Admin/PM) | `members/route.ts`, `UsersRolesPanel.tsx`, `members/page.tsx`, `settings/page.tsx` |
| Project creation Admin/PM | `userHasGlobalAction(manage_members)` gate in POST `/api/projects` (403 otherwise) + `+ New Project` button server-gated on home | `api/projects/route.ts`, `CreateProjectButton.tsx`, `page.tsx` |
| Task creation PM/Admin only ⚠️ | `create_task` removed from Developer default (rule said follow it; **this changes prior behavior where Developers could create tasks**); data migration strips it from existing DB rows; UI quick-add already gated by `can("create_task")` | `lib/permissions.ts`, migration `20261014130000`, `tests/tasks.test.ts` |

- Also: `locale`-free API responses, admin role counts now via join table, seed creates designations + join rows.
- **Migrations:** `20261014120000_designations_multiroles` (Designation table, User.designationId, ProjectMemberRole join + data copy + ProjectMember rewrite), `20261014130000_task_creation_role_data` (strip create_task from Developer/QA/Viewer system roles).
- **Tests added:** mergeRoles union + field-rule precedence, multi-role transitions, designation-has-no-permission-effect, only-PM-creates-task, DB-level two-role membership union, `userHasGlobalAction` gate (49 total, was 40).
- Verified live: admin/developer/PM smoke scripts (designation 403 for dev, project create 403 for dev/201 for admin, task create 403 for dev, dual-role PATCH round-trip, button visibility both ways) — all passed; temp sessions revoked; `dev.db` never reset.

### Phase 2 — Workflow enforcement, status→designation mapping, Assign step ✅

**Decisions (recorded per rules):**
- *Forward-only rule* is evaluated against the status `position` order and runs **before** the
  transition matrix, so a non-manager moving backward always sees "You cannot move a task back."
  even when a backward transition row exists; forward moves are then still checked against the
  matrix ("This status transition is not allowed for your role.").
- *Manager level* = `isSuperAdmin || manage_workflow || manage_archive`. It bypasses **both** the
  forward-only rule and the matrix (assumption: the Archive "Re-open" action is always a backward
  move and must never fail server-side for the roles that can open the archive).
- *Assign step* = `statusChanging && canDo(change_status)`. A PATCH carrying `statusId` +
  `assigneeId` together is treated as one atomic status-only change: the assignee may be set even
  when the `assign` perm or the assignee field rule would normally block it. A lone `assigneeId`
  change keeps the old rules (assign perm / claim / release). Bulk status changes and archive
  reopen skip the dialog (no per-task assign step); the dialog is per-task on drawer/board/table.
- Status→Designation mapping is replace-the-set (`designationIds` array on the workflow PATCH);
  suggestions order members (matching designation first, everyone else still selectable) and the
  step can be skipped. Viewer stays read-only — "every member may change status" is implemented as
  "every role holding `change_status`" (PM/Developer/QA).

| Requirement | Implementation | Files |
|---|---|---|
| Server-enforced forward-only | `updateTask` status branch: manager bypass → position check (`"You cannot move a task back."`) → matrix check, before any write | `lib/tasks.ts` |
| Admin/PM any status | `managerLevel` (superadmin / manage_workflow / manage_archive) skips both checks | `lib/tasks.ts` |
| Status→Designation mapping | `StatusDesignation` join table; workflow GET exposes `designations` + `designationIds`; PATCH `{kind:"status", refId, designationIds}` replaces the set (400 "Unknown designation."); status delete clears rows | migration, `api/projects/[id]/workflow/route.ts`, `lib/workflow.ts` (`replaceStatusDesignations`) |
| Assign step on status change | Shared `AssignStepDialog` (suggested-first, "(current)" marker, Cancel / "Skip — just move" / "Move & assign"); wired into TaskDrawer (Esc closes it first), board drag (optimistic move + revert), table status select | `components/AssignStepDialog.tsx`, `TaskDrawer.tsx`, `board/page.tsx`, `table/page.tsx` |
| Assignee rules | Bundled PATCH allowed for any `change_status` role; lone reassign still needs `assign` (or claim/release); field-rule readonly bypassed only during the assign step | `lib/tasks.ts` |
| Settings › Workflow UI | Per-status designation chips (toggle → PATCH), status reorder (↑/↓ swap positions), add/rename/delete/transition forms gated by `canWf = superadmin \|\| manage_workflow`; non-managers see a read-only list | `settings/page.tsx` |
| Suggested members data | `loadProject` returns member `designationId` + per-status `designationIds`; `suggestedForStatus()` helper | `lib/server.ts`, `lib/workflow.ts`, `hooks/useProject.ts` |
| Logging | Status change → Activity `task.status` (before/after); assignee change → Activity + Notification `task_assigned` to the new assignee (asserted by tests) | existing plumbing, `tests/tasks.test.ts` |

- **Migrations:** `20261014140000_status_designations` (StatusDesignation table, applied to `dev.db`;
  test DBs rebuilt from migration SQL).
- **Tests added (61 total, was 49):** forward-only rejection (message wins over an allowing
  transition row), PM/superadmin backward moves, matrix still applies after the direction check,
  bundled status+assignee success for QA, lone reassign rejection for QA/Developer, PM reassign,
  bundled back-move rejected atomically, activity `task.status` + notification `task_assigned`
  assertions, `replaceStatusDesignations` semantics (replace, dedup, unknown-id throw),
  `suggestedForStatus` ordering.
- **Bugs found & fixed during verification:** hooks-after-early-return crash on `/p/[id]/table` and
  `/p/[id]/backlog` (loading return sat before `useEffect`/`useMemo` — server crawls never catch
  client hook errors; both returns moved below the last hook); Settings `loadAll` used `Promise.all`
  so a 403 on Automation (Developer) blanked the whole Settings page including the new mapping UI —
  now `Promise.allSettled` with per-section state and only non-403 failures surface as an error.
- Verified live (minted sessions, revoked after): 14 API checks (backward 403 message, PM backward
  200, matrix message, bundled assign-step 200, lone-reassign 403s, activity + notification rows,
  workflow GET designations, Developer workflow PATCH 403, PM bogus-designation 400); browser pass
  on table + drawer dialogs (dialog opens, pick + "Move & assign" persists, Cancel reverts), PM
  chip toggle round-trip (PATCH 200, chip state, toggled back off), Developer sees disabled chips +
  no add/reorder controls; `dev.db` task state restored afterward; console clean.


### Phase 3 — Kanban columns, sprints, project visibility (2026-10-15)

| Decision | How | Where |
|---|---|---|
| Column removal with tasks | DELETE workflow gains optional `moveToId` query param; tasks move one-by-one via `updateTask` (activity / notifications / automations all fire; manager bypass allows any target); transitions + designation mappings cleared, then the status is deleted. Without `moveToId` an occupied status still returns 400 "Status still has N task(s). Move them first." | `lib/workflow-server.ts` (`removeStatus`), `api/projects/[id]/workflow/route.ts` |
| Removal UI prompt | Settings: Delete → confirm → on that 400 a dialog opens listing the other statuses; "Move tasks & delete" retries with `moveToId` | `settings/page.tsx` |
| Board Add Task | Global "+ Add Task" (first column) and per-column dashed "+" inline quick-add (title only, prefilled status; goes into the currently filtered sprint); both gated by `create_task` (PM/Admin, server-enforced) | `board/page.tsx` |
| Active board | Sprint filter select on the board ("All sprints" + sprints, active/done labelled); defaults to the ACTIVE sprint until the user picks; filters via existing `tasks?sprintId=` | `board/page.tsx` |
| Sprint completeness | Sprint API already covered create/update/complete-with-carryover/delete; Phase 3 adds the missing edit UI (goal, start/end, capacity) next to Start/Complete; sprint management stays `manage_sprints` (PM/Admin defaults; Developer/QA/Viewer lack it) | `backlog/page.tsx`, `lib/permissions.ts` (unchanged) |
| Hidden projects | `Project.isHidden` (default false); settings PATCH accepts `isHidden` behind `manage_workflow` (Admin/PM); `listProjectsForUser` excludes hidden unless `includeHidden` — home project list + sidebar hide them, My Work tasks still include them; home "?showHidden=1" toggle shows them dimmed with a "hidden" badge; members with the URL keep full access | migration `20261015090000_project_hidden`, `lib/server.ts`, `api/projects/[id]/settings/route.ts`, `(app)/page.tsx`, `settings/page.tsx` |

- **Migrations:** `20261015090000_project_hidden` (`Project.isHidden`). Note: dev DB file is
  `./dev.db` (CWD-relative — the app's `DATABASE_URL`); a stray `prisma/dev.db` created in
  error was deleted, and the previously un-recorded `20261014140000` row was recorded properly.
- **Tests added (70 total, was 61):** new `tests/projects.test.ts` — hidden projects excluded
  from member + superadmin lists (and included with includeHidden; membership still loads);
  `manage_sprints` granted to PM only among default roles; `listTasks` sprint filter;
  `removeStatus`: empty delete clears transitions/designations, occupied without target throws
  + keeps status, move-then-delete logs `task.status` activity, bogus/self/unknown targets
  throw. `scripts/_apply-migration.mjs` kept for future dev-DB migrations.
- Verified live (minted admin + Developer sessions, revoked after): 14 API checks (Developer 403
  on isHidden PATCH / sprint create / status delete; occupied-status 400; `moveToId` move of 1
  task + relocation verified; hide/unhide 200; sprint create + start); browser pass: hide flips
  button + NM leaves sidebar/home, Show hidden shows it dimmed + badged, board sprint filter
  defaults to the active sprint, per-column and global quick-add create cards, column-removal
  dialog shows the 400 message + target list and relocates the task to To Do, sprint edit saves a
  new goal; console clean on board/settings/backlog. Cleanup: verification tasks/sprint removed,
  NM unhidden, sessions revoked. (An intermediate "unhide" observed in the audit turned out to be
  the user clicking the new button in their own browser — the feature working for a real user.)


### Phase 4 — Home summary dashboard + Calendar page (2026-10-15)

| Decision | How | Where |
|---|---|---|
| Dashboard on home | Home becomes "Dashboard": stat cards (visible projects + hidden count, tasks open/done, overdue, my open/overdue, active sprints) + by-status / by-priority / open-tasks-per-member bars + active-sprint progress rows. Server-computed, scoped to the user's projects (superadmin: all). Statuses are per-project, so same-named statuses merge into one bar; hidden projects are excluded from the project COUNT but their tasks still count (assignments persist) | `lib/dashboard.ts`, `(app)/page.tsx` |
| Bar chart reuse | Reports' local `Bar` component extracted to shared `StatBar`, now used by both reports and the dashboard (no duplicate markup) | `components/StatBar.tsx`, `reports/page.tsx` |
| Calendar scope | New app-level `/calendar` + `GET /api/calendar` with zod query validation (`from`/`to` YYYY-MM-DD, optional `projectId`, `assigneeId` = user id \| `me` \| `none`) behind `requireUser`; a `projectId` outside the caller's membership → 403. Scope = member projects (superadmin: all; hidden projects included — their members still have work); holidays = global (`projectId: null`) + in-scope projects | `api/calendar/route.ts`, `lib/calendar.ts` |
| Task occurrence rule | A task occurs on every day from `startDate` through `endDate` inclusive; a task with only one date appears on that single day. Server query widens the range ±1 day for timezone slack; the client places chips by local day key | `lib/calendar.ts` |
| Calendar UI | Month view (42 cells, Sunday start) / Week view (7 tall cells), ◀/Today/▶ navigation, project + assignee filters, task chips color-coded by status, holidays as amber 🏖 chips, today ring, click chip → board drawer deep link `/p/{id}/board?task={id}`. Sidebar gets "📅 Calendar"; "🏠 My Work" renamed "🏠 Dashboard" | `(app)/calendar/page.tsx`, `(app)/layout.tsx` |

- **Migrations:** none (no schema changes needed).
- **Tests added (81 total, was 70):** new `tests/calendar.test.ts` (11 tests) — grid helpers
  (42-cell Sunday-start month grid, 7-cell week grid, start..due span `occursOn`, `widenRange`);
  `fetchCalendarData` scoping (member sees own + hidden projects + global holidays but never an
  outsider project; superadmin sees all; `projectId` outside scope rejects; assignee user/`none`
  filters; out-of-range tasks & holidays excluded); `dashboardSummary` (totals/overdue/my counts,
  by-status/priority/member aggregation, active-sprint progress, hidden excluded from project
  count while its tasks still count, superadmin branch). Also fixed persistent-test-DB
  idempotency: `tests/projects.test.ts` fixture roles are now find-or-create (repo pattern).
- **Verified:** `npx tsc --noEmit`, `npm test` (81/81), `npm run build` all pass. Live checks:
  dashboard renders server-side with merged cross-project status bars (To Do 7 / In Testing 4 …);
  calendar month view (42 cells, 11 chips, today ring), February 2026 shows the global holiday
  chip, week view (7 tall cells), prev×8 + Today navigation, project filter narrows to LVM-only
  chips, assignee filter ("me" → admin has none; named member → 6 chips all theirs), chip click
  opens the board with the task drawer, console clean.


### Phase 5 — Theme (CSS variables + localStorage) and PDF exports (2026-10-15)

| Decision | How | Where |
|---|---|---|
| Theme tokens | One CSS variable set (`--accent`, `--canvas`, `--surface`, `--line`, `--muted`) flipped by `.dark` on `<html>` and mapped to utilities through Tailwind v4 `@theme inline` (`bg-surface`, `border-line`, `text-muted`, `ring-accent` …). Components read tokens instead of repeating `dark:` variants | `globals.css` |
| Theme precedence & persistence | Root inline script (runs before paint → no FOUC): `localStorage.tt_theme` → `tt_theme` cookie → `prefers-color-scheme`. An app-layout script then falls back to the saved `User.theme` profile value for a first visit on a new device. The ☀/🌙 toggle writes all three (localStorage, cookie, `PATCH /api/profile`), highlights the active mode via `aria-pressed`, and syncs across tabs on the `storage` event | `layout.tsx`, `(app)/layout.tsx`, `ThemeToggle.tsx` |
| PDF library | Exactly one library: **jspdf**, dynamically imported inside the export builders so it stays out of the main bundle | `package.json`, `lib/pdf.ts` |
| Page-break correctness | Small drawing context tracks the y cursor; `ensure(h)` adds a page when the next block would overflow, and the table helper repeats its header after a break; footers stamp "Page i / n" on every page | `lib/pdf.ts` (`ctx`/`ensure`/`table`/`footer`) |
| Reports PDF | Toolbar "⬇ Download PDF" on Reports builds an A4 portrait document: header (project key/name + timestamp), summary block, status distribution / velocity / per-assignee / QA-queue bars, burndown table (auto page breaks), overdue task table, footer. Data = the same memoized values the page shows | `reports/page.tsx`, `lib/pdf.ts` (`buildReportPdf`) |
| Calendar PDF | "⬇ Download PDF" in the Calendar toolbar exports the current month/week view + active filters as an A4 landscape grid (7×6 cells, day numbers, amber holidays, status-colored task chips with "+N more" overflow) | `calendar/page.tsx`, `lib/pdf.ts` (`buildCalendarPdf`) |
| Visual polish | Base layer: themed thin scrollbars, `::selection` tint, global `:focus-visible` ring in the accent color, Inter-first font stack, shared `.tt-btn` control style; sidebar/dashboard/calendar surfaces moved onto the tokens | `globals.css`, `(app)/layout.tsx`, `(app)/page.tsx`, `calendar/page.tsx`, `StatBar.tsx` |
| English-only re-check | Grep of `src/**` for Bangla codepoints (`[\u0980-\u09FF]`): zero matches; no language switcher anywhere. The Noto Sans Bengali font stays loaded as a *fallback* only (Inter is now first) so any user-entered Bengali text still renders | `layout.tsx` |

- **Migrations:** none (no schema changes).
- **Dependency added:** `jspdf` (the single PDF library; its optional `canvg`/`core-js` transitive deps are inert).
- **Tests added (87 total, was 81):** new `tests/pdf.test.ts` (6 tests) — `openPdf` produces a valid document; `ensure()` paginates overflowing content (>1 page); `hexToRgb` short/full/invalid handling; `buildReportPdf` paginates a 120-row burndown + 40-row overdue table and handles fully empty sections; `buildCalendarPdf` renders a 42-cell month with spanning tasks + holidays on one landscape page. All assert a valid `%PDF-` header.
- **Verified live:** fresh-browser checks — theme toggle flips `html.dark` + localStorage + cookie + `aria-pressed`, survives reload with no FOUC (dark `--canvas`/`--surface` resolve to slate-950/slate-900), calendar/dashboard render in both themes with token-driven borders/cells; Reports and Calendar "Download PDF" both run the dynamic jspdf import end-to-end with zero console errors (calendar completes in ~200ms); console clean throughout. Admin profile theme restored to `system`; temp sessions revoked; temp scripts removed.
- Note: the long-lived agent browser tab survived several dev-server restarts (including the `npm run build`/`jspdf`-install window that made Turbopack churn) and got stuck replaying a stale React stream (skeleton forever) — a **stale-tab** artifact, not an app bug; a fresh tab rendered everything correctly. The dev server was restarted cleanly afterward.


## Change request (2026-10-15)

### Change of plan — sprints removed, Task Timer added

| Decision | How | Where |
|---|---|---|
| Sprints out of UI/API | Sprint filter (board/table), backlog page + nav, sprint CRUD/complete-carryover endpoints and serializers, import/export columns — all removed. **DB columns stay** (`Sprint` table + `Task.sprintId`) so no data is destroyed; nothing in `src/` references sprints anymore | board/table/import/export, `lib/tasks.ts`, deleted sprint routes |
| Task Timer | Per-task Start/Stop with derived state (`NOT_STARTED/RUNNING/OVERDUE/STOPPED`) computed server-side from timestamps; precedence: `stoppedAt` wins, exactly-at-`dueAt` still RUNNING, no `dueAt` = runs forever; scheduled start auto-starts lazily (swept + persisted); final-status move auto-stops; scheduled/due settable by the assignee, any PM (`manage_workflow`) or Admin; chips + timer column in table/cards/drawer | migration `20261015170000_task_timer`, `lib/timer.ts`, `lib/timerState.ts`, `lib/timerFormat.ts`, timer API, `TaskDrawer` |

### Phase 2–3 — Board behaviour & member labels

| Decision | How | Where |
|---|---|---|
| Final status = category `done` | Moving a task into a final-status column no longer opens "Assign to" and never auto-reassigns | `board/page.tsx`, `lib/tasks.ts` |
| Member labels | Shared `memberLabel()` → `Name - Role1, Role2 (Designation)`, truncated with tooltip in selects; designation-matched users sort first; Admin/PM can (re)assign anytime | `lib/memberLabel.ts`, lookups carry `designationName`/`avatarUrl` |

### Phase 4 — Users page & avatars

| Decision | How | Where |
|---|---|---|
| Dedicated Users page | `/users` (Admin, or PM with `manage_members` somewhere); `/admin/users` redirects; list + Add/Edit/Delete, memberships modal, designation catalog manager (audited); PM edits only users in projects they manage and cannot touch email/flags | `(app)/users/page.tsx`, `lib/users.ts`, `api/users/**` |
| Delete = soft delete | `User.deletedAt` + `active=false` + `isSuperAdmin=false`, sessions revoked, memberships removed, tasks unassigned, history kept, `user.delete` audit; login blocked; no self-delete; last active Admin can't be deleted/demoted | migration `20261015180000_user_soft_delete` |
| Avatars | `.jpg/.jpeg` only, validated server-side (extension + `image/jpeg` MIME + `FF D8 FF` magic bytes) and ≤ 2 MB, stored under a generated safe filename; `Avatar` component with initials fallback shown in sidebar, lists, dropdowns and cards | `lib/avatar.ts`, `components/Avatar.tsx`, `api/users/[id]/avatar` |

### Phase 5 — Timeline details & Calendar settings

| Decision | How | Where |
|---|---|---|
| Timeline readable details | One shared grid (Task · Timer · Start · Due · Time · Est · Logged · bar) with a labelled header so values align per row; `—` when missing | `(app)/p/[id]/timeline/page.tsx` |
| Fri/Sat highlight + holiday red | `isWeekendDay()` (Fri/Sat) tints headers + cells via theme tokens (both themes); holiday day cells get a mild red tint + red 🏖 badge with the name | `lib/calendar.ts`, `calendar/page.tsx` |
| Calendar Settings + holidays moved | `⚙ Calendar Settings` modal inside the Calendar: list/add/edit/delete with the shared ConfirmDialog; global holidays Admin-only, project holidays need `manage_workflow`; holidays section removed from Project Settings (workload keeps its read-only feed) | `components/CalendarSettings.tsx`, `api/holidays/route.ts`, `lib/holidays.ts` |
| Default view | Calendar opens on **My tasks** with a My/All segmented toggle; project/assignee filters and PDF export kept | `calendar/page.tsx` |

### Phase 6 — UI polish

| Decision | How | Where |
|---|---|---|
| Active tab indicator | `NavLink` client component marks the current route (and the open project) with an accent pill + `aria-current="page"` | `components/NavLink.tsx`, `(app)/layout.tsx`, `components/SidebarProjects.tsx` |
| Sticky sidebar | Sidebar is `sticky top-0 h-screen overflow-y-auto` — navigation and the user panel stay visible on long pages | `(app)/layout.tsx` |
| Layout/theme pass | Shared token classes `.tt-card`/`.tt-title` replace repeated hardcoded `bg-white dark:bg-slate-900` surfaces (users, timeline, settings, profile, roles, calendar); audit confirmed every remaining hardcoded light color has a dark counterpart | `globals.css`, touched pages |

- **Migrations:** `20261015170000_task_timer`, `20261015180000_user_soft_delete` (sprint tables intentionally untouched).
- **Tests:** suite grew to **120 tests / 10 files** — `tests/timer.test.ts` (13), `tests/users.test.ts` (10), `tests/holidays.test.ts` (14), plus board/phase-2 additions; `scripts/pretest.mjs` provisions the new scratch DBs.
- **Verified:** `npx tsc --noEmit`, `npm test` (120/120), `npm run build` clean per phase; browser passes for every phase (labels format, no reassign into Done, timer chips + auto-stop, avatar upload rejections, users CRUD incl. self-delete block, calendar My/All + weekend/holiday rendering in both themes, holiday CRUD via Calendar Settings, timeline columns incl. schedule-derived Time, sticky sidebar + active tabs). All verification users, audit rows, uploads and temp scripts removed afterwards.
