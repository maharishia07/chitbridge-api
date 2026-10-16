#!/usr/bin/env node
/**
 * tests/rls-fresh-db.test.cjs — THE RLS ISOLATION TEST, ON A DATABASE BUILT FROM migrations/ ALONE (SCHEMA-FIX1, 16 Oct).
 *
 * WHY. Production was forced-RLS by hand-run DDL that no file held, so a restore from the repo came back with weaker isolation than
 * prod (SCHEMA-ASSESSMENT-2026-10-16 §4). This test runs in the `fresh-db` CI job after `tools/migrate.cjs` has built an EMPTY
 * Postgres, and asks the database itself:
 *   1 · every table prod forces (db/rls-baseline.json) is forced here too, and every RLS table has a policy;
 *   2 · the five core chit tables are FORCEd (the rows a rebuild used to lose);
 *   3 · as `cb_app` (the role the API runs as, NOBYPASSRLS): no context → zero rows; shop A sees only A; A cannot write for B.
 * Step 3 uses SET ROLE cb_app on the build connection, so it needs no password for the role; RLS keys on current_user.
 *
 * Run: CB_FRESH_DB_URL=postgres://… node tests/rls-fresh-db.test.cjs     (no URL → skipped with a warning, exit 0: the guards job has no DB)
 * FLOW  connect → census (1,2) → plant two shops' rows as the owner → read/write as cb_app (3) → clean up
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const URL = process.env.CB_FRESH_DB_URL || process.env.DATABASE_URL_FRESH;
if (!URL) { console.log('  - rls-fresh-db: CB_FRESH_DB_URL not set — skipped (the fresh-db CI job sets it)\n\n  0 checks'); process.exit(0); }

const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const baseline = require('../db/rls-baseline.json');
const CORE_FORCED = ['chit_header', 'chit_status', 'chit_detail', 'state_log', 'catalogue_items'];
/** a plain two-column tenant table with no foreign key, so a row can be planted without a parent (b99 ai_usage) */
const PROBE_TABLE = 'ai_usage';

let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : '')); };

/** the census: RLS on, forced, policy count — read from pg_class / pg_policies */
async function readCensus(client) {
  const r = await client.query(`SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`);
  return new Map(r.rows.map((row) => [row.name, row]));
}

/** the baseline is prod's census (09-26): what prod forces, the chain must force, and no RLS table may lack a policy */
function checkCensus(census) {
  const lacking = [...census.values()].filter((t) => t.rls && t.policies === 0).map((t) => t.name);
  check('every table with RLS on has a policy', lacking.length === 0, lacking.join(', '));
  const unforced = Object.keys(baseline).filter((n) => baseline[n].forced && census.has(n) && !census.get(n).forced);
  check('every table prod forces is forced by the chain', unforced.length === 0, unforced.join(', '));
  const noRls = Object.keys(baseline).filter((n) => baseline[n].rls && census.has(n) && !census.get(n).rls);
  check('every table prod has RLS on has it on here', noRls.length === 0, noRls.join(', '));
  const core = CORE_FORCED.filter((n) => !(census.get(n) || {}).forced);
  check('the five core chit tables are FORCE ROW LEVEL SECURITY', core.length === 0, core.join(', '));
}

/** run fn as cb_app inside one transaction that is always rolled back; `entity` is the app.current_entity (or null for none) */
async function asApp(client, entity, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE cb_app');
    if (entity) await client.query(`SELECT set_config('app.current_entity', $1, true)`, [entity]);
    return await fn();
  } finally { await client.query('ROLLBACK'); }
}

/** the isolation: two shops' rows planted by the owner, read and written back as the app role */
async function checkIsolation(client) {
  const shopA = crypto.randomUUID(), shopB = crypto.randomUUID();
  await client.query('BEGIN');
  await client.query(`INSERT INTO ${PROBE_TABLE} (entity_id, doc_type, model) VALUES ($1,'probe','probe'), ($2,'probe','probe')`, [shopA, shopB]);
  const count = async (entity) => asApp(client, entity, async () => Number((await client.query(`SELECT count(*) AS n FROM ${PROBE_TABLE} WHERE doc_type = 'probe'`)).rows[0].n));
  try {
    await client.query('COMMIT');
    check('no shop context → the app role reads zero rows', (await count(null)) === 0);
    check('shop A reads exactly its own row', (await count(shopA)) === 1);
    check('shop B reads exactly its own row', (await count(shopB)) === 1);
    let refused = false;
    await asApp(client, shopA, async () => {
      try { await client.query('SAVEPOINT w'); await client.query(`INSERT INTO ${PROBE_TABLE} (entity_id, doc_type, model) VALUES ($1,'probe','probe')`, [shopB]); }
      catch (e) { refused = /row-level security/i.test(e.message); }
    });
    check('shop A cannot write a row for shop B (WITH CHECK)', refused);
  } finally { await client.query(`DELETE FROM ${PROBE_TABLE} WHERE doc_type = 'probe' AND entity_id IN ($1,$2)`, [shopA, shopB]); }
}

(async () => {
  const pool = new Pool({ connectionString: URL, max: 1 });
  const client = await pool.connect();
  try {
    console.log('\n── RLS on a database built from migrations/ ──');
    checkCensus(await readCensus(client));
    await checkIsolation(client);
  } finally { client.release(); await pool.end(); }
  console.log('\n  ' + checks + ' checks');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('  ✗ rls-fresh-db could not run: ' + e.message); process.exit(1); });
