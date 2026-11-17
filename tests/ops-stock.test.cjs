/**
 * ops-stock.test.cjs — CB Operations › Stock and its Home card (T3-OPS, 2026-10-14), over a stand-in database.
 *
 *   · stock-store.onHand({ lots: true }) — the batches ride on the SAME read, earliest expiry first, the untracked pool left out;
 *     without the option the shape is unchanged (the counter and the storefront read it)
 *   · GET /api/till/stock?detail=1 — name · unit from ONE more read (catalogue-read.ITEM_NAMES_SQL), lots per item; no avg_cost for an
 *     actor without can_see_costs; the stock ledger missing → not_ready with a code and a sentence, never a 500; the plain call unchanged
 *   · GET /api/facts/operations — on the shelf · below zero (a fact), never a "low stock" count (no reorder level is kept)
 *
 * Run: node tests/ops-stock.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

const OWNER = { identity_id: 'e1', identity_type: 'entity' };
let WHO = OWNER, HAS_TABLE = true, MAY_COST = true, trips = 0, sqls = [];
const ROWS = [
  { item_id: 'rice', lot: 'B2', expires_at: new Date('2026-12-01'), qty: '2.5', value: '125', avg_cost: '50', last_at: new Date(), moves: 1 },
  { item_id: 'rice', lot: 'B1', expires_at: new Date('2026-11-01'), qty: '4', value: '200', avg_cost: '50', last_at: new Date(), moves: 1 },
  { item_id: 'rice', lot: '', expires_at: null, qty: '1', value: '50', avg_cost: '50', last_at: new Date(), moves: 1 },
  { item_id: 'dal', lot: '', expires_at: null, qty: '-1', value: '-140', avg_cost: '140', last_at: new Date(), moves: 1 },
];
const withEntity = async (_e, fn) => { trips++; return fn({ query: async (sql) => {
  sqls.push(sql);
  if (/FROM stock_balance/.test(sql)) return { rows: ROWS };
  /* R104: the ONE flags read (lib/stocked.FLAGS_SQL) — rice and dal say counted, the dosa says nothing (the trade decides) */
  if (/item_data->'stocked'/.test(sql)) return { rows: [{ item_id: 'rice', batch_tracked: null, stocked: true }, { item_id: 'dal', batch_tracked: null, stocked: true }, { item_id: 'dosa', batch_tracked: null, stocked: null }] };
  if (/FROM catalogue_items/.test(sql)) return { rows: [{ id: 'rice', name: 'Ponni Rice', unit: 'kg' }, { id: 'dal', name: 'Toor Dal', unit: null }, { id: 'dosa', name: 'Masala Dosa', unit: 'plate' }] };
  return { rows: [] };
} }); };
mock('/db', { withEntity, query: async () => ({ rows: [] }), readBatch: async () => [{ rows: [] }] });
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(),
}));
require(API + '/lib/schema').hasTable = async (tb) => (tb === 'stock_balance' ? HAS_TABLE : true);
require(API + '/lib/cost').canReadSafe = async () => MAY_COST;

const store = require(API + '/lib/stock-store');
const home = require(API + '/lib/home-facts');

function get(port, p) {
  return new Promise((resolve, reject) => {
    trips = 0; sqls = [];
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j, trips }); }); }).on('error', reject);
  });
}

