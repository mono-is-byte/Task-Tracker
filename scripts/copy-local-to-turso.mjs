import "dotenv/config";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";

/**
 * Copies every table of a local SQLite database (default: dev.db) into the
 * remote libSQL/Turso database — replacing whatever is stored there.
 *
 *   npm run turso:copy-local               # copy dev.db → Turso
 *   npm run turso:copy-local -- --dry-run  # show row counts only, copy nothing
 *
 * Requires TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) in the environment or .env.
 * The migrations must already be applied to the remote database
 * (`npm run turso:migrate`) — this script moves data only, never schema.
 *
 * Copy order follows foreign keys: tables are inserted parent-first and the
 * remote tables are wiped child-first, so the copy holds even when the server
 * enforces foreign keys.
 */

const dryRun = process.argv.includes("--dry-run");
const localPath = process.env.LOCAL_DB ?? "dev.db";

const remoteUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteUrl) {
  console.error("TURSO_DATABASE_URL is not set — point it at your Turso database first.");
  process.exit(1);
}
if (!/^(libsql|wss?|https?):/i.test(remoteUrl)) {
  console.error("TURSO_DATABASE_URL does not look like a remote URL — refusing to run.");
  process.exit(1);
}

const local = new Database(localPath, { readonly: true });
const remote = createClient({ url: remoteUrl, authToken });

const SKIP_TABLES = new Set(["_applied_migrations", "_prisma_migrations"]);

function allTables() {
  return local
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .filter((t) => !SKIP_TABLES.has(t));
}

function columnsOf(t) {
  return local.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
}

function parentsOf(t) {
  return local.prepare(`PRAGMA foreign_key_list("${t}")`).all().map((r) => r.table);
}

/** Parents before children; cycles are tolerated (kept in discovery order). */
function insertOrder(tables) {
  const set = new Set(tables);
  const out = [];
  const seen = new Set();
  const visit = (t, stack) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const p of parentsOf(t)) if (set.has(p) && p !== t) visit(p, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

function toArg(v) {
  if (v === undefined || v === null) return null;
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  return v;
}

async function countRemote(t) {
  const res = await remote.execute(`SELECT COUNT(*) AS c FROM "${t}"`);
  return Number(res.rows[0].c);
}

async function main() {
  const tables = allTables();
  const order = insertOrder(tables);
  const selfRefs = tables.filter((t) => parentsOf(t).includes(t));

  console.log(`Local database : ${localPath}`);
  console.log(`Remote database: ${remoteUrl}`);
  if (selfRefs.length) console.log(`Self-referencing tables: ${selfRefs.join(", ")}`);

  let totalRows = 0;
  console.log("\nLocal row counts:");
  for (const t of order) {
    const n = local.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    totalRows += n;
    console.log(`  ${String(n).padStart(6)}  ${t}`);
  }
  console.log(`  ${String(totalRows).padStart(6)}  rows total`);

  if (dryRun) {
    console.log("\nRemote row counts (as they are now):");
    for (const t of order) {
      try {
        console.log(`  ${String(await countRemote(t)).padStart(6)}  ${t}`);
      } catch {
        console.log(`       ?  ${t} (missing remotely — run turso:migrate?)`);
      }
    }
    console.log("\nDry run — nothing was copied.");
    return;
  }

  // Best effort: relax foreign-key enforcement for the duration if the server
  // allows it. Ordering above already keeps a strict server happy.
  for (const pragma of ["PRAGMA foreign_keys = OFF", "PRAGMA defer_foreign_keys = ON"]) {
    try {
      await remote.execute(pragma);
    } catch {
      /* not supported — the insert order covers it */
    }
  }

  console.log("\nWiping remote tables (child tables first)…");
  await remote.batch([...order].reverse().map((t) => `DELETE FROM "${t}"`), "write");

  console.log("Copying rows (parent tables first)…");
  for (const t of order) {
    const cols = columnsOf(t);
    const rows = local.prepare(`SELECT * FROM "${t}"`).all();
    if (rows.length === 0) continue;
    const sql = `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const stmts = rows.map((row) => ({ sql, args: cols.map((c) => toArg(row[c])) }));
    for (let i = 0; i < stmts.length; i += 200) {
      await remote.batch(stmts.slice(i, i + 200), "write");
    }
    console.log(`  ${rows.length} rows → ${t}`);
  }

  let mismatches = 0;
  console.log("\nVerifying row counts:");
  for (const t of order) {
    const localN = local.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    const remoteN = await countRemote(t);
    const ok = localN === remoteN;
    if (!ok) mismatches += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${t}: local ${localN} / remote ${remoteN}`);
  }

  if (mismatches > 0) {
    console.error(`\n${mismatches} table(s) did not match — re-run the script to fix.`);
    process.exitCode = 1;
  } else {
    console.log("\nDone — the remote database now matches the local one.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    local.close();
    remote.close();
  });
