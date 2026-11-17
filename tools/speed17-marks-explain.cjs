#!/usr/bin/env node
'use strict';
/**
 * tools/speed17-marks-explain.cjs — l17 speed proof: EXPLAIN ANALYZE of the marks key statements (mark-detect.nowSql, review-mark.coverageSql cleared) for one client on a seeded depth database.
 * usage: ADMIN=postgres://… (superuser, to find the client) APP=postgres://… (the api's own role: the explain runs UNDER ROW SECURITY, where a non-leakproof cast in a join cannot be an index condition) ROOT=/path/to/api-tree FIRM=<firm id> node tools/speed17-marks-explain.cjs   (ROOT defaults to this tree; run it once per tree to compare)
 * Prints per statement: execution ms (median of 7), the indexes read, and whether journal_entry_pkey served the key compare. Exit 1 when journal_entry is Seq Scanned or its key index (journal_entry_pkey) is not used by a statement (the cast is back).
 *
 * OWNS      the on-database proof of the marks key rule, and its two pure readings (indexesRead: which indexes a plan node tree reads; verdictOf: is the key index used and is journal_entry never Seq Scanned).
 * CALLED BY by hand on a SIT box (never production) · tests/speed17-marks-explain.test.cjs (the two pure readings).
 * FLOW      find the client (ADMIN) ──▶ per statement: 8 EXPLAIN ANALYZE runs under the client's row security (the first is warm-up) ──▶ indexesRead ──▶ verdictOf ──▶ one JSON line each ──▶ exit 1 on any bad verdict
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 */

const RUNS = 8;
const MEDIAN_AT = 3;

/** every index a plan node tree reads, plus a marker for a journal_entry Seq Scan */
function indexesRead(node, found = []) {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'journal_entry') found.push('Seq Scan journal_entry');
  if (node['Index Name']) found.push(node['Index Name']);
  (node.Plans || []).forEach((child) => indexesRead(child, found));
  return found;
}

/** the verdict on the indexes a statement read: bad when journal_entry is Seq Scanned or the key index (journal_entry_pkey) is not used */
function verdictOf(seen) {
  const seqScan = [...seen].some((item) => /^Seq Scan/.test(item));
  const keyIndexUsed = seen.has('journal_entry_pkey');
  return { seqScan, keyIndexUsed, bad: seqScan || !keyIndexUsed };
}

/** the median of the timed runs (the warm-up run is not among them) */
const medianOf = (millis) => millis.slice().sort((left, right) => left - right)[MEDIAN_AT];

/** one statement explained RUNS times under the client's row security: { millis, seen } */
async function explainRuns(appClient, clientId, sql, params) {
  const millis = [],
    seen = new Set();
  for (let run = 0; run < RUNS; run++) {
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('app.current_entity', $1, true)", [clientId]);
    const reply = await appClient.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql, params);
    await appClient.query('ROLLBACK');
    const plan = reply.rows[0]['QUERY PLAN'][0];
    if (run) millis.push(plan['Execution Time']);
    indexesRead(plan.Plan).forEach((item) => seen.add(item));
  }
  return { millis, seen };
}

async function main() {
  const { Client } = require('pg');
  const root = process.env.ROOT || require('path').join(__dirname, '..');
  const detect = require(root + '/lib/mark-detect.js'),
    reviewMark = require(root + '/lib/review-mark.js'),
    adopters = require(root + '/lib/mark-adopters.js');
  const adopter = adopters.adopterOf('acc.audit');
  const admin = new Client({ connectionString: process.env.ADMIN });
  await admin.connect();
  const appClient = new Client({ connectionString: process.env.APP || process.env.ADMIN });
  await appClient.connect();
  const clientId = (await admin.query("SELECT identity_id id FROM identities WHERE bridge_id = 'BR-MISD-77'")).rows[0].id;
  const ids = (await admin.query('SELECT subject_id FROM review_mark WHERE entity_id = $1 LIMIT 60', [clientId])).rows.map((row) => row.subject_id);
  const statements = [
    ['nowSql (40 marked ids)', detect.nowSql(adopter), [clientId, ids]],
    ['coverage cleared', reviewMark.coverageSql(adopter).cleared, [clientId, 'acc.audit', '2020-01-01', '2026-11-16']]
  ];
  let badCount = 0;
  for (const [name, sql, params] of statements) {
    const { millis, seen } = await explainRuns(appClient, clientId, sql, params);
    const verdict = verdictOf(seen);
    if (verdict.bad) badCount++;
    console.log(JSON.stringify({ stmt: name, exec_ms_median: Math.round(medianOf(millis) * 100) / 100, indexes: [...seen], seq_scan: verdict.seqScan, key_index_used: verdict.keyIndexUsed }));
  }
  await appClient.end();
  await admin.end();
  process.exit(badCount ? 1 : 0);
}

if (require.main === module)
  main().catch((err) => {
    console.error(err.stack);
    process.exit(2);
  });
module.exports = { indexesRead, verdictOf, medianOf };
