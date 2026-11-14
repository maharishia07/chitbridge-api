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
/* BCP-MIG (17 Oct): the census is under `.tables` — reading the file's top level compared two keys (`at`, `tables`) and passed vacuously */
const baseline = require('../db/rls-baseline.json').tables;
const PROBES = require('./rls-sec75-tables.cjs');   /* SEC-75: how to plant a probe row in each table a SEC-75 migration closed */
const CORE_FORCED = ['chit_header', 'chit_status', 'chit_detail', 'state_log', 'catalogue_items'];
/** forced on prod AFTER the baseline census (09-26) was taken: b270 supplier_list, run by the owner 09-29 — the rebuild must force it too */
const FORCED_SINCE_BASELINE = ['supplier_list'];
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
  const since = FORCED_SINCE_BASELINE.filter((n) => !(census.get(n) || {}).forced);
  check('tables forced on prod since the census (supplier_list, b270) are forced here', since.length === 0, since.join(', '));
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

/** SEC-75: one planted row per shop in a table a SEC-75 migration closed. The owner plants it (FK checks off for the probe: the legacy cb_* keys point
 *  at cb_entity), then cb_app reads and writes it back under each shop's binding. */
async function checkClosedTable(client, table, spec) {
  const shopA = crypto.randomUUID(), shopB = crypto.randomUUID();
  const names = [spec.key].concat(Object.keys(spec.cols)).join(', ');
  const exprs = Object.keys(spec.cols).map((c) => spec.cols[c]);
  const insertSql = `INSERT INTO ${table} (${names}) VALUES (${['$1'].concat(exprs).join(', ')})`;
  await client.query('BEGIN');
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await client.query(insertSql, [shopA]);
  await client.query(insertSql, [shopB]);
  await client.query('COMMIT');
  const rows = async (entity) => asApp(client, entity, async () =>
    (await client.query(`SELECT ${spec.key} AS k FROM ${table} WHERE ${spec.key} IN ($1,$2)`, [shopA, shopB])).rows.map((r) => r.k));
  try {
    check(table + ': no shop context → zero rows', (await rows(null)).length === 0);
    const seenByA = await rows(shopA), seenByB = await rows(shopB);
    check(table + ': shop A sees its own row and never shop B\'s', seenByA.length === 1 && seenByA[0] === shopA);
    check(table + ': shop B sees its own row and never shop A\'s', seenByB.length === 1 && seenByB[0] === shopB);
    let refused = false;
    await asApp(client, shopA, async () => {
      try { await client.query(insertSql, [shopB]); } catch (e) { refused = /row-level security/i.test(e.message); }
    });
    check(table + ': shop A cannot write a row for shop B (WITH CHECK)', refused);
  } finally { await client.query(`DELETE FROM ${table} WHERE ${spec.key} IN ($1,$2)`, [shopA, shopB]); }
}

/** DB-102 (b851): a shop's PUBLIC catalogue is readable by another shop, but only the owner may change or delete it. The owner plants a public default schema and
 *  one item per shop (FK checks off for the probe); cb_app then reads, updates and deletes under each binding. A write the policy hides touches 0 rows. */
