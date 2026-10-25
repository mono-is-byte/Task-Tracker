import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';

// Safe, additive merge: never deletes or updates existing Turso rows.
// Run from the project root with: node scripts/merge-local-to-turso.mjs --dry-run
// Then, after reviewing the report: node scripts/merge-local-to-turso.mjs --apply

const LOCAL_DB = process.env.LOCAL_DB || 'dev.db';
const DRY_RUN = !process.argv.includes('--apply');
const APPLY = process.argv.includes('--apply');
const TARGET_TABLES = [
  'User', 'Role', 'Project', 'ProjectMember', 'ProjectMemberRole',
  'Status', 'StatusTransition', 'Priority', 'IssueType', 'Epic', 'Task',
  'TaskLink', 'Comment', 'Activity', 'CustomField', 'AutomationRule',
  'TaskStageTime', 'Holiday', 'WorkingDayException', 'StatusDesignationTag'
];
const NEVER_COPY = new Set(['_applied_migrations', '_prisma_migrations', 'Session', 'LoginAttempt', 'PasswordReset', 'UserAvatar']);

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. Check your project-root .env file.');
  process.exit(1);
}

const local = new Database(LOCAL_DB, { readonly: true });
const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const roleNorm = (v) => norm(v) === 'qa' ? 'qa engineer' : norm(v);
const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const localTables = new Set(local.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
const remoteTables = new Set((await remote.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(x => x.name));
const tables = TARGET_TABLES.filter(t => localTables.has(t) && remoteTables.has(t) && !NEVER_COPY.has(t));

function localRows(table) { return local.prepare(`SELECT * FROM ${quote(table)}`).all(); }
async function remoteRows(table) { return (await remote.execute(`SELECT * FROM ${quote(table)}`)).rows; }
function localCols(table) { return local.prepare(`PRAGMA table_info(${quote(table)})`).all().map(x => x.name); }
async function remoteCols(table) { return (await remote.execute(`PRAGMA table_info(${quote(table)})`)).rows.map(x => x.name); }
function localFks(table) { return local.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all(); }

// Parent tables before dependent tables.
const deps = new Map(tables.map(t => [t, new Set(localFks(t).map(f => f.table).filter(p => tables.includes(p) && p !== t))]));
const ordered = [];
while (ordered.length < tables.length) {
  const next = tables.find(t => !ordered.includes(t) && [...deps.get(t)].every(p => ordered.includes(p)));
  if (!next) {
    const remaining = tables.filter(t => !ordered.includes(t));
    throw new Error(`Could not safely order tables due to a foreign-key cycle: ${remaining.join(', ')}`);
  }
  ordered.push(next);
}

const idMaps = new Map(tables.map(t => [t, new Map()]));
const localCache = new Map();
const remoteCache = new Map();
const report = [];

for (const table of ordered) {
  const lrows = localRows(table);
  const rrows = await remoteRows(table);
  const remoteBeforeCount = rrows.length;
  const lcols = localCols(table);
  const rcols = await remoteCols(table);
  const cols = lcols.filter(c => rcols.includes(c));
  const hasId = cols.includes('id');
  localCache.set(table, lrows);
  remoteCache.set(table, rrows);
  const idMap = idMaps.get(table);
  let matched = 0, toInsert = 0, skipped = 0;

  const findNatural = (row, mappedRow) => {
    const find = (predicate) => rrows.find(rr => predicate(rr, mappedRow));
    if (table === 'User') {
      return find(rr => norm(rr.email) === norm(row.email) || norm(rr.name) === norm(row.name));
    }
    if (table === 'Project') return find(rr => norm(rr.key) === norm(row.key));
    if (table === 'Role') return find(rr => roleNorm(rr.name) === roleNorm(row.name));
    if (['Status', 'Priority', 'IssueType', 'Epic', 'CustomField', 'AutomationRule'].includes(table)) {
      return find(rr => norm(rr.name) === norm(row.name) && rr.projectId === mappedRow.projectId);
    }
    if (table === 'ProjectMember') {
      return find(rr => rr.projectId === mappedRow.projectId && rr.userId === mappedRow.userId);
    }
    if (table === 'ProjectMemberRole') {
      return find(rr => rr.memberId === mappedRow.memberId && rr.roleId === mappedRow.roleId);
    }
    if (table === 'TaskStageTime') {
      return find(rr => rr.taskId === mappedRow.taskId && rr.statusId === mappedRow.statusId && rr.startedAt === mappedRow.startedAt);
    }
    if (table === 'Holiday') return find(rr => norm(rr.date) === norm(row.date) && norm(rr.name) === norm(row.name));
    if (table === 'WorkingDayException') return find(rr => norm(rr.date) === norm(row.date));
    if (table === 'StatusDesignationTag') {
      return find(rr => rr.statusId === mappedRow.statusId && norm(rr.tag) === norm(row.tag));
    }
    return undefined;
  };

  for (const original of lrows) {
    const mapped = {};
    for (const c of cols) mapped[c] = original[c];
    // Remap all foreign keys to IDs already matched/inserted in the remote DB.
    for (const fk of localFks(table)) {
      if (!(fk.from in mapped) || mapped[fk.from] == null) continue;
      const parentMap = idMaps.get(fk.table);
      if (parentMap?.has(mapped[fk.from])) mapped[fk.from] = parentMap.get(mapped[fk.from]);
    }

    let existing = findNatural(original, mapped);
    if (!existing && hasId) existing = rrows.find(rr => rr.id === mapped.id);
    if (existing) {
      if (hasId) idMap.set(original.id, existing.id);
      matched++;
      continue;
    }

    // In dry-run, still assign the original ID so dependent rows can be analyzed.
    if (DRY_RUN) {
      if (hasId) idMap.set(original.id, mapped.id);
      toInsert++;
      continue;
    }

    const insertCols = cols.filter(c => mapped[c] !== undefined);
    const sql = `INSERT OR IGNORE INTO ${quote(table)} (${insertCols.map(quote).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;
    try {
      await remote.execute({ sql, args: insertCols.map(c => mapped[c] ?? null) });
      let inserted = hasId ? (await remote.execute({ sql: `SELECT * FROM ${quote(table)} WHERE id = ?`, args: [mapped.id] })).rows[0] : null;
      if (!inserted && hasId) inserted = (await remoteRows(table)).find(rr => rr.id === mapped.id);
      if (inserted && hasId) {
        idMap.set(original.id, inserted.id);
        rrows.push(inserted);
        toInsert++;
      } else if (!hasId) {
        toInsert++;
      } else {
        skipped++;
        console.warn(`  Could not confirm inserted row in ${table}, id=${mapped.id}`);
      }
    } catch (e) {
      skipped++;
      console.warn(`  SKIP ${table} id=${original.id}: ${e.message}`);
    }
  }
  report.push({ table, local: lrows.length, remoteBefore: remoteBeforeCount, matched, wouldInsertOrInserted: toInsert, skipped });
}

console.log(`\nLocal DB: ${LOCAL_DB}`);
console.log(`Turso DB: ${process.env.TURSO_DATABASE_URL}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes made)' : 'APPLY (additive merge; no deletes)'}`);
console.table(report);
if (DRY_RUN) {
  console.log('\nReview the counts above. If they look correct, run:');
  console.log('node scripts/merge-local-to-turso.mjs --apply');
} else {
  console.log('\nMerge finished. Verify Task, Project, Epic, Status, Priority and IssueType counts in Turso.');
}
local.close();
await remote.close();
