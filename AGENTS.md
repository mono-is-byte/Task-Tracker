<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` - verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## TaskTracker project rules

Read [README.md](./README.md), [PROJECT-SUMMARY.md](./PROJECT-SUMMARY.md) and the latest
[PLAN.md](./PLAN.md) phase before changing code. The live deployment uses a remote
**Turso/libSQL** database; local development uses `dev.db`.

- **Back up before migrating.** Run `npm run turso:backup` and verify the snapshot before
  `npm run turso:migrate` or any schema/data change against Turso. Never edit an applied
  migration — the chain is append-only and shared with production. Never write to
  production without explicit approval.
- **Never commit sensitive files.** `.env`, `.env.development.local`, `dev.db`, `backup/`
  and `public/uploads/` are git-ignored. The GitHub repository is public; only
  `.env.example` with placeholders belongs in git. Backups contain PII and password
  hashes — keep them local/encrypted and never upload or share them.
- **Keep SQLite/Turso compatibility.** Use portable Prisma types and migrations that run
  on both `better-sqlite3` and libSQL; no provider-specific SQL or native-only APIs.
- **Server permissions are the source of truth.** Enforce assign/claim, field edits and
  workflow moves in the API (`requireUser`, `requireProjectPermission`, `getMembership`,
  the `ACTIONS` flags) — hiding UI is not enforcement.
- **Environment split:** `.env.development.local` sets empty `TURSO_*` so `next dev` stays
  on `dev.db`; `.env` holds the real Turso credentials used by `turso:migrate` /
  `turso:backup` (plain Node scripts read `.env`).
- **Verify changes:** `npx tsc --noEmit` and `npm test` must pass; run `npm run build`
  before declaring success (it needs network access for Google Fonts).
- **Do not commit, push or deploy unless the owner asks.** The `git` CLI is not available
  in the usual agent environment; the owner handles releases.
- **Paused work:** slow-load / realtime status-refresh investigation is paused — do not
  restart it without an explicit request.
- Keep user-authored **Bangla UI strings** intact.
