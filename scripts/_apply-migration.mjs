import { readdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import Database from "better-sqlite3";

// Applies pending committed Prisma migrations to the REAL dev database (./dev.db,
// CWD-relative — what the app's DATABASE_URL="file:./dev.db" resolves to).
// Prisma 7 `db push`/`migrate dev` are AI-gated here; committed migrations stay the
// source of truth (pretest.mjs uses the same SQL for the test DBs).
const db = new Database("dev.db");
db.pragma("foreign_keys = ON");

const dirs = readdirSync("./prisma/migrations")
  .filter((d) => d !== "migration_lock.toml").sort();

const applied = new Set(
  db.prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`).all()
    .map((r) => r.migration_name),
);

for (const name of dirs) {
  if (applied.has(name)) continue;
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const tx = db.transaction(() => {
    for (const stmt of statements) db.exec(stmt);
    db.prepare(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
    ).run(name, checksum, new Date().toISOString(), name, new Date().toISOString());
  });
  tx();
  console.log(`applied ${name}`);
}
console.log("dev.db up to date");
