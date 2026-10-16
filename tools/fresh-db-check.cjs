#!/usr/bin/env node
/**
 * tools/fresh-db-check.cjs — BUILD AN EMPTY DATABASE FROM migrations/ AND JUDGE THE RESULT (SCHEMA-FIX1, the `fresh-db` CI job).
 *
 *   node tools/fresh-db-check.cjs --db <url of an EMPTY database>
 *
 * Runs tools/migrate.cjs apply() (the one runner: baseline passes + every bNNN in order) and compares the files that failed with
 * migrations/fresh-db.accepted.json. PASS when the failed set is inside the accepted list. FAIL when a new file fails, or when an
 * accepted file now passes without having been taken off the list (so the list can only shrink, to empty).
 * Refuses a database that already has tables (apply() would leave it alone and the check would prove nothing).
 * FLOW  open → apply() → compare with the accepted list → six anchor tables exist → exit code
 */
'use strict';
const fs = require('fs'), path = require('path');
const { apply } = require('./migrate.cjs');
const ACCEPTED_FILE = path.join(__dirname, '..', 'migrations', 'fresh-db.accepted.json');
const ANCHOR_TABLES = ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items'];

/** the file name at the front of a "file.sql — ERROR: …" line apply() reports */
const fileOf = (line) => String(line).split(' — ')[0];

/** the verdict: which failures are new, which accepted files have started to pass */
function judge(failedLines, accepted) {
  const failed = failedLines.map(fileOf);
  return { newlyFailing: failed.filter((f) => !accepted.includes(f)), nowPassing: accepted.filter((f) => !failed.includes(f)) };
}

async function main() {
  const argv = process.argv.slice(2), at = argv.indexOf('--db');
  const url = (at >= 0 ? argv[at + 1] : '') || process.env.DATABASE_URL;
  if (!url) { console.error('  fresh-db-check: say which database: --db postgres://…'); process.exit(2); }
  const accepted = JSON.parse(fs.readFileSync(ACCEPTED_FILE, 'utf8')).accepted || [];
  const result = await apply(url);
  if (result.left_alone) { console.error('  ✗ the database was not empty — nothing was built, nothing proven'); process.exit(1); }
  const verdict = judge(result.failed, accepted);
  const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: url, max: 1 });
  const missing = [];
  for (const table of ANCHOR_TABLES) {
    const found = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table]);
    if (!found.rows.length) missing.push(table);
  }
  await pool.end();
  verdict.newlyFailing.forEach((f) => console.error('  ✗ fails on an empty database: ' + result.failed.find((l) => fileOf(l) === f)));
  verdict.nowPassing.forEach((f) => console.error('  ✗ ' + f + ' now passes — take it off migrations/fresh-db.accepted.json'));
  if (missing.length) console.error('  ✗ tables missing after the build: ' + missing.join(', '));
  const bad = verdict.newlyFailing.length + verdict.nowPassing.length + missing.length;
  console.log('\n  ' + result.ran.length + ' files applied · ' + result.failed.length + ' failed (' + accepted.length + ' accepted) · ' + (bad ? bad + ' problem(s)' : 'clean'));
  process.exit(bad ? 1 : 0);
}

module.exports = { judge, fileOf };
if (require.main === module) main().catch((e) => { console.error('  ✗ fresh-db-check could not run: ' + e.message); process.exit(1); });
