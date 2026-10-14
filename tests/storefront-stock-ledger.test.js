'use strict';
// storefront-stock-ledger.test.js — T1-INV (2026-10-14) "one stock truth".
//
// The storefront used to read ONLY the connector's stamped figure (item_data.avail), so a shop with no connector showed a
// shopper NO stock although every receipt and sale moved its own ledger (stock_balance, since b214). This drives the real
// buildPublicView() — the payload GET /api/catalogue/:bridge_id sends — with the ledger and the policy stood in, and proves:
//   · no connector  → the ledger's figure, summed across batches, as avail { qty, source:'ledger', as_of } (one shape)
//   · a connector owns the shop's `stock` stream (policy stream_owner.stock) → its stamped figure, the ledger not read
//   · never moved / below zero / ledger not migrated → unknown (no figure), never 0
//   · qty_zero_hides acts on the same number the shopper sees · value and cost never leave the server
// Run: node tests/storefront-stock-ledger.test.js
const assert = require('node:assert');
const view = require('../lib/catalogue-view');
const catalogueRead = require('../lib/catalogue-read');
const orderInput = require('../lib/order-input');
const policy = require('../lib/policy');
const schema = require('../lib/schema');

let pass = 0, fail = 0;
const CASES = [];
const t = (name, fn) => CASES.push([name, fn]);

const ENTITY = { identity_id: 'e1', bridge_id: 'CBTEST0001', display_name: 'Test Store' };
const RICE = 'i-rice', DAL = 'i-dal', SALT = 'i-salt', OIL = 'i-oil';

let POLICY = {}, LEDGER_TABLE = true, BALANCES = [], LEDGER_READS = 0;
policy.get = async () => Object.assign({ qty_zero_hides: 'off', stream_owner: {} }, POLICY);
schema.hasTable = async (tb) => (tb === 'stock_balance' ? LEDGER_TABLE : false);

function items() {
  return [
    { item_id: RICE, created_at: '2026-09-04T00:00:00Z', item_data: { name: 'Ponni Rice', price: 60 } },
    { item_id: DAL, created_at: '2026-09-03T00:00:00Z', item_data: { name: 'Toor Dal', price: 140 } },
    { item_id: SALT, created_at: '2026-09-02T00:00:00Z', item_data: { name: 'Salt', price: 20 } },
    /* the connector stamped this one earlier — what a connector shop keeps showing */
    { item_id: OIL, created_at: '2026-09-01T00:00:00Z', item_data: { name: 'Groundnut Oil', price: 210, avail: { qty: 9, source: 'erp', as_of: '2026-10-14T03:00:00.000Z' } } },
  ];
}
function deps() {
  const query = async (sql) => {
    if (/catalogue_visibility/.test(sql)) return { rows: [{ catalogue_visibility: 'public' }] };
    if (/FROM entity_schemas/.test(sql)) return { rows: [{ schema_id: 's1', schema_name: 'Products' }] };
    if (/storefront_access, policy_flags/.test(sql)) return { rows: [{ storefront_access: 'browse', policy_flags: {} }] };
    return { rows: [] };
  };
  const withEntity = async (_e, fn) => fn({ query: async (sql) => {
    if (/FROM stock_balance/.test(sql)) { LEDGER_READS++; return { rows: BALANCES }; }
    if (/FROM catalogue_items/.test(sql)) return { rows: items() };
    return { rows: [] };
  } });
  const catalogueBuild = { resolve: async (key) => ({ title: 'T', collection: 'T', items: [], source_key: key }) };
  return { entity: ENTITY, query, withEntity, catalogueBuild, orderInput, catalogueRead };
}
const bal = (item_id, lot, qty, value) => ({ item_id, lot, expires_at: null, qty, value, avg_cost: qty ? value / qty : 0, last_at: '2026-10-13T10:00:00Z', moves: 2 });
const byId = (v) => Object.fromEntries(v.items.map((r) => [r.item_id, r.item_data]));
const reset = () => { POLICY = {}; LEDGER_TABLE = true; LEDGER_READS = 0;
  BALANCES = [bal(RICE, 'B1', 4, 200), bal(RICE, 'B2', 2.5, 125), bal(DAL, '', -1, -140), bal(OIL, '', 3, 600)]; };

t('⭐⭐ a shop with NO connector shows its OWN ledger figure — rice 4 + 2.5 kg across two batches = 6.5', async () => {
  reset();
  const d = byId(await view.buildPublicView(deps()));
  assert.strictEqual(d[RICE].avail.qty, 6.5);
  assert.strictEqual(d[RICE].avail.source, 'ledger');
  assert.ok(!isNaN(Date.parse(d[RICE].avail.as_of)), 'a quantity is not an answer without a date');
  assert.deepStrictEqual(Object.keys(d[RICE].avail).sort(), ['as_of', 'qty', 'source'], 'ONE shape — the connector\'s');
});

t('…the ledger replaces a stale connector stamp when no connector owns the stock stream (one truth)', async () => {
  reset();
  const d = byId(await view.buildPublicView(deps()));
  assert.deepStrictEqual([d[OIL].avail.qty, d[OIL].avail.source], [3, 'ledger']);
});

t('…never moved → unknown (no figure); sold below zero → unknown, never 0', async () => {
  reset();
  const d = byId(await view.buildPublicView(deps()));
  assert.strictEqual(d[SALT].avail, undefined, 'absent is not zero');
  assert.strictEqual(d[DAL].avail, undefined, 'a negative ledger is a question, not an empty shelf');
});

t('⭐ value and average cost never reach the shopper — only the quantity', async () => {
  reset();
  const v = await view.buildPublicView(deps());
  assert.ok(!/avg_cost|"value"/.test(JSON.stringify(v.items)), JSON.stringify(v.items).slice(0, 300));
});

t('⭐⭐ a connector OWNS the stock stream (stream_owner.stock) → its stamped figure stands, the ledger is not used', async () => {
  reset(); POLICY = { stream_owner: { stock: 'tally' } };
  const d = byId(await view.buildPublicView(deps()));
  assert.deepStrictEqual([d[OIL].avail.qty, d[OIL].avail.source], [9, 'erp']);
  assert.strictEqual(d[RICE].avail, undefined, 'the ledger figure must not be mixed into a connector shop');
});

t('the ledger not migrated on this server (b214) → no figure, and the shop still opens', async () => {
  reset(); LEDGER_TABLE = false;
  const v = await view.buildPublicView(deps());
  assert.strictEqual(v.available, true);
  assert.strictEqual(byId(v)[RICE].avail, undefined);
  assert.strictEqual(LEDGER_READS, 0);
});

t('qty_zero_hides acts on the SAME number the shopper sees — a ledger zero hides when the owner opted in', async () => {
  reset(); POLICY = { qty_zero_hides: 'on' }; BALANCES = [bal(RICE, '', 0, 0)];
  const v = await view.buildPublicView(deps());
  assert.ok(!v.items.some((r) => r.item_id === RICE), 'rice should be hidden');
  assert.strictEqual(v.qty_zero_hidden, 1);
});

t('ONE reader: stock-store.onHand sums batches the same way for the counter (GET /api/till/stock) and the shop', async () => {
  reset();
  const by = await require('../lib/stock-store').onHand('e1', deps().withEntity, {});
  assert.deepStrictEqual(by[RICE], { qty: 6.5, value: 325 });
});

(async () => {
  for (const [name, fn] of CASES) {
    try { await fn(); console.log('\x1b[32mok\x1b[0m  ' + name); pass++; }
    catch (e) { console.log('\x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