async function checkCataloguePublicReadOnly(client) {
  const shopA = crypto.randomUUID(), shopB = crypto.randomUUID();
  const itemA = crypto.randomUUID(), itemB = crypto.randomUUID();
  await client.query('BEGIN');
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await client.query(`INSERT INTO entity_schemas (entity_id, visibility) VALUES ($1, 'public')`, [shopA]);
  await client.query(`INSERT INTO catalogue_items (item_id, entity_id) VALUES ($1, $2), ($3, $4)`, [itemA, shopA, itemB, shopB]);
  await client.query('COMMIT');
  const run = (entity, sql, args) => asApp(client, entity, async () => (await client.query(sql, args)).rowCount);
  try {
    check("catalogue_items: shop B can still SELECT shop A's public item (reads unchanged)", (await run(shopB, 'SELECT 1 FROM catalogue_items WHERE item_id = $1', [itemA])) === 1);
    check("catalogue_items: shop B cannot UPDATE shop A's public item (0 rows)", (await run(shopB, 'UPDATE catalogue_items SET is_active = false WHERE item_id = $1', [itemA])) === 0);
    check("catalogue_items: shop B cannot DELETE shop A's public item (0 rows)", (await run(shopB, 'DELETE FROM catalogue_items WHERE item_id = $1', [itemA])) === 0);
    check("catalogue_items: shop A's item is still there after both attempts", (await run(shopA, 'SELECT 1 FROM catalogue_items WHERE item_id = $1 AND is_active', [itemA])) === 1);
    check("catalogue_items: shop B cannot INSERT an item for shop A (WITH CHECK)", await asApp(client, shopB, async () => { try { await client.query('INSERT INTO catalogue_items (item_id, entity_id) VALUES ($1, $2)', [crypto.randomUUID(), shopA]); return false; } catch (e) { return /row-level security/i.test(e.message); } }));
    check('catalogue_items: shop A can UPDATE its own item', (await run(shopA, 'UPDATE catalogue_items SET is_active = false WHERE item_id = $1', [itemA])) === 1);
    check('catalogue_items: shop A can DELETE its own item', (await run(shopA, 'DELETE FROM catalogue_items WHERE item_id = $1', [itemA])) === 1);
  } finally {
    await client.query('DELETE FROM catalogue_items WHERE item_id = ANY($1::uuid[])', [[itemA, itemB]]);
    await client.query('DELETE FROM entity_schemas WHERE entity_id = $1', [shopA]);
  }
}

/** SEC-75 + DB-103 (b855): the four tables that are not "a shop sees only its own". The owner plants rows (FK checks off); cb_app then reads, writes and deletes under
 *  shop A (owner / sender), shop B (the other side or a subscriber) and shop C (a stranger). A write a policy hides touches 0 rows; a write it forbids raises. */
