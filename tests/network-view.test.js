'use strict';
/**
 * network-view.test.js — one shopfront over many departments.
 *
 * The load-bearing tests: a private department is simply absent, categories are never invented, and a search never
 * leaves a heading with nothing under it.
 */
const assert = require('assert');
const N = require('../lib/network-view');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const dept = (name, bridge, ccy, items) => ({
  entity: { bridge_id: bridge, display_name: name },
  view: { available: true, shop: { bridge_id: bridge, display_name: name, currency_code: ccy, order_method: 'cart' },
    lines: items.map((i, n) => ({ item_id: bridge + '-' + n, origin: 'own', fields: i })) },
});

const STORE = [
  dept('Clothing', 'CBCLO', 'INR', [
    { name: 'Cotton Shirt', category: 'Shirts', unit: 'each', price: { amount: 899, currency: 'INR' }, size: 'M', product: 'cotton-shirt' },
    { name: 'Cotton Shirt', category: 'Shirts', unit: 'each', price: { amount: 899, currency: 'INR' }, size: 'L', product: 'cotton-shirt' },
    { name: 'Linen Trouser', category: 'Trousers', unit: 'each', price: { amount: 1450, currency: 'INR' } },
    { name: 'Odd Sock', unit: 'pair', price: { amount: 99, currency: 'INR' } },     // no category declared
  ]),
  dept('Pharmacy', 'CBPHA', 'INR', [
    { name: 'Paracetamol 500', category: 'Analgesics', unit: 'strip', price: { amount: 32, currency: 'INR' } },
  ]),
  { entity: { bridge_id: 'CBWAR', display_name: 'Warehouse' }, view: { available: false, reason: 'private' } },
];

console.log('\nnetwork-view · one shopfront');

t('★ every PUBLIC department appears, with its own products', () => {
  const s = N.assemble({ network: { bridge_id: 'CBNET', name: 'DeptStore' }, departments: STORE });
  assert.deepStrictEqual(s.departments.map((d) => d.name), ['Clothing', 'Pharmacy']);
  assert.strictEqual(s.count, 5);
});
t('★★ a PRIVATE department is simply ABSENT — not listed as hidden', () => {
  // Listing it as "hidden" would tell a shopper the warehouse exists, which is the existence oracle again.
  const s = N.assemble({ departments: STORE });
  assert.ok(!s.departments.some((d) => d.name === 'Warehouse'));
  assert.strictEqual(JSON.stringify(s).indexOf('Warehouse'), -1, 'the name must not appear anywhere in the payload');
});
t('a department keeps its OWN currency and order mode', () => {
  const s = N.assemble({ departments: STORE });
  assert.strictEqual(s.departments[0].currency_code, 'INR');
  assert.strictEqual(s.departments[0].order_method, 'cart');
});

console.log('\nnetwork-view · classification');

t('★ items group by the category the merchant declared', () => {
  const s = N.assemble({ departments: STORE });
  const clo = s.departments[0];
  assert.deepStrictEqual(clo.categories.map((c) => c.name), ['Shirts', 'Trousers', 'Everything else']);
});
t('★ an undeclared category is NOT invented — it falls to "Everything else"', () => {
  // A catalogue that guesses categories is worse than one with none: a shopper cannot tell a classification from a
  // guess, and will trust both equally.
  const s = N.assemble({ departments: STORE });
  const other = s.departments[0].categories.find((c) => c.name === 'Everything else');
  assert.strictEqual(other.count, 1);
  assert.strictEqual(other.items[0].name, 'Odd Sock');
});
t('the catch-all sorts LAST, whatever order it arrived in', () => {
  const s = N.assemble({ departments: [dept('X', 'CBX', 'INR', [
    { name: 'no cat' }, { name: 'has cat', category: 'Aisle 1' }]) ] });
  assert.deepStrictEqual(s.departments[0].categories.map((c) => c.name), ['Aisle 1', 'Everything else']);
});
t('a variant line keeps its size AND its product, so the page can group them', () => {
  const s = N.assemble({ departments: STORE });
  const shirts = s.departments[0].categories[0].items;
  assert.deepStrictEqual(shirts.map((i) => i.variant), ['M', 'L']);
  assert.strictEqual(shirts[0].product, 'cotton-shirt');
});
t('the network-wide category list is the union, deduped', () => {
  const s = N.assemble({ departments: STORE });
  assert.deepStrictEqual(s.categories, ['Shirts', 'Trousers', 'Everything else', 'Analgesics']);
});
t('currencies are reported, never merged', () => {
  const mixed = [dept('A', 'CBA', 'INR', [{ name: 'x' }]), dept('B', 'CBB', 'AED', [{ name: 'y' }])];
  const s = N.assemble({ departments: mixed });
  assert.deepStrictEqual(s.currencies, ['INR', 'AED'], 'two currencies is a fact to show, not a sum to compute');
});

console.log('\nnetwork-view · search');

t('★ search finds a product across departments', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'para');
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.departments[0].name, 'Pharmacy');
});
t('★ a search never leaves a heading with nothing under it', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'trouser');
  assert.strictEqual(s.departments.length, 1);
  assert.deepStrictEqual(s.departments[0].categories.map((c) => c.name), ['Trousers']);
});
t('searching a DEPARTMENT name returns all of it', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'clothing');
  assert.strictEqual(s.departments.length, 1);
  assert.strictEqual(s.count, 4);
});
t('searching a CATEGORY name returns that category', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'shirts');
  assert.strictEqual(s.count, 2);
});
t('an empty query changes nothing', () => {
  const full = N.assemble({ departments: STORE });
  assert.strictEqual(N.search(full, '').count, full.count);
});
t('a search that matches nothing returns an empty shopfront, not everything', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'zzzz');
  assert.strictEqual(s.count, 0);
  assert.deepStrictEqual(s.departments, []);
});
t('⚠ a private department cannot be reached by searching for it', () => {
  const s = N.search(N.assemble({ departments: STORE }), 'warehouse');
  assert.strictEqual(s.count, 0);
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/network-view'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
