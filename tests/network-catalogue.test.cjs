/**
 * network-catalogue.test.cjs — A BRAND PUBLISHES PRODUCT CHANGES; A STORE'S OWN PRICE IS ONLY SUGGESTED TO (2026-09-17).
 *
 * Athi: *"suggest only, build publish changes as you recommended."* What must hold, without a database:
 *   the diff finds what changed (price, MRP, name, picture, category …), what is new, and what the brand no longer has;
 *   a store that FOLLOWS is priced at the brand's current suggestion when the catalogue is read; a store's own price is not;
 *   a renamed product keeps the store's price; a store's save keeps following only while it saves the brand's price.
 *
 * Run: node tests/network-catalogue.test.cjs   · no DB (the one query is stubbed), no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');

/* ⚠️ stub the read BEFORE catalogue-build takes its own reference to it */
const db = require(path.join(API, 'db'));
let SOURCE_ROW = null;
db.query = async () => ({ rows: SOURCE_ROW ? [SOURCE_ROW] : [] });
const build = require(path.join(API, 'lib', 'catalogue-build.js'));
const ncat = require(path.join(API, 'lib', 'network-catalogue.js'));

let pass = 0, fail = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);

const OLD = [
  { name: 'Apex 500W', sku: 'PR-APEX-500', mrp: 4035, price: null, category: 'Mixer grinders', unit: 'piece', image: 'a.png' },
  { name: 'Gas Hob', sku: 'PR-GTM02', mrp: 6860, price: null, category: 'Gas stoves', unit: 'piece' },
  { name: 'Old kettle', sku: 'PR-K1', mrp: 1000, price: null, category: 'Kitchen', unit: 'piece' },
];
const prod = (id, d) => ({ item_id: id, item_data: d });
const PRODUCTS = [
  prod('p1', { name: 'Apex 500W', code: 'PR-APEX-500', price: { amount: 3899, currency: 'INR' }, mrp: 4035, category: 'Mixer grinders', unit: 'piece', image: 'a.png' }),
  prod('p2', { name: 'Marvel Gas Hob', code: 'PR-GTM02', price: { amount: 6860, currency: 'INR' }, mrp: 6860, categories: ['x'], category_names: ['Gas stoves'], unit: 'piece' }),
  prod('p4', { name: 'New toaster', code: 'PR-T1', price: 2500, mrp: 2500, category: 'Kitchen', unit: 'piece' }),
];

it('⭐⭐ the diff: a new price, a rename kept by its code, a new product offered, a product the brand no longer has', () => {
  const d = ncat.diff(OLD, PRODUCTS, []);
  const apex = d.changes.find((c) => c.name === 'Apex 500W');
  assert.deepStrictEqual(apex.fields, [{ field: 'price', from: 4035, to: 3899 }], 'the suggestion is the price, else the MRP');
  const hob = d.changes.find((c) => c.name === 'Marvel Gas Hob');
  assert.strictEqual(hob.was, 'Gas Hob');
  assert.deepStrictEqual(hob.fields.map((f) => f.field), ['name'], 'the category names form must not read as a change');
  assert.deepStrictEqual(d.candidates.map((x) => x.name), ['New toaster']);
  assert.deepStrictEqual(d.missing, ['Old kettle']);
  assert.strictEqual(d.items.length, 3, 'a product the brand dropped stays offered — nothing is withdrawn silently');
  assert.deepStrictEqual(d.items.find((x) => x.name === 'Marvel Gas Hob').formerly, ['Gas Hob']);
});

it('⭐ a product is shared for the first time only when the brand ticks it', () => {
  const d = ncat.diff(OLD, PRODUCTS, ['p4']);
  assert.ok(d.items.some((x) => x.name === 'New toaster'));
  assert.ok(d.changes.some((c) => c.kind === 'added' && c.name === 'New toaster'));
  assert.deepStrictEqual(d.candidates, []);
});

it('⭐⭐ withdraw: the product leaves what the stores sell from, and is said as a change — the others are untouched', () => {
  const d = ncat.diff(OLD, PRODUCTS, [], ['old kettle', 'Apex 500W']);
  assert.deepStrictEqual(d.items.map((x) => x.name), ['Marvel Gas Hob']);
  assert.deepStrictEqual(d.changes.filter((c) => c.kind === 'withdrawn').map((c) => c.name), ['Apex 500W', 'Old kettle']);
  assert.deepStrictEqual(d.missing, [], 'a withdrawn product was also reported as missing');
  assert.deepStrictEqual(d.published, OLD.map((x) => x.name), 'the screen needs what the stores have NOW to offer the withdraw');
});