async function checkSharedTables(client) {
  const [A, B, C] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const u = () => crypto.randomUUID();
  const run = (entity, sql, args) => asApp(client, entity, async () => (await client.query(sql, args)).rowCount);
  const refuses = (entity, sql, args) =>
    asApp(client, entity, async () => {
      try {
        await client.query('SAVEPOINT w');
        await client.query(sql, args);
        return false;
      } catch (e) {
        return /row-level security/i.test(e.message);
      }
    });
  const cx = u(), srcA = 'probe-' + u(), srcN = 'probe-' + u(), conA = 'probe-' + u(), mediaA = A + '/probe-' + u();
  await client.query('BEGIN');
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await client.query(
    "INSERT INTO connections (connection_id, from_entity_id, from_display_name, from_bridge_id, to_entity_id, to_display_name, to_bridge_id) VALUES ($1,$2,'a','a',$3,'b','b')",
    [cx, A, B]
  );
  await client.query('INSERT INTO catalogue_source (source_key, owner_entity_id) VALUES ($1,$2), ($3,NULL)', [srcA, A, srcN]);
  await client.query('INSERT INTO product_container (container_id, owner_entity_id) VALUES ($1,$2)', [conA, A]);
  await client.query("INSERT INTO media_blobs (key, entity_id, bytes) VALUES ($1,$2,'\\x00')", [mediaA, A]);
  await client.query('COMMIT');
  try {
    const seen = (entity) => run(entity, 'SELECT 1 FROM connections WHERE connection_id = $1', [cx]);
    const answer = (entity) => run(entity, "UPDATE connections SET status = 'accepted' WHERE connection_id = $1", [cx]);
    const remove = (entity) => run(entity, 'DELETE FROM connections WHERE connection_id = $1', [cx]);
    check('connections: no shop context sees nothing', (await seen(null)) === 0);
    check('connections: the sender and the receiver both see the row', (await seen(A)) === 1 && (await seen(B)) === 1);
    check('connections: a stranger sees nothing', (await seen(C)) === 0);
    check('connections: a stranger and the sender cannot answer the request', (await answer(C)) === 0 && (await answer(A)) === 0);
    check('connections: the receiver can answer', (await answer(B)) === 1);
    check('connections: nobody deletes (no policy)', (await remove(A)) === 0 && (await remove(B)) === 0);
    check(
      "connections: a shop cannot file a request in another shop's name",
      await refuses(C, "INSERT INTO connections (from_entity_id, from_display_name, from_bridge_id, to_entity_id, to_display_name, to_bridge_id) VALUES ($1,'x','x',$2,'y','y')", [A, B])
    );
    const shared = [
      ['catalogue_source', 'source_key', 'owner_entity_id', srcA, 'INSERT INTO catalogue_source (source_key, owner_entity_id) VALUES ($1,$2)', () => ['probe-' + u(), A]],
      ['product_container', 'container_id', 'owner_entity_id', conA, 'INSERT INTO product_container (container_id, owner_entity_id) VALUES ($1,$2)', () => ['probe-' + u(), A]],
      ['media_blobs', 'key', 'entity_id', mediaA, "INSERT INTO media_blobs (key, entity_id, bytes) VALUES ($1,$2,'\\x00')", () => [A + '/probe-' + u(), A]]
    ];
    for (const [table, keyCol, ownerCol, key, insertSql, insertArgs] of shared) {
      const read = (entity) => run(entity, 'SELECT 1 FROM ' + table + ' WHERE ' + keyCol + ' = $1', [key]);
      const rewrite = (entity) => run(entity, 'UPDATE ' + table + ' SET ' + ownerCol + ' = $2 WHERE ' + keyCol + ' = $1', [key, entity]);
      check(table + ': every shop can read it (read-wide)', (await read(B)) === 1 && (await read(C)) === 1);
      check(table + ': another shop cannot update it (0 rows)', (await rewrite(B)) === 0);
      check(table + ': another shop cannot delete it (0 rows)', (await run(B, 'DELETE FROM ' + table + ' WHERE ' + keyCol + ' = $1', [key])) === 0);
      check(table + ": another shop cannot insert a row in the owner's name (WITH CHECK)", await refuses(B, insertSql, insertArgs()));
      check(table + ': no shop context cannot write', await refuses(null, insertSql, insertArgs()));
      check(table + ': the owner can update and delete its own row', (await rewrite(A)) === 1 && (await run(A, 'DELETE FROM ' + table + ' WHERE ' + keyCol + ' = $1', [key])) === 1);
    }
    const claim = 'UPDATE catalogue_source SET owner_entity_id = $2 WHERE source_key = $1';
    check('catalogue_source: a shop may claim an ownerless row, and only for itself', (await run(B, claim, [srcN, B])) === 1 && (await refuses(B, claim, [srcN, A])));
  } finally {
    await client.query('DELETE FROM connections WHERE connection_id = $1', [cx]);
    await client.query('DELETE FROM catalogue_source WHERE source_key = ANY($1::text[])', [[srcA, srcN]]);
    await client.query('DELETE FROM product_container WHERE container_id = $1', [conA]);
    await client.query('DELETE FROM media_blobs WHERE key = $1', [mediaA]);
  }
}

/** every table the baseline marks with a `fix` is forced here, has a policy, and passes the two-shop probe */
async function checkClosedTables(client, census) {
  for (const table of Object.keys(baseline).filter((n) => baseline[n].fix)) {
    const row = census.get(table) || {};
    check(table + ': FORCE RLS and a policy on a database built from migrations/', !!row.rls && !!row.forced && row.policies > 0);
    if (PROBES[table] && PROBES[table].shared) continue; /* proved by checkSharedTables */
    if (PROBES[table]) await checkClosedTable(client, table, PROBES[table]);
    else check(table + ': has a probe-row recipe in tests/rls-sec75-tables.cjs', false);
  }
}

(async () => {
  const pool = new Pool({ connectionString: URL, max: 1 });
  const client = await pool.connect();
  try {
    console.log('\n── RLS on a database built from migrations/ ──');
    const census = await readCensus(client);
    checkCensus(census);
    await checkClosedTables(client, census);
    await checkIsolation(client);
    await checkCataloguePublicReadOnly(client);
    await checkSharedTables(client);
  } finally { client.release(); await pool.end(); }
  console.log('\n  ' + checks + ' checks');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('  ✗ rls-fresh-db could not run: ' + e.message); process.exit(1); });
