#!/usr/bin/env node
/**
 * tools/fresh-db-check.cjs — BUILD AN EMPTY DATABASE FROM migrations/ AND JUDGE THE RESULT (SCHEMA-FIX1, the `fresh-db` CI job).
 * CARD 28-platform-and-operations/fresh-db-check
 *
 *   node tools/fresh-db-check.cjs --db <url of an EMPTY database>
 *
 * OWNS       the verdict on a fresh build: the failed files compared with migrations/fresh-db.accepted.json, and six anchor tables present.
 * CALLED BY  .github/workflows/ci.yml job `fresh-db`; tests/fresh-db-check.test.cjs proves `judge`. The build itself is tools/migrate.cjs apply().
 * PASS       the failed set is inside the accepted list. FAIL when a new file fails, or an accepted file now passes without being taken off
 *            the list (so the list can only shrink, to empty). Refuses a database that already has tables (apply() would leave it alone).
 * FLOW       readDatabaseUrl → apply() → judge → anchorTablesMissing → report → exit code
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const { apply } = require('./migrate.cjs');

const ACCEPTED_FILE = path.join(__dirname, '..', 'migrations', 'fresh-db.accepted.json');
const ANCHOR_TABLES = ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items'];

/** the file name at the front of a "file.sql — ERROR: …" line apply() reports */
const fileOf = (failedLine) => String(failedLine).split(' — ')[0];

/** the verdict: which failures are new, and which accepted files have started to pass */
function judge(failedLines, accepted) {
  const failed = failedLines.map(fileOf);
  return { newlyFailing: failed.filter((file) => !accepted.includes(file)), nowPassing: accepted.filter((file) => !failed.includes(file)) };
}
/** the anchor tables the build did not make */
async function anchorTablesMissing(databaseUrl) {
  const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 }),
    missing = [];
  for (const table of ANCHOR_TABLES) {
    const found = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table]);
    if (!found.rows.length) missing.push(table);
  }
  await pool.end();
  return missing;
}
function readDatabaseUrl(argv) {
  const at = argv.indexOf('--db'),
    given = at >= 0 ? argv[at + 1] : '';
  return given || process.env.DATABASE_URL || '';
}
/** print every problem and return how many there were */
function report(result, verdict, missing, acceptedCount) {
  verdict.newlyFailing.forEach((file) => console.error('  ✗ fails on an empty database: ' + result.failed.find((line) => fileOf(line) === file)));
  verdict.nowPassing.forEach((file) => console.error('  ✗ ' + file + ' now passes — take it off migrations/fresh-db.accepted.json'));
  if (missing.length) console.error('  ✗ tables missing after the build: ' + missing.join(', '));
  const problems = verdict.newlyFailing.length + verdict.nowPassing.length + missing.length;
  console.log(
    '\n  ' +
      result.ran.length +
      ' files applied · ' +
      result.failed.length +
      ' failed (' +
      acceptedCount +
      ' accepted) · ' +
      (problems ? problems + ' problem(s)' : 'clean')
  );
  return problems;
}

async function main() {
  const databaseUrl = readDatabaseUrl(process.argv.slice(2));
  if (!databaseUrl) {
    console.error('  fresh-db-check: say which database: --db postgres://…');
    process.exit(2);
  }
  const accepted = JSON.parse(fs.readFileSync(ACCEPTED_FILE, 'utf8')).accepted || [];
  const result = await apply(databaseUrl);
  if (result.left_alone) {
    console.error('  ✗ the database was not empty — nothing was built, nothing proven');
    process.exit(1);
  }
  const problems = report(result, judge(result.failed, accepted), await anchorTablesMissing(databaseUrl), accepted.length);
  process.exit(problems ? 1 : 0);
}

module.exports = { judge, fileOf };
if (require.main === module) {
  main().catch((error) => {
    console.error('  ✗ fresh-db-check could not run: ' + error.message);
    process.exit(1);
  });
}