it('⭐ a withdrawn product can be shared again — it is a brand product not in the published copy', () => {
  const after = ncat.diff(OLD, PRODUCTS, [], ['Apex 500W']).items;
  const d = ncat.diff(after, PRODUCTS, ['p1'], []);
  assert.ok(d.items.some((x) => x.name === 'Apex 500W'), 'sharing a withdrawn product again did not bring it back');
});

it('⭐⭐ withdraw from SOME stores: only members, only published products, only real changes', () => {
  const ch = ncat.storeChanges(
    { 'Apex 500W': ['s1', 's2', 'stranger'], 'No such': ['s1'] },
    { 'Gas Hob': ['s1', 's3'] },
    ['s1', 's2', 's3'], ['Apex 500W', 'Gas Hob'], { 'Apex 500W': ['s2'], 'Gas Hob': ['s3'] });
  assert.deepStrictEqual(ch, [
    { kind: 'withdrawn_at', name: 'Apex 500W', stores: ['s1'], fields: [] },
    { kind: 'restored_at', name: 'Gas Hob', stores: ['s3'], fields: [] },
  ]);
  assert.deepStrictEqual(ncat.withdrawnAfter({ 'Apex 500W': ['s2'], 'Gas Hob': ['s3'] }, ch), { 'Apex 500W': ['s2', 's1'] });
});

it('⚠️⚠️ the brand\'s mark survives the store\'s own save — even though the store never sees the product', () => {
  const existing = { 'Apex 500W': { price: 3799, brand_withdrawn: true }, 'Gas Hob': { price: 6860 } };
  const saved = ncat.keepFollow({ 'Gas Hob': { price: 6900, brand_withdrawn: true } }, existing, []);
  assert.deepStrictEqual(saved['Apex 500W'], { price: 3799, brand_withdrawn: true }, 'a store save dropped the withdrawal');
  assert.ok(!('brand_withdrawn' in saved['Gas Hob']), 'a store marked its own product as withdrawn by the brand');
});

it('⭐⭐ reading the catalogue at a store the brand withdrew a product from: it is simply not there', async () => {
  SOURCE_ROW = { source_key: 'k@v1', title: 'Prestige', items: OLD.slice(0, 2), owner_entity_id: null, pending: null };
  const r = await build.resolve('k@v1', { 'Apex 500W': { price: 3799, brand_withdrawn: true }, 'Gas Hob': { price: 6860 } });
  assert.deepStrictEqual(r.items.map((x) => x.name), ['Gas Hob']);
});

it('⚠️ nothing changed → nothing to publish', () => {
  const same = [prod('p1', { name: 'Apex 500W', code: 'PR-APEX-500', mrp: 4035, category: 'Mixer grinders', unit: 'piece', image: 'a.png' })];
  assert.deepStrictEqual(ncat.diff([OLD[0]], same, []).changes, []);
});

it('⭐⭐⭐ reading the catalogue: a follower gets the brand\'s price, a store\'s own price stays, a rename keeps it', async () => {
  const items = ncat.diff(OLD, PRODUCTS, []).items;
  SOURCE_ROW = { source_key: 'k@v1', title: 'Prestige', items, owner_entity_id: null, pending: null };
  const r = await build.resolve('k@v1', {
    'Apex 500W': { price: { amount: 4035, currency: 'INR' }, unit: 'piece', follow: true },
    'Gas Hob': { price: { amount: 6500, currency: 'INR' }, unit: 'piece' },
    'Old kettle': { price: 999, unit: 'piece', follow: true },
  });
  const by = (n) => r.items.find((x) => x.name === n).commercials;
  assert.deepStrictEqual(by('Apex 500W').price, { amount: 3899, currency: 'INR' }, 'a follower did not move to the brand\'s price');
  assert.deepStrictEqual(by('Marvel Gas Hob').price, { amount: 6500, currency: 'INR' }, 'a renamed product lost the store\'s own price');
  assert.strictEqual(by('Old kettle').price, 1000, 'no price → the MRP is the suggestion');
});

it('⭐⭐ a store\'s save keeps following while it saves the brand\'s price — and stops the moment it types its own', () => {
  const items = [{ name: 'Apex 500W', price: 3899, mrp: 4035 }];
  const existing = { 'Apex 500W': { price: 3899, follow: true } };
  assert.strictEqual(ncat.keepFollow({ 'Apex 500W': { price: 3899 } }, existing, items)['Apex 500W'].follow, true);
  assert.ok(!('follow' in ncat.keepFollow({ 'Apex 500W': { price: 3700 } }, existing, items)['Apex 500W']), 'an own price kept following');
  assert.ok(!('follow' in ncat.keepFollow({ 'Apex 500W': { price: 3899 } }, {}, items)['Apex 500W']), 'a store began following without a publish');
});

(async () => {
  console.log('\nnetwork catalogue · publish changes, suggest prices');
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
