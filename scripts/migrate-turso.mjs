// Applies the committed Prisma migrations to a remote libSQL/Turso database.
//
// Prisma Migrate cannot reach Turso over HTTP (it needs a local SQLite
// connection), so this script replays the exact same migration SQL that a
// local/self-hosted database uses and records what it applied in a small
// `_applied_migrations` table. Re-running is safe: applied migrations are
// skipped.
//
// Usage:
//   TURSO_DATABASE_URL="libsql://<db>-<org>.turso.io" TURSO_AUTH_TOKEN="..." npm run turso:migrate
//
// The script only ever talks to the database in TURSO_DATABASE_URL — it never
// touches the local dev database.

import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error("TURSO_DATABASE_URL is required, e.g. libsql://<db>-<org>.turso.io");
  process.exit(1);
}
if (!authToken && /^(libsql|wss?|https?):/i.test(url)) {
  console.error("TURSO_AUTH_TOKEN is required for a remote libSQL/Turso URL.");
  process.exit(1);
}

const client = createClient({ url, authToken });

// Migration SQL from Prisma Migrate, applied statement by statement exactly
// like scripts/pretest.mjs does for the scratch test databases.
function statementsOf(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const migrationDir = "./prisma/migrations";
const migrations = readdirSync(migrationDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

await client.execute(
  'CREATE TABLE IF NOT EXISTS "_applied_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL)',
);

const applied = new Set(
  (await client.execute('SELECT "name" FROM "_applied_migrations"')).rows.map((row) => String(row.name)),
);

let count = 0;
for (const name of migrations) {
  if (applied.has(name)) {
    console.log(`= ${name} (already applied)`);
    continue;
  }
  const statements = statementsOf(readFileSync(join(migrationDir, name, "migration.sql"), "utf8"));
  await client.batch(statements, "write");
  await client.execute({
    sql: 'INSERT INTO "_applied_migrations" ("name", "appliedAt") VALUES (?, ?)',
    args: [name, new Date().toISOString()],
  });
  console.log(`+ ${name} (${statements.length} statements)`);
  count += 1;
}

console.log(count > 0 ? `applied ${count} migration(s)` : "database is already up to date");
client.close();
