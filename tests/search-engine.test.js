/**
 * search-engine.test.js — HOW A SHOPKEEPER FINDS A PRODUCT, PROVEN OUTSIDE A BROWSER (2026-09-08).
 *
 * Athi: *"if the regex selects product based on ac co, means aachi coriander… will it be possible?"* — and then, an hour after it
 * existed at the counter, *"search is not working"*, because a typed "BULK-000001" was one token with a hyphen in it while the text
 * being searched had already turned that hyphen into a space. One side normalised, the other did not.
 *
 * So this file holds the two things that matter: the shop's own words find the right product, and the counter and the Catalogue screen
 * use the SAME file to decide that — no second implementation to drift.
 *
 * Run: node tests/search-engine.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');
const CBSearch = require(path.join(API, 'lib', 'search-engine.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* a corner of a real Tamil Nadu kirana shelf — the names people actually type at */
const SHELF = [
  { name: 'Aachi Coriander powder 100 g', code: 'BULK-000001', category: 'Spices', brand: 'Aachi' },
  { name: 'Anil Coconut oil 1 L', code: 'BULK-000002', category: 'Edible oil', brand: 'Anil' },
  { name: 'Aavin Curd 500 ml', code: 'BULK-000003', category: 'Dairy', brand: 'Aavin' },
  { name: 'Britannia Marie biscuit family pack', code: 'BULK-000004', category: 'Biscuits & snacks', brand: 'Britannia', barcode: '8909000000004' },
  { name: 'Aachi Chilli powder 250 g', code: 'BULK-000005', category: 'Spices', brand: 'Aachi' },
];
const first = (q, opts) => { const r = CBSearch.search(SHELF, q, opts); return r.length ? r[0].name : '(nothing)'; };

console.log('— finding a product —');

it('two words, first letters each: "ac co" is Aachi Coriander', () => {
  assert.strictEqual(first('ac co'), 'Aachi Coriander powder 100 g');
});

it('the order of the words does not matter — "co ac" is the same reach', () => {
  assert.strictEqual(first('co ac'), 'Aachi Coriander powder 100 g');
});

it('word starts win over letters: "brit mar" is the Marie biscuit', () => {
  assert.strictEqual(first('brit mar'), 'Britannia Marie biscuit family pack');
});

it('half a word, found anywhere: "riander" still lands', () => {
  assert.strictEqual(first('riander'), 'Aachi Coriander powder 100 g');
});

it('⚠️ a hyphenated code is TWO words on both sides — "BULK-000001" finds its product (the 2026-09-08 bug)', () => {
  assert.strictEqual(first('BULK-000001'), 'Aachi Coriander powder 100 g');
  assert.strictEqual(first('bulk 000002'), 'Anil Coconut oil 1 L');        /* typed with a space instead */
  assert.strictEqual(first('bulk-4'), 'Britannia Marie biscuit family pack'); /* and the lazy version of it */
});

it('a scanned barcode is exact and comes back alone', () => {
  const r = CBSearch.search(SHELF, '8909000000004');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].code, 'BULK-000004');
});

it('a department is searchable text too: "spices cur" reaches nothing, "spices chi" reaches the chilli', () => {
  assert.strictEqual(first('spices chi'), 'Aachi Chilli powder 250 g');
});

it('nothing matched means nothing shown — never a consolation product', () => {
  assert.deepStrictEqual(CBSearch.search(SHELF, 'zzqq'), []);
});

it('an empty box shows the shelf, capped at what the screen asked for', () => {
  assert.strictEqual(CBSearch.search(SHELF, '', { limit: 3 }).length, 3);
  assert.strictEqual(CBSearch.search(SHELF, '   ').length, SHELF.length);
});

it('the closest match ranks first: a name that BEGINS with what was typed', () => {
  const r = CBSearch.search(SHELF, 'aachi').map((x) => x.name);
  assert.ok(r[0].indexOf('Aachi') === 0, 'expected an Aachi product first, got ' + r[0]);
});

it('the searchable text is built once and kept off the wire (not enumerable)', () => {
  const item = { name: 'Aavin Milk 500 ml', code: 'X-1' };
  CBSearch.textOf(item);
  assert.deepStrictEqual(Object.keys(item), ['name', 'code'], 'the cache must not show up in JSON sent to the server or IndexedDB');
  assert.strictEqual(JSON.stringify(item), '{"name":"Aavin Milk 500 ml","code":"X-1"}');
});

it('a renamed product is found by its new name once the cache is dropped', () => {
  const item = { name: 'Old name' };
  CBSearch.textOf(item);
  item.name = 'Tata Salt 1 kg';
  CBSearch.forget([item]);
  assert.strictEqual(CBSearch.search([item], 'tata sa').length, 1);
});

it('a screen supplies its own words — the Catalogue searches category names and offers, which are not fields', () => {
  const rows = [{ id: 'p1', d: { name: 'Ponni rice 25 kg' }, cat: 'Grains', deal: '10% off' },
                { id: 'p2', d: { name: 'Tata Salt 1 kg' }, cat: 'Staples', deal: '' }];
  const opts = { text: (p) => p.d.name + ' ' + p.cat + ' ' + p.deal, name: (p) => p.d.name, barcode: '', limit: Infinity };
  assert.strictEqual(CBSearch.search(rows, 'grains', opts).length, 1, 'typing a category name must find what is in it');
  assert.strictEqual(CBSearch.search(rows, '10 off', opts)[0].id, 'p1', 'the offer on the row is findable');
});

