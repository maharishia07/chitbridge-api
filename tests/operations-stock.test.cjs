/**
 * operations-stock.test.cjs — T3-OPS (2026-10-14): CB Operations › Stock and its Home card read the ONE stock reader.
 *
 * Offline: the real stock-store.onHand, the real GET /api/till/stock and lib/home-facts' `operations` builder over a stand-in db. Held here:
 *   · onHand({ lots }) is ADDITIVE — without it the answer is byte-for-byte what the counter and the storefront read
 *   · with it: unit + the batches each figure was summed from, earliest expiry first; the untracked pool is not a batch
 *   · ?lots=1 → shelf[] fewest-on-hand first, below zero at the top, a name from the catalogue, NO value and NO cost; below_zero counted
 *   · the ledger not migrated → 503 with code STOCK_NOT_READY (the page branches on the code, never the sentence)
 *   · the Home card: "N items on the shelf" + "M below zero" (tone dn), or words when nothing moved; no low-stock line (no reorder level)
 * Run: node tests/operations-stock.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('node:assert');
const API = path.join(__dirname, '..');
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

let pass = 0, fail = 0;
const CASES = [];
const t = (name, fn) => CASES.push([name, fn]);

let TABLE = true, SQL = [];
const BAL = [
  { item_id: 'i-rice', lot: 'B2', expires_at: '2026-12-01', qty: 2.5, value: 125, avg_cost: 50, unit: 'kg', last_at: '2026-10-13T10:00:00Z', moves: 1 },
  { item_id: 'i-rice', lot: 'B1', expires_at: '2026-11-01', qty: 4, value: 200, avg_cost: 50, unit: 'kg', last_at: '2026-10-13T10:00:00Z', moves: 1 },
  { item_id: 'i-dal', lot: '', expires_at: null, qty: -1, value: -140, avg_cost: 140, unit: null, last_at: '2026-10-13T10:00:00Z', moves: 1 },
  { item_id: 'i-oil', lot: '', expires_at: null, qty: 3, value: 600, avg_cost: 200, unit: 'l', last_at: '2026-10-13T10:00:00Z', moves: 1 },
];
const db = { query: async (sql) => {
  SQL.push(sql);
  if (/FROM stock_balance/.test(sql)) return { rows: BAL };
  if (/FROM catalogue_items/.test(sql)) return { rows: [{ id: 'i-rice', name: 'Ponni Rice' }, { id: 'i-dal', name: 'Toor Dal' }, { id: 'i-oil', name: 'Groundnut Oil' }] };
  return { rows: [] };
} };
const withEntity = async (_e, fn) => fn(db);
mock('/db', { withEntity, query: db.query, readBatch: async () => [], pool: { query: db.query } });
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); }, {
  entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next(), requireOwner: (req, res, next) => next(),
}));
const schema = require(API + '/lib/schema');
schema.hasTable = async (tb) => (tb === 'stock_balance' ? TABLE : true);
require(API + '/lib/cost').canReadSafe = async () => true;
const store = require(API + '/lib/stock-store');
const home = require(API + '/lib/home-facts');

t('onHand without lots is unchanged — { qty, value } per product, batches summed', async () => {
  const by = await store.onHand('e1', withEntity, {});
  assert.deepStrictEqual(by['i-rice'], { qty: 6.5, value: 325 });
  assert.deepStrictEqual(by['i-dal'], { qty: -1, value: -140 });
});
t('onHand({ lots }) adds unit + the batches, earliest expiry first; the untracked pool is not listed', async () => {
  const by = await store.onHand('e1', withEntity, { lots: true });
  assert.strictEqual(by['i-rice'].unit, 'kg');
  assert.deepStrictEqual(by['i-rice'].lots.map((l) => l.lot), ['B1', 'B2']);
  assert.deepStrictEqual(by['i-oil'].lots, []);
});

function serve() {
  const app = express(); app.use(express.json()); app.use('/api/till', require(API + '/routes/till'));
  return new Promise((res) => { const s = app.listen(0, () => res(s)); });
}
function get(s, p) {
  return new Promise((res, rej) => http.get({ port: s.address().port, path: p }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(b || 'null') })); }).on('error', rej));
}
t('GET /api/till/stock?lots=1 → shelf fewest first (below zero on top), names, batches, below_zero — no value, no cost in shelf', async () => {
  const s = await serve();
  try {
    const r = await get(s, '/api/till/stock?lots=1');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.shelf.map((x) => x.name), ['Toor Dal', 'Groundnut Oil', 'Ponni Rice']);
    assert.strictEqual(r.body.below_zero, 1);
    assert.strictEqual(r.body.shelf[0].below_zero, true);
    assert.ok(!/avg_cost|"value"/.test(JSON.stringify(r.body.shelf)), 'no cost or value in items');
    assert.deepStrictEqual(r.body.shelf[2].lots[0], { lot: 'B1', expires_at: '2026-11-01', qty: 4 });
    const plain = await get(s, '/api/till/stock');
    assert.strictEqual(plain.body.shelf, undefined, 'the counter\'s answer is unchanged');
    TABLE = false;
    const nr = await get(s, '/api/till/stock?lots=1');
    assert.deepStrictEqual([nr.status, nr.body.code], [503, 'STOCK_NOT_READY']);
  } finally { TABLE = true; s.close(); }
});
t('Home card operations: on the shelf + below zero (tone dn); nothing moved → words; not migrated → unavailable', async () => {
  const a = await home.BUILD.operations({ entity: 'e1' });
  assert.deepStrictEqual(a.lines.map((l) => l.text), ['2 items on the shelf', '1 item below zero']);
  assert.strictEqual(a.lines[1].tone, 'dn');
  const saved = BAL.splice(0);
  try { const b = await home.BUILD.operations({ entity: 'e1' }); assert.deepStrictEqual(b.lines.map((l) => l.text), ['No stock moved yet']); }
  finally { BAL.push(...saved); }
  TABLE = false;
  try { const c = await home.BUILD.operations({ entity: 'e1' }); assert.deepStrictEqual(c.lines, []); assert.ok(c.unavailable); }
  finally { TABLE = true; }
});

(async () => {
  for (const [name, fn] of CASES) {
    try { await fn(); console.log('ok  ' + name); pass++; }
    catch (e) { console.log('XX  ' + name + ' — ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
