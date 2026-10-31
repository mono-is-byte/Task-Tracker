// Full logical backup of the remote Turso/libSQL database into a local SQLite
// file under backup/. READ-ONLY on the remote side: every remote statement is
// a SELECT / PRAGMA — nothing is written back.
//
//   npm run turso:backup                  # → backup/turso-<timestamp>.db
//   npm run turso:backup -- --out x.db    # custom path
//
// The result is a normal SQLite database (tables + rows + indexes/triggers/
// views). Row counts are verified table by table, and foreign keys are checked
// after the copy. `_applied_migrations` is included, so the backup records
// exactly which migrations the snapshot contains.

import "dotenv/config";
import { mkdirSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { createClient } from "@libsql/client";
import Database from "better-sqlite3";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL is required (set it in .env or the environment).");
  process.exit(1);
}

const outArg = process.argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = resolve(outArg > -1 ? process.argv[outArg + 1] : `backup/turso-${stamp}.db`);
mkdirSync(dirname(outPath), { recursive: true });

const client = createClient({ url, authToken });

async function exec(sql, args, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await client.execute(args ? { sql, args } : sql);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

/** libSQL returns BLOBs as ArrayBuffer; better-sqlite3 wants a Buffer. */
function bind(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

const master = (
  await exec(
    "SELECT type, name, tbl_name, sql FROM sqlite_master " +
      "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  )
).rows;

const tables = master.filter((r) => String(r.type) === "table");
const indexes = master.filter((r) => String(r.type) === "index");
const triggers = master.filter((r) => String(r.type) === "trigger");
const views = master.filter((r) => String(r.type) === "view");

console.log(`remote tables: ${tables.length}`);

const local = new Database(outPath);
local.pragma("journal_mode = OFF");
local.pragma("synchronous = OFF");
local.pragma("foreign_keys = OFF");

// 1. Schema: tables first.
for (const t of tables) local.exec(String(t.sql));

// 2. Data: one transaction per table, reusing a prepared INSERT.
const remoteCounts = {};
for (const t of tables) {
  const name = String(t.name);
  const cols = (await exec(`PRAGMA table_info("${name}")`)).rows.map((r) => String(r.name));
  if (cols.length === 0) continue;
  const rows = (await exec(`SELECT * FROM "${name}"`)).rows;
  const sql =
    `INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(", ")}) ` +
    `VALUES (${cols.map(() => "?").join(", ")})`;
  const insert = local.prepare(sql);
  const write = local.transaction((list) => {
    for (const row of list) insert.run(...cols.map((c) => bind(row[c])));
  });
  write(rows);
  remoteCounts[name] = Number((await exec(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
  console.log(`  ${name}: ${remoteCounts[name]} row(s)`);
}

// 3. Indexes, triggers and views after the data.
for (const r of [...indexes, ...triggers, ...views]) local.exec(String(r.sql));

// 4. Verify: every table's row count must match the remote database.
let failed = 0;
for (const t of tables) {
  const name = String(t.name);
  const localCount = Number(local.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
  if (localCount !== remoteCounts[name]) {
    failed += 1;
    console.error(`  MISMATCH ${name}: remote ${remoteCounts[name]}, backup ${localCount}`);
  }
}
const fk = local.pragma("foreign_key_check");
local.close();
client.close();

if (failed > 0) {
  console.error(`backup FAILED: ${failed} table(s) did not match.`);
  process.exit(1);
}

console.log(`foreign-key violations: ${fk.length}`);
console.log(`backup OK → ${outPath} (${(statSync(outPath).size / 1024).toFixed(1)} KB)`);
