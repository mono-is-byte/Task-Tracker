/**
 * Change request migration: "Nice-to-have" is no longer an offered Customer
 * Impact option. The options live per project in the CustomField table, so this
 * small, idempotent script removes the option from every "Customer Impact"
 * field it finds (the seed ships the same shortened list for fresh databases).
 *
 * Task data is never rewritten: tasks that already saved "Nice-to-have" keep
 * their value and the table displays it as a removed (unselectable) option.
 *
 * Usage: node scripts/remove-customer-impact-option.mjs [path/to.db]
 *        (defaults to dev.db in the repository root)
 */
import Database from "better-sqlite3";

const file = process.argv[2] ?? "dev.db";
const REMOVED = "Nice-to-have";

const db = new Database(file);
const fields = db.prepare("SELECT id, options FROM CustomField WHERE name = ?").all("Customer Impact");
let changed = 0;
for (const f of fields) {
  let options;
  try {
    options = JSON.parse(f.options ?? "[]");
  } catch {
    continue; // unparsable config is left alone
  }
  if (!Array.isArray(options) || !options.includes(REMOVED)) continue;
  db.prepare("UPDATE CustomField SET options = ? WHERE id = ?")
    .run(JSON.stringify(options.filter((o) => o !== REMOVED)), f.id);
  changed += 1;
}
db.close();
console.log(`Customer Impact fields found: ${fields.length}; updated: ${changed} (removed "${REMOVED}")`);
