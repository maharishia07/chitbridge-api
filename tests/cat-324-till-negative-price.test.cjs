'use strict';
// @type: contract
/**
 * tests/cat-324-till-negative-price.test.cjs — CAT-324: a stored NEGATIVE price never reaches the counter as a price.
 *
 * OWNS      GET /api/till/snapshot sends price null (the till's existing "no price" path) for a stored price below zero, in any stored shape (number, string,
 *           { amount, currency }); zero stays a price (a free sample); a good price is unchanged. The rule is lib/sellable-price.js, the same one
 *           routes/catalogue.js throwIfUnpriced refuses an order line with (CAT-318) — one rule, two doors, the sentences kept word for word.
 * Hand-computed: rows 60 · -5 · "-3" · 0 · null · {amount:-2,currency:'INR'} · "abc" → 60 · null · null · 0 · null · null · null.
 * Break check: take sellablePrice.soldAt out of tillItem and the negative rows come back as -5, -3, -2 (the test fails).
 * CALLED BY scripts/guards.cjs · CI. No database, no network. CARD 07-offers-pricing-and-combos/till-price-and-worth-an-offer
 * Run: node tests/cat-324-till-negative-price.test.cjs
 */
process.env.TZ = 'Asia/Kolkata';
const path = require('path');
const API = path.join(__dirname, '..');
const ROWS = [['a', 60], ['b', -5], ['c', '-3'], ['d', 0], ['e', null], ['f', { amount: -2, currency: 'INR' }], ['g', 'abc']];
const WANT = { a: 60, b: null, c: null, d: 0, e: null, f: null, g: null };
function rowsFor(sql) {
  if (/FROM identities WHERE identity_id/.test(sql)) return [{ display_name: 'Shop', gstn: null, country: 'IN', policy_flags: {}, user_id: 'shop' }];
  if (/FROM entity_profile/.test(sql)) return [{ trade_mode: null, markets: null, sectors: ['grocery'], adopted: null }];
  if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: ROWS.length }];
  if (/FROM catalogue_items/.test(sql)) return ROWS.map(([id, price]) => ({ item_id: id, item_data: { name: 'Item ' + id, price, unit: 'kg' }, is_active: true, updated_at: '2026-09-29T10:00:00.000Z' }));
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
const withEntity = async (id, fn) => fn({ query: async (s) => ({ rows: rowsFor(String(s)) }) });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => ({ rows: rowsFor(String(sql)) }),
  withEntity, withTransaction: (fn) => withEntity(null, fn),
  onEntity: async (id, db, fn) => (db && typeof db.query === 'function') ? fn(db) : withEntity(id, fn),
  readBatch: async (id, actor, stmts) => stmts.map((s) => ({ rows: rowsFor(String(s.text)) }))
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const logger = require(path.join(API, 'lib', 'logger'));
logger.warn = () => {};

const app = require('express')();
app.use('/api/till', require(path.join(API, 'routes', 'till')));
const sellable = require(path.join(API, 'lib', 'sellable-price'));
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); } };

t('the rule: 60 and 0 sell, -0.01 is negative, NaN and null are unset', sellable.fault(60) === null && sellable.fault(0) === null && sellable.fault(-0.01) === 'negative' && sellable.fault(NaN) === 'unset' && sellable.fault(null) === 'unset');
t('soldAt: -5 becomes null, 0 stays 0', sellable.soldAt(-5) === null && sellable.soldAt(0) === 0 && sellable.soldAt(60) === 60);

const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/till/snapshot`);
    const body = await r.json().catch(() => ({}));
    const got = {};
    for (const it of body.items || []) got[it.item_id] = it.price;
    t('snapshot answers 200 with all seven rows', r.status === 200 && (body.items || []).length === 7, r.status + ' ' + JSON.stringify(got));
    for (const id of Object.keys(WANT)) t(`row ${id}: price ${JSON.stringify(ROWS.find((x) => x[0] === id)[1])} reaches the counter as ${WANT[id]}`, got[id] === WANT[id], String(got[id]));
    const cat = require(path.join(API, 'routes', 'catalogue.js'));
    t('the order door keeps its two sentences (CAT-318): negative and unset', /not valid, so it cannot be ordered right now/.test(sellable.negativeSaid('Rice')) && /is not set — order cannot be placed/.test(sellable.unsetSaid('Rice')) && !!cat);
  } finally {
    process.exitCode = fail ? 1 : 0;
    console.log(pass + ' passed, ' + fail + ' failed');
    srv.close();
  }
});