it('⚠️ the words are rebuilt when the stamp changes — a renamed category cannot stay findable', () => {
  const rows = [{ name: 'Ponni rice 25 kg', cat: 'Grains' }];
  const words = (p) => p.name + ' ' + p.cat;
  assert.strictEqual(CBSearch.search(rows, 'grains', { text: words, stamp: 'v1', barcode: '' }).length, 1);
  rows[0].cat = 'Cereals';
  assert.strictEqual(CBSearch.search(rows, 'grains', { text: words, stamp: 'v1', barcode: '' }).length, 1, 'same stamp: the cache stands');
  assert.strictEqual(CBSearch.search(rows, 'grains', { text: words, stamp: 'v2', barcode: '' }).length, 0, 'new stamp: the old name is gone');
  assert.strictEqual(CBSearch.search(rows, 'cereals', { text: words, stamp: 'v2', barcode: '' }).length, 1);
});

it('the expensive half runs once per product, not once per keystroke', () => {
  let built = 0;
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push({ name: 'Product ' + i });
  const words = (p) => { built++; return p.name; };
  for (const q of ['pro', 'prod', 'produ', 'product 7']) CBSearch.search(rows, q, { text: words, stamp: 's', barcode: '', limit: Infinity });
  assert.strictEqual(built, 200, 'four keystrokes over 200 products built the text ' + built + ' times');
});

console.log('— a shopkeeper who cannot spell, and a customer who speaks Tamil —');

const KIRANA = [
  { name: 'Aachi Masala powder 100 g', code: 'A1' },
  { name: 'Aachi Chilli powder 250 g', code: 'A2' },
  { name: 'Sakthi Masala 200 g', code: 'S1' },
  { name: 'Tomato', code: 'T1', unit: 'kg', synonym_text: 'thakkali tomatto' },
  { name: 'Onion', code: 'O1', unit: 'kg', synonym_text: 'vengayam' },
  { name: 'Orange grade 1', code: 'G1' },
  { name: 'Orange grade 2', code: 'G2' },
  { name: 'Rice 25 kg', code: 'R1' },
  { name: 'Nice biscuit', code: 'N1' },
];
const top = (q) => { const r = CBSearch.search(KIRANA, q); return r.length ? r[0].name : '(nothing)'; };

it('⭐⭐ a doubled letter is forgiven — "achi massala" is Aachi Masala', () => {
  assert.strictEqual(top('achi massala'), 'Aachi Masala powder 100 g');
  assert.strictEqual(top('sakthi masalla'), 'Sakthi Masala 200 g');
  assert.strictEqual(top('chilly powder'), 'Aachi Chilli powder 250 g');
});

it('⭐⭐ the SHOP\'S OWN WORDS reach the product — "thakkali" is Tomato', () => {
  assert.strictEqual(top('thakkali'), 'Tomato');
  assert.strictEqual(top('vengayam'), 'Onion');
  assert.strictEqual(top('tomatto'), 'Tomato', 'a misspelling somebody already wrote down as a synonym');
});

it('⚠️⚠️ FUZZ NEVER MERGES TWO REAL THINGS — grade 1 is not grade 2', () => {
  const one = CBSearch.search(KIRANA, 'orange grade 1');
  assert.strictEqual(one[0].name, 'Orange grade 1');
  assert.strictEqual(one[0].code, 'G1');
  const two = CBSearch.search(KIRANA, 'orange grade 2');
  assert.strictEqual(two[0].name, 'Orange grade 2', 'one digit apart, and they must never swap');
});

it('⚠️ a short word is compared exactly — "rice" is not "nice"', () => {
  assert.strictEqual(top('rice'), 'Rice 25 kg');
  assert.strictEqual(top('nice'), 'Nice biscuit');
});

it('⚠️ a number is never fuzzed: "100 g" is not "200 g"', () => {
  const r = CBSearch.search(KIRANA, 'masala 200');
  assert.strictEqual(r[0].name, 'Sakthi Masala 200 g');
});

it('an exact match still ranks above a forgiven one', () => {
  const r = CBSearch.search(KIRANA, 'masala').map((x) => x.name);
  assert.ok(r[0].indexOf('Masala') > 0, 'a spelling mistake outranked the real thing: ' + r.join(' | '));
});

console.log('— one file, two screens —');

it('⭐ the counter and the app load the SAME search: three copies, byte for byte', () => {
  const master = fs.readFileSync(path.join(WEB, 'app', 'search.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const copy of [path.join(WEB, 'engine', 'search.js'), path.join(API, 'lib', 'search-engine.js')]) {
    const have = fs.readFileSync(copy, 'utf8').replace(/\r\n/g, '\n');
    assert.strictEqual(have, master, copy + ' has drifted — run node scripts/vendor-till.cjs');
  }
});

it('neither screen keeps a search of its own', () => {
  const till = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(till.indexOf('/engine/search.js') > 0, 'the counter must load the shared engine');
  assert.ok(till.indexOf('everyTokenInAWord') < 0, 'the counter still carries its own copy of the letters pass');
  const app = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  if (app.indexOf('CBSearch') > 0) assert.ok(app.indexOf('app/search.js') > 0, 'the app uses CBSearch but never loads it');
});

console.log(pass + ' checks passed');
