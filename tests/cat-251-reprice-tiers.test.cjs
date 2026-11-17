'use strict';
/**
 * tests/cat-251-reprice-tiers.test.cjs — MONEY WAVE 1 · M5 (CAT-251): REPRICE FROM THE CATALOGUE HONOURS THE PRICING STRUCTURE.
 * lib/reprice.js read the shelf (list) price; invoice/build reads the product's structure at the quantity (services.priceLine). Now reprice asks the same reader.
 * Hand expectations (INR; Rice list 100.00 per kg, tiered: from 10 kg each 80.00 — api tier shape { qty, price }; below the first break the list price applies):
 *   line 20 kg -> will_price to 80.00 (main says 100.00) · line 5 kg -> 100.00 (below the first break) · line 20 kg already at 80.00 -> unchanged
 *   apply writes 80.00 x 20 = 1,600.00 for the 20 kg line, as an amendment carrying the price 80, currency INR
 *   a tiered product with no list price and a line below the first break has no price: needs_price with the engine's why (never 0)
 * No DB: the catalogue loader, the matcher and the amendment writer are stood in; the pricing reader is the real one. Run: node --test tests/cat-251-reprice-tiers.test.cjs
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require.cache[require.resolve(path.join(__dirname, '..', 'db'))] = { exports: { query: async () => ({ rows: [] }), withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }) } };
const stub = (file, exports) => (require.cache[require.resolve(path.join(__dirname, '..', 'lib', file))] = { id: file, filename: file, loaded: true, exports });

const RICE = { name: 'Rice', price: { amount: 100, currency: 'INR' }, pricing_kind: 'tiered', pricing_tiers: [{ qty: 10, price: 80 }] };
const NEG = { name: 'Jeera', price: { amount: -5, currency: 'INR' }, pricing_kind: 'tiered', pricing_tiers: [{ qty: 10, price: 80 }] };
const NO_LIST = { name: 'Dal', pricing_kind: 'tiered', pricing_tiers: [{ qty: 10, price: 80 }] };
let ROWS = [];
const WRITTEN = [];
stub('itemmatch', {
  loadCatalogue: async () => ({ items: [RICE, NO_LIST, NEG] }),
  match: (phrase) => ({ item: /dal/i.test(phrase) ? NO_LIST : /jeera/i.test(phrase) ? NEG : RICE })
});
stub('amend', {
  readLines: async () => ROWS,
  record: async (_e, _c, edits) => (WRITTEN.push(...edits), { amendments: edits })
});
const reprice = require('../lib/reprice');
const line = (id, particulars, quantity, price) => ({ line_id: id, particulars, quantity, unit: 'kg', price });

test('20 kg is priced at the tier, 80.00 (not the list 100.00); 5 kg stays at the list; 20 kg at 80.00 is unchanged', async () => {
  ROWS = [line('a', 'Rice', 20, null), line('b', 'Rice', 5, null), line('c', 'Rice', 20, 80)];
  const plan = await reprice.plan('E1', 'C1', {});
  const to = Object.fromEntries(plan.will_price.map((item) => [item.line_id, item.to]));
  assert.deepEqual(to, { a: 80, b: 100 });
  assert.equal(plan.will_price.find((item) => item.line_id === 'a').currency, 'INR');
  assert.equal(plan.will_price.find((item) => item.line_id === 'a').structure, 'tiered');
  assert.deepEqual(plan.unchanged.map((item) => item.line_id), ['c']);
});
test('apply writes 80.00 x 20 kg = 1,600.00 as an amendment', async () => {
  ROWS = [line('a', 'Rice', 20, null)];
  WRITTEN.length = 0;
  const out = await reprice.apply('E1', 'C1', {}, { by: 'tester' });
  assert.equal(out.applied, 1);
  const edit = WRITTEN[0].line;
  assert.equal(edit.price, 80);
  assert.equal(edit.price * edit.quantity, 1600);
});
test('a tiered product with no list price, below the first break, is needs_price with the engine\'s words, never 0', async () => {
  ROWS = [line('d', 'Dal', 5, null)];
  const plan = await reprice.plan('E1', 'C1', {});
  assert.equal(plan.will_price.length, 0);
  assert.equal(plan.needs_price.length, 1);
  assert.ok(plan.needs_price[0].reason && plan.needs_price[0].reason.length > 0);
});
test('CAT-251 + CAT-324 together: a stored negative list price is no price below the first break, the tier still prices above it (Jeera list -5.00, from 10 kg 80.00)', async () => {
  ROWS = [line('e', 'Jeera', 20, null), line('f', 'Jeera', 5, null)];
  const plan = await reprice.plan('E1', 'C1', {});
  assert.deepEqual(plan.will_price.map((item) => [item.line_id, item.to]), [['e', 80]]); // 20 kg: the 80.00 tier, never the -5.00 list
  assert.deepEqual(plan.needs_price.map((item) => item.line_id), ['f']); // 5 kg: only the negative list applies, so no price (never -5, never 0)
});
