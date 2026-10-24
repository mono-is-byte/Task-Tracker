import "dotenv/config";
import { db, usesRemoteSqlite } from "../src/lib/db";
import { repairDesignations } from "../src/lib/designation";

/**
 * Phase 1 (role = designation) — one-time repair.
 *
 * `User.designation` is the id of the user's PRIMARY role. Legacy rows can
 * point at a role the user no longer holds (the reported "IT Support Executive
 * shows as Developer"), because project-role changes used to be stored only on
 * ProjectMemberRole. This script re-derives every designation from the roles the
 * user actually holds. Users with no project memberships are left untouched.
 *
 * Usage:  npm run repair:designations
 * Targets the same database as the app (local SQLite, or Turso when
 * TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set).
 */
async function main() {
  console.log(`Target database: ${usesRemoteSqlite ? "remote libSQL/Turso" : "local SQLite file"}`);
  const changed = await repairDesignations(db);
  console.log(`Repaired ${changed} user designation(s).`);
  console.log("Idempotent — running it again reports 0.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
