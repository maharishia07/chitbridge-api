'use strict';
/**
 * tests/till-network-source-cost.test.cjs — [CTR-171] a SOURCE shop's cost never reaches the till.
 *
 * GET /till/snapshot pushNetworkLines reads the ADOPTED catalogue lines. Several counter fields are copied raw from the source item
 * (pricing_tiers, combo_of, avail), so a cost key the source shop kept inside one rode to the cashier's device. The fix strips
 * the source items through the ONE strip (catalogue-view publicItemsOf → cost.dropCostKeys), the same as CAT-241 does for the public view.
 * Driven through the real route with a real adoption row; catalogue-build.resolve answers the source's items (that is the source read).
 * Read as a cost-blind cashier AND as the owner: no source cost reaches either; the till's own fields are unchanged.
 * Run: node tests/till-network-source-cost.test.cjs   · no DB, no network.
 */
const path = require('path');
const API = path.join(__dirname, '..');
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);

const SOURCE_ITEM = {
  name: 'Brand Widget', price: 90, unit: 'piece', status: 'available',
  cost: { value: 41, source: 'manual' }, unit_cost: 41, supplier_note: 'buy from Ravi at 41',
  pricing_tiers: [{ from: 1, price: 90, unit_cost: 41 }],
  avail: { qty: 5, source: 'feed', as_of: '2026-10-29', landed_cost: 44 },
  combo_of: [{ name: 'Part', qty: 1, cost: 12, supplier_note: 'x' }]
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
function rowsFor(sql) {
  if (/FROM identities WHERE identity_id/.test(sql)) return [{ display_name: 'Shop', gstn: null, country: 'IN', policy_flags: {}, user_id: 'shop' }];
  if (/FROM entity_profile/.test(sql)) return [{ trade_mode: null, markets: null, sectors: ['grocery'], adopted: null }];
  if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: 1 }];
  if (/FROM catalogue_items/.test(sql)) return [{ item_id: 'i1', item_data: { name: 'Rice', price: 60, unit: 'kg' }, is_active: true, updated_at: '2026-09-29T10:00:00.000Z' }];
  if (/FROM catalogue_adoption/.test(sql)) return [{ source_key: 'brand-src', commercials: { 'Brand Widget': { price: 95 } } }];
  return [];
}
const withEntity = async (id, fn) => fn({ query: async (s) => ({ rows: rowsFor(norm(s)) }) });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => ({ rows: rowsFor(norm(sql)) }),
  withEntity, withTransaction: (fn) => withEntity(null, fn),
  onEntity: async (id, db, fn) => (db && typeof db.query === 'function') ? fn(db) : withEntity(id, fn),
  readBatch: async (id, actor, stmts) => stmts.map((s) => ({ rows: rowsFor(norm(s.text)) }))
}) };
let who = 'owner';
const IDENTITIES = { owner: { identity_id: 'e1', identity_type: 'entity' }, cashier: { identity_id: 'u9', identity_type: 'user', parent_entity_id: 'e1', role: 'cashier' } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = IDENTITIES[who]; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
    requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
/* the source read: the brand's items, cost and all, exactly as a source shop keeps them */
require(path.join(API, 'lib', 'catalogue-build')).resolve = async (key, commercials) => ({
  title: 'Brand', owner_entity_id: 'brand1', items: [Object.assign({}, SOURCE_ITEM, { commercials: commercials['Brand Widget'] })] });

const express = require('express');
const app = express();
app.use('/api/till', require(path.join(API, 'routes', 'till')));
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
const LEAK = /unit_cost|supplier_note|landed_cost|"cost"|"value":41|:41\b|:44\b|:12\b|Ravi/;

const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    for (const role of ['cashier', 'owner']) {
      who = role;
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/till/snapshot`);
      const body = await r.json();
      const network = (body.items || []).filter((i) => i.source);
      t(role + ' · snapshot answers 200 with the network line on the shelf', r.status === 200 && network.length === 1, 'status ' + r.status + ' items ' + (body.items || []).length);
      const text = JSON.stringify(network);
      t(role + ' · ⭐ no source cost key or value reaches the till', !LEAK.test(text), text.slice(0, 300));
      const w = network[0] || {};
      t(role + ' · the till keeps what it prints: name, price, unit, source, tiers (price), avail qty', w.name === 'Brand Widget' && w.price === 95 && w.unit === 'piece' && w.source && w.source.key === 'brand-src' &&
        w.pricing_tiers && w.pricing_tiers[0].price === 90 && w.avail && w.avail.qty === 5, text.slice(0, 300));
      const own = (body.items || []).find((i) => i.name === 'Rice');
      t(role + ' · the shop\'s own item is unchanged', own && own.price === 60 && own.unit === 'kg');
    }
  } catch (e) { fail++; console.log('  FAIL the run   ' + (e && e.stack)); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