(async () => {
  console.log('\nT3-OPS · the one stock reader, widened\n');
  const plain = await store.onHand('e1', withEntity, {});
  t('onHand without lots: the old shape (qty · value)', plain.rice, { qty: 7.5, value: 375 });
  const lots = await store.onHand('e1', withEntity, { lots: true });
  t('onHand { lots }: the same total', [lots.rice.qty, lots.rice.value], [7.5, 375]);
  t('…batches earliest expiry first, the untracked pool left out', lots.rice.lots.map((l) => [l.lot, l.qty, l.expires_at]), [['B1', 4, '2026-11-01'], ['B2', 2.5, '2026-12-01']]);
  t('…an untracked product has no batches', lots.dal.lots, []);

  const app = express();
  app.use('/api/till', require(API + '/routes/till'));
  app.use('/api/facts', require(API + '/routes/facts'));
  const srv = app.listen(0); const port = srv.address().port;

  let r = await get(port, '/api/till/stock?detail=1');
  t('detail: 200', r.status, 200);
  t('detail: name · unit · lots on each balance', [r.json.balances.rice.name, r.json.balances.rice.unit, r.json.balances.rice.lots.length, r.json.balances.dal.name], ['Ponni Rice', 'kg', 2, 'Toor Dal']);
  t('detail: three reads — the shelf, the counted flags (R104, one for every item), then the names (never one per item)', r.trips, 3);
  t('detail: the names read is the lifted ITEM_NAMES_SQL', sqls.filter((s) => s === require(API + '/lib/catalogue-read').ITEM_NAMES_SQL).length, 1);
  r = await get(port, '/api/till/stock');
  t('plain: the counter\'s shape is unchanged (no name, no lots)', Object.keys(r.json.balances.rice).sort(), ['avg_cost', 'qty']);
  MAY_COST = false; r = await get(port, '/api/till/stock?detail=1');
  t('detail: an actor without can_see_costs gets no avg_cost', r.json.balances.rice.avg_cost, undefined);
  MAY_COST = true;
  HAS_TABLE = false; r = await get(port, '/api/till/stock?detail=1');
  t('detail: no stock ledger -> 200 with a code and a sentence, never a 500', [r.status, r.json.not_ready, typeof r.json.says], [200, 'STOCK_LEDGER_MISSING', 'string']);

  r = await get(port, '/api/facts/operations');
  t('facts/operations: no ledger -> no lines, the reason given', [r.json.lines.length, !!r.json.unavailable], [0, true]);
  HAS_TABLE = true; r = await get(port, '/api/facts/operations');
  t('facts/operations: on the shelf · below zero', r.json.lines.map((l) => [l.text, l.tone || null]), [['1 item on the shelf', null], ['1 item below zero', 'dn']]);
  t('facts/operations: two trips — the shelf and the counted flags (R104), never one per item', r.trips, 2);
  t('facts/operations: no "low" figure (no reorder level is kept)', /\blow\b/i.test(JSON.stringify(r.json)), false);
  t('facts/operations is a card the route knows', typeof home.BUILD.operations, 'function');

  /* ── R104: a tiffin shop — Masala Dosa sold 40 times, never received (−40), is NOT stock ── */
  console.log('\nR104 · a dish made to order on Stock and the Home card\n');
  const G = require(API + '/lib/govresolve');
  G.verticalOf = async () => G.verticalFrom({ sectors: ['tiffin'] });
  ROWS.push({ item_id: 'dosa', item_kind: 'catalogue', lot: '', expires_at: null, qty: '-40', value: '0', avg_cost: '0', last_at: new Date(), moves: 40 });
  r = await get(port, '/api/till/stock?detail=1');
  t('detail: the dosa STAYS with its old figure, marked counted:false; rice and dal counted:true', [r.json.balances.dosa.qty, r.json.balances.dosa.counted, r.json.balances.rice.counted, r.json.balances.dal.counted], [-40, false, true, true]);
  t('detail: not_counted says how many — the screen says it, never silent', r.json.not_counted, 1);
  t('detail: three reads — the shelf, the flags (one, for every item), the names', r.trips, 3);
  r = await get(port, '/api/till/stock');
  t('plain: the counter\'s shape is unchanged (no counted key, no extra read)', [Object.keys(r.json.balances.dosa).sort(), r.json.not_counted, r.trips], [['avg_cost', 'qty'], undefined, 1]);
  r = await get(port, '/api/facts/operations');
  t('facts/operations: the dosa is not "below zero" — Home agrees with Stock (1 on the shelf · dal below zero)', r.json.lines.map((l) => l.text), ['1 item on the shelf', '1 item below zero']);
  t('facts/operations: two trips — the shelf and the one flags read', r.trips, 2);
  G.verticalOf = async () => G.verticalFrom({ sectors: ['vegetables'] });
  r = await get(port, '/api/facts/operations');
  t('…a vegetable shop with the same rows: the unflagged dosa IS counted (2 below zero) — nothing changed for them', r.json.lines.map((l) => l.text), ['1 item on the shelf', '2 items below zero']);

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
