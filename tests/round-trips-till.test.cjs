'use strict';
/**
 * tests/round-trips-till.test.cjs — ⭐⭐ THE COUNTER'S SNAPSHOT HAS A ROUND-TRIP BUDGET (2026-09-29, M36).
 *
 * `GET /till/snapshot` is the counter's open and its sync: every till calls it on boot and roughly every fifteen minutes.
 * The backlog measured it by reading the code: five separate `withEntity` transactions for the route's own tables, one
 * after another, plus the ones the tax shelf, the offers, the reward programme and the categories each open for themselves.
 *
 * ⭐ Counted the way round-trips-chit.test.cjs counts: a bare query() is one trip, a withEntity() is BEGIN · set_config ·
 * its statements · COMMIT, and a readBatch() is ONE trip whatever it carries.
 *
 * ⚠️ A BUDGET, NOT A SNAPSHOT: a ceiling with a little headroom, lowered when the endpoint gets cheaper, never raised
 * without saying why here.
 *
 * Run: node tests/round-trips-till.test.cjs   · no DB, no network (the app listens on a port the OS chooses).
 */
const path = require('path');
const API = path.join(__dirname, '..');

let queries = [];
let trips = 0;
let failInSharedTx = false;   /* ⚠️ the fallback case: a statement that fails inside the shared transaction */

function rowsFor(sql) {
  if (/FROM identities WHERE identity_id/.test(sql)) return [{ display_name: 'Shop', gstn: null, country: 'IN', policy_flags: {}, user_id: 'shop' }];
  if (/FROM entity_profile/.test(sql)) return [{ trade_mode: null, markets: null, sectors: ['grocery'], adopted: null }];
  if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: 2 }];
  if (/FROM catalogue_items/.test(sql)) return [
    { item_id: 'i1', item_data: { name: 'Rice', price: 60, unit: 'kg' }, is_active: true, updated_at: '2026-09-29T10:00:00.000Z' },
    { item_id: 'i2', item_data: { name: 'Dal', price: 120, unit: 'kg' }, is_active: true, updated_at: '2026-09-29T10:00:01.000Z' }];
  if (/FROM customer_list/.test(sql)) return [{ identity_id: 'c1', display_name: 'Kumar', phone: '9', groups: [], last_txn_at: null }];
  return [];
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);        /* inlineSql and the tenant list stay real — only the wire is replaced */
const withEntity = async (id, fn) => {
  trips += 3;
  let n = 0;
  return fn({ query: async (s) => {
    queries.push('TX ' + norm(s)); trips += 1; n += 1;
    /* the adoption read is the fifth statement of the shared read and the first of its own — fail it only when shared */
    if (failInSharedTx && n > 1 && /FROM catalogue_adoption/.test(s)) throw Object.assign(new Error('simulated'), { code: '42P01' });
    return { rows: rowsFor(String(s)) };
  } });
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => { queries.push('Q  ' + norm(sql)); trips += 1; return { rows: rowsFor(String(sql)) }; },
  withEntity,
  withTransaction: (fn) => withEntity(null, fn),
  onEntity: async (id, db, fn) => (db && typeof db.query === 'function') ? fn(db) : withEntity(id, fn),
  /* ⭐ ONE trip, however many statements — the text is still built by the real inlineSql */
  readBatch: async (id, actor, stmts) => {
    stmts.forEach((s) => { realDb.inlineSql(s.text, s.params); queries.push('RB ' + norm(s.text)); });
    trips += 1;
    return stmts.map((s) => ({ rows: rowsFor(String(s.text)) }));
  },
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
    requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const express = require('express');
const app = express();
app.use('/api/till', require(path.join(API, 'routes', 'till')));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};

