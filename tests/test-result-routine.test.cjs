#!/usr/bin/env node
/**
 * tests/test-result-routine.test.cjs — THE MONTHLY test_result ROUTINE, RUN INSIDE ONE ROLLED-BACK TRANSACTION (K-DB / DB-8, b221 v2).
 *
 * migrations/RUN-2026-10-21-5 (summarise) then -6 (purge) then -5 again, on a database built from migrations/ (the fresh-db CI job, or a
 * throwaway local one). The files' own BEGIN/COMMIT lines are taken out and everything runs in ONE transaction that is ROLLED BACK, so
 * the database is left as it was. Proves:
 *   1 · summarise adds one row per (shop, check, month, kind, layer) older than 12 whole months, with runs and flips; deletes nothing.
 *   2 · purge deletes only summarised old rows, keeps the latest row per check and the newest run of each kind, and leaves recent rows.
 *   3 · summarise again after the purge changes nothing (DO NOTHING: a month is never rebuilt from the leftovers — the v1 bug, runs 40 → 1).
 * Run: CB_FRESH_DB_URL=postgres://owner@… node tests/test-result-routine.test.cjs   (no URL → skipped, exit 0)
 * FLOW  read the two files → BEGIN → seed → summarise → purge → summarise → ROLLBACK
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const URL = process.env.CB_FRESH_DB_URL || process.env.DATABASE_URL_FRESH;
if (!URL) {
  console.log('  - test-result-routine: CB_FRESH_DB_URL not set — skipped (the fresh-db CI job sets it)\n\n  0 checks');
  process.exit(0);
}
const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const M = path.join(__dirname, '..', 'migrations');
/** a routine file as one statement batch, its own transaction lines and trailing report SELECT taken out */
const body = (file) =>
  fs
    .readFileSync(path.join(M, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/i.test(line))
    .join('\n')
    .replace(/\nSELECT count\(\*\) AS [a-z_]+ FROM test_result(_month)?;\s*$/, '\n');
const SUMMARISE = body('RUN-2026-10-21-5-test-result-summarise.sql');
const PURGE = body('RUN-2026-10-21-6-test-result-purge.sql');

const SHOP = '0c0c0c0c-0000-4000-8000-000000000001';
let checks = 0,
  failed = 0;
const check = (what, ok, extra) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : ''));
};

/** 40 old runs of check A in one month 15 months back (alternating pass/fail: 39 flips), 10 of B 14 months back, 5 recent of A */
async function seed(c) {
  await c.query(`INSERT INTO test_result (entity_id, case_key, status, run_kind, at, run_id)
    SELECT $1, 'A', CASE WHEN g % 2 = 0 THEN 'pass' ELSE 'fail' END, 't1',
           date_trunc('month', now() - interval '15 months') + g * interval '1 hour', gen_random_uuid()
      FROM generate_series(1, 40) g`, [SHOP]);
  await c.query(`INSERT INTO test_result (entity_id, case_key, status, run_kind, at, run_id)
    SELECT $1, 'B', 'pass', 't1', date_trunc('month', now() - interval '14 months') + g * interval '1 hour', gen_random_uuid()
      FROM generate_series(1, 10) g`, [SHOP]);
  await c.query(`INSERT INTO test_result (entity_id, case_key, status, run_kind, at, run_id)
    SELECT $1, 'A', 'pass', 't2', now() - g * interval '1 day', gen_random_uuid() FROM generate_series(1, 5) g`, [SHOP]);
}
const one = async (c, sql) => (await c.query(sql, [SHOP])).rows[0];
const detail = (c) => one(c, `SELECT count(*)::int AS n, count(*) FILTER (WHERE at > now() - interval '12 months')::int AS recent FROM test_result WHERE entity_id = $1`);
const summary = (c) => one(c, `SELECT count(*)::int AS n, coalesce(sum(runs), 0)::int AS runs, coalesce(sum(flips), 0)::int AS flips FROM test_result_month WHERE entity_id = $1`);

async function steps(c) {
  await seed(c);
  await c.query(SUMMARISE);
  const s1 = await summary(c);
  check('summarise: one row per old check-month, every old run counted, flips carried', s1.n === 2 && s1.runs === 50 && s1.flips === 39, JSON.stringify(s1));
  check('summarise deletes nothing', (await detail(c)).n === 55);
  await c.query(PURGE);
  const d = await detail(c);
  /* kept: the 5 recent rows, plus the latest old row of B (A's latest is a recent row) → 6; the newest t1 run is B's last row (same row) */
  check('purge: old summarised rows go, recent rows and the latest per check stay', d.recent === 5 && d.n === 6, JSON.stringify(d));
  await c.query(SUMMARISE);
  const s2 = await summary(c);
  check('summarise again after the purge changes nothing (DO NOTHING, never rebuilt from leftovers)', JSON.stringify(s2) === JSON.stringify(s1), JSON.stringify(s2));
}

(async () => {
  const pool = new Pool({ connectionString: URL, max: 1 });
  const c = await pool.connect();
  try {
    const before = await one(c, `SELECT (SELECT count(*)::int FROM test_result) AS r, (SELECT count(*)::int FROM test_result_month) AS m, $1::text AS shop`);
    await c.query('BEGIN');
    try {
      await steps(c);
    } finally {
      await c.query('ROLLBACK');
    }
    const after = await one(c, `SELECT (SELECT count(*)::int FROM test_result) AS r, (SELECT count(*)::int FROM test_result_month) AS m, $1::text AS shop`);
    check('rolled back: both tables as they were', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
  } finally {
    c.release();
    await pool.end();
  }
  console.log('\n  ' + checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  ✗ test-result-routine: ' + e.message);
  process.exit(1);
});
