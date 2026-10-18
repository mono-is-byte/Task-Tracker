import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";

// Applies the committed Prisma migration SQL to scratch test databases.
// Only touches files under ./tests/ — never the dev database.
const TEST_DBS = ["tests/test-auth.db", "tests/test-tasks.db", "tests/test-projects.db", "tests/test-calendar.db", "tests/test-timer.db", "tests/test-users.db", "tests/test-holidays.db", "tests/test-lookups.db"];

const migrationDir = "./prisma/migrations";
const migrationSql = readdirSync(migrationDir)
  .filter((d) => d !== "migration_lock.toml")
  .sort()
  .map((d) => readFileSync(join(migrationDir, d, "migration.sql"), "utf8"))
  .join("\n");

const noComments = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const statements = noComments
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const file of TEST_DBS) {
  if (!file.startsWith("tests/")) throw new Error(`Refusing to touch ${file}`);
  const fresh = !existsSync(file);
  const db = new Database(file);
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  if (fresh || tables.n === 0) {
    const apply = db.transaction(() => {
      for (const stmt of statements) db.exec(stmt);
    });
    apply();
    console.log(`applied ${statements.length} statements to ${file}`);
  } else {
    console.log(`${file} already has schema (${tables.n} tables), skipping`);
  }
  db.close();
}
console.log("test databases ready");
