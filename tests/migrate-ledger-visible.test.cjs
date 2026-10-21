#!/usr/bin/env node
/**
 * tests/migrate-ledger-visible.test.cjs — "CAN THIS ROLE SEE THE LEDGER" (K-DB, 21 Oct 2026).
 *
 * WHY. schema_migrations is FORCE RLS with an owner-only policy (baseline schema_migrations_owner), so the app role reads 0 rows of a
 * full ledger. Before this, `--status` as cb_app said "every file pending" and apply() would have run the whole chain again.
 * Proves, on a database built from migrations/ (the fresh-db CI job, after tools/fresh-db-check.cjs):
 *   1 · ledgerVisible: the owner sees it; cb_app (SET ROLE) does not.
 *   2 · through a LOGIN role that is only a member of cb_app: status() answers blind, apply() answers blind and changes nothing
 *       (ledger rows and table count the same before and after).
 * Run: CB_FRESH_DB_URL=postgres://owner@… node tests/migrate-ledger-visible.test.cjs   (no URL → skipped, exit 0: the guards job has no DB)
 * FLOW  connect as owner → check 1 → make a throwaway login role → check 2 → drop the role
 */
'use strict';
const path = require('path'),
  crypto = require('crypto');
const URL = process.env.CB_FRESH_DB_URL || process.env.DATABASE_URL_FRESH;
if (!URL) {
  console.log('  - migrate-ledger-visible: CB_FRESH_DB_URL not set — skipped (the fresh-db CI job sets it)\n\n  0 checks');
  process.exit(0);
}
const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const migrate = require('../tools/migrate.cjs');
const PROBE_ROLE = 'kdb_ledger_probe';

let checks = 0,
  failed = 0;
const check = (what, ok, extra) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : ''));
};
const counts = async (client) =>
  (
    await client.query(`SELECT (SELECT count(*)::int FROM schema_migrations) AS ledger,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables`)
  ).rows[0];

/** check 1: the helper itself, owner and cb_app on one connection */
async function helperChecks(client) {
  const owner = await migrate.ledgerVisible(client);
  check('the owner sees the ledger', owner.sees === true, owner.role);
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE cb_app');
    const app = await migrate.ledgerVisible(client);
    check('cb_app cannot see the ledger', app.sees === false && app.role === 'cb_app', JSON.stringify(app));
  } finally {
    await client.query('ROLLBACK');
  }
}

/** check 2: status and apply through a login role that only has cb_app's grants */
async function runnerChecks(client) {
  const password = crypto.randomBytes(12).toString('hex');
  await client.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
  await client.query(`CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${password}' IN ROLE cb_app`);
  try {
    const probeUrl = URL.replace(/\/\/[^@/]+@/, '//' + PROBE_ROLE + ':' + password + '@');
    const before = await counts(client);
    const s = await migrate.status(probeUrl);
    check('status as a cb_app member answers blind', s.blind === PROBE_ROLE && !s.pending, JSON.stringify(s));
    const said = [];
    const r = await migrate.apply(probeUrl, { say: (line) => said.push(line) });
    check('apply as a cb_app member runs nothing', r.blind === PROBE_ROLE && r.ran.length === 0, JSON.stringify(r));
    check('apply says why', said.some((line) => line.startsWith('cannot see the ledger as ' + PROBE_ROLE + ': run as the owner')), said.join(' | '));
    const after = await counts(client);
    check('ledger rows and tables unchanged', before.ledger === after.ledger && before.tables === after.tables, JSON.stringify([before, after]));
  } finally {
    await client.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
  }
}

(async () => {
  const pool = new Pool({ connectionString: URL, max: 1 });
  const client = await pool.connect();
  try {
    await helperChecks(client);
    await runnerChecks(client);
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\n  ' + checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  ✗ migrate-ledger-visible: ' + e.message);
  process.exit(1);
});