/**
 * ── THE CEILING ──────────────────────────────────────────────────────────────────────────────────────────────
 * 2026-09-29, before M36: a full snapshot 50 trips, a delta 49 — the route's own five tables were five transactions.
 * After M36 (one shared transaction for them): 38 and 37. Ceiling 40 — two spare, so a genuine need does not have to
 * edit this file in the same commit. What is left is inside the libs (tax shelf, offers, reward programme, categories,
 * invoiceParty), each opening its own transaction — an onEntity pass-through is the next cut (BACKLOG M36 part 2).
 * ⚠️ RAISED 40 → 43 ON 2026-09-30, AND WHY (critic M5): the snapshot now says whether the shop's ledger is on (`books: true`),
 * because the counter was offering credit to shops with no ledger. That is one read of books_setting inside the shared
 * transaction, in a savepoint (SAVEPOINT · SELECT · RELEASE = 3 trips) so a server before b272 cannot lose the whole shared
 * read to "table not there": 38 → 41, still two spare. The answer is cached 60 s per process (lib/books-hooks isOn), and the
 * dues transaction (4 trips once b273 exists) no longer runs for a shop whose ledger is off — for those this is a saving.
 */
const BUDGET = Number(process.env.TILL_SNAPSHOT_BUDGET || 43);

let srv;
async function measure(label, qs) {
  queries = []; trips = 0;
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/till/snapshot${qs}`);
  const body = await r.json().catch(() => ({}));
  console.log(`\n── ${label} ── status ${r.status} · ${trips} trip(s)`);
  queries.forEach((q, i) => console.log('    ' + String(i + 1).padStart(2) + '  ' + q.slice(0, 110)));
  return { status: r.status, body, trips, queries: queries.slice() };
}

srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const full = await measure('a full snapshot', '');
    t('a full snapshot answers 200', full.status === 200);
    t(`a full snapshot stays within ${BUDGET} trips`, full.trips <= BUDGET, full.trips + ' used');
    /* ⭐ the answer is still whole — a cheaper snapshot that dropped a section would pass the budget and break the counter */
    t('the items still arrive', Array.isArray(full.body.items) && full.body.items.length === 2, String(full.body.items && full.body.items.length));
    t('the customers still arrive', Array.isArray(full.body.customers) && full.body.customers.length === 1);
    t('the live count still arrives', full.body.total === 2, String(full.body.total));
    t('the profile still arrives — a grocery shop is asked for a batch', !!(full.body.lot_fields && full.body.lot_fields.vertical === 'food'),
      JSON.stringify(full.body.lot_fields || null).slice(0, 60));
    /* ⭐⭐ the fix itself: five tables, ONE transaction — the count above could pass by a saving elsewhere */
    const own = full.queries.map((q, i) => ({ q, i })).filter((x) => /^TX .*(sectors, adopted FROM entity_profile|FROM catalogue_items|FROM customer_list|FROM catalogue_adoption)/.test(x.q));
    t('⭐ the route\'s own five reads run back to back in ONE transaction', own.length === 5 && own[4].i - own[0].i === 4,
      own.map((x) => x.i + 1).join(','));

    const delta = await measure('a delta (?since=)', '?since=2026-09-29T09:00:00.000Z');
    t('a delta answers 200', delta.status === 200);
    t(`a delta stays within ${BUDGET} trips`, delta.trips <= BUDGET, delta.trips + ' used');
    t('a delta hands back a cursor', typeof delta.body.at === 'string');

    /* ⚠️⚠️ ONE FAILED STATEMENT ABORTS A POSTGRES TRANSACTION — the shared read must fall back to reading each alone, or a
       shop with one broken table would lose its items, its customers and its count with it */
    failInSharedTx = true;
    const fb = await measure('the shared read fails — each section read on its own', '');
    failInSharedTx = false;
    t('still 200 when the shared read fails', fb.status === 200);
    t('the items still arrive after the fallback', Array.isArray(fb.body.items) && fb.body.items.length === 2, String(fb.body.items && fb.body.items.length));
    t('the customers still arrive after the fallback', Array.isArray(fb.body.customers) && fb.body.customers.length === 1);
    t('the live count still arrives after the fallback', fb.body.total === 2, String(fb.body.total));
    t('the profile still arrives after the fallback', !!(fb.body.lot_fields && fb.body.lot_fields.vertical === 'food'));
  } catch (e) { fail++; console.log('  FAIL the measurement ran   ' + (e && e.stack)); }
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
