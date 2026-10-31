# Disclaimer

This software is provided "as is", without warranty of any kind. It is still being tested
and may contain bugs or security issues. You are responsible for reviewing, testing and
securing it before any real or production use, including data backups, credentials
(change all demo passwords such as the seeded admin password) and hosting configuration.
The author is not liable for any data loss, security incident or damage resulting from its
use.

- Not production-audited
- Change all default/demo credentials before exposing an instance
- Back up the database before any migration or destructive change
- Review the code and configuration before deploying
- **Backups are sensitive:** a database snapshot (for example `backup/turso-*.db`) contains
  user emails, bcrypt password hashes and avatars. Keep it local or encrypted, never commit
  or upload it, and delete it when no longer needed.
- **The GitHub repository is public (source only):** never commit `.env` files, `dev.db`,
  database backups or `public/uploads/`. Only `.env.example` with placeholders belongs in
  git.
- **Reset-token logging is opt-in:** `AUTH_LOG_RESET_TOKEN=1` writes working password-reset
  tokens to the server log and is intended for local debugging only — never enable it in
  production.
- Rate limiting (login lockout, forgot-password) is best-effort and in-process; it is
  per-instance on serverless hosts. Review it for your threat model before relying on it.
