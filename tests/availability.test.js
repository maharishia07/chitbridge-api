'use strict';
/**
 * availability.test.js — a quantity is not an answer without a date.
 *
 * The ★★ tests are the two that decide whether this is trustworthy: an ABSENT figure must never become zero, and a
 * stale figure must never sort ahead of a fresh one. Both are the kind of thing that looks harmless in a diff and
 * makes a network promise stock it does not have.
 */
const assert = require('assert');
const A = require('../lib/availability');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};
const NOW = '2026-08-08T12:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60000).toISOString();

console.log('\navailability · stamping a number');

t('a quantity is stored with its source and its date', () => {
  const s = A.stamp({ qty: '6', source: 'ERP' }, NOW);
  assert.deepStrictEqual(s, { qty: 6, source: 'erp', as_of: NOW });
});

t('★ an unlabelled source becomes "unknown", not a guess', () => {
  assert.strictEqual(A.stamp({ qty: 1, source: 'sap' }, NOW).source, 'unknown');
  assert.strictEqual(A.stamp({ qty: 1 }, NOW).source, 'unknown');
});

t('★★ a negative quantity is REFUSED, not clamped to zero', () => {
  // Clamping would turn a broken connector into an out-of-stock store, and the network would route around a shelf
  // that is actually full.
  assert.strictEqual(A.stamp({ qty: -4, source: 'erp' }, NOW), null);
});

t('nothing said → nothing stored', () => {
  assert.strictEqual(A.stamp({}, NOW), null);
  assert.strictEqual(A.stamp({ qty: '' }, NOW), null);
  assert.strictEqual(A.stamp(null, NOW), null);
});

t('★ zero IS a real answer and is kept', () => {
  // "I looked, there are none" is useful. It is unknown that must not be confused with it.
  assert.deepStrictEqual(A.stamp({ qty: 0, source: 'iot' }, NOW), { qty: 0, source: 'iot', as_of: NOW });
});

t('a nightly file carries LAST NIGHT, not now', () => {
  const s = A.stamp({ qty: 2, source: 'erp', as_of: ago(660) }, NOW);
  assert.strictEqual(s.as_of, ago(660), 'as_of is when the number was true, not when it was written');
});

console.log('\navailability · how old is it');

t('the buckets a screen can act on', () => {
  assert.strictEqual(A.freshness(ago(2), NOW).bucket, 'live');
  assert.strictEqual(A.freshness(ago(600), NOW).bucket, 'today');
  assert.strictEqual(A.freshness(ago(60 * 24 * 3), NOW).bucket, 'week');
  assert.strictEqual(A.freshness(ago(60 * 24 * 40), NOW).bucket, 'old');
});

t('★ stale is the one boolean a screen needs', () => {
  assert.strictEqual(A.freshness(ago(5), NOW).stale, false);
  assert.strictEqual(A.freshness(ago(60 * 30), NOW).stale, true);
});

t('★ no date is "unknown", never "old"', () => {
  // "We do not know when" is not the same as "we know it is old", and only one of them can be fixed by asking.
  const f = A.freshness(null, NOW);
  assert.strictEqual(f.bucket, 'unknown');
  assert.strictEqual(f.label, 'no date');
  assert.strictEqual(f.stale, true, 'but it is still not to be trusted');
});

console.log('\navailability · distance');

t('Coimbatore → Erode is about 90 km', () => {
  const d = A.distanceKm({ lat: 11.0168, lng: 76.9558 }, { lat: 11.3410, lng: 77.7172 });
  assert.ok(d > 80 && d < 100, 'got ' + d);
});

t('a store with no coordinates has no distance — not zero', () => {
  assert.strictEqual(A.distanceKm({ lat: 11, lng: 76 }, { lat: null, lng: null }), null);
});

console.log('\navailability · the answer');

const HERE = { lat: 11.0168, lng: 76.9558 };
const ROWS = () => [
  { store: 'Chicago', qty: 18, source: 'erp', as_of: ago(60 * 24 * 200), lat: 41.87, lng: -87.62 },  // lots, ancient
  { store: 'Dubai',   qty: 2,  source: 'erp', as_of: ago(660),  lat: 25.20, lng: 55.27 },
  { store: 'Erode',   qty: 6,  source: 'erp', as_of: ago(4),    lat: 11.34, lng: 77.72 },
  { store: 'Suzhou',  qty: 0,  source: 'iot', as_of: ago(1),    lat: 31.30, lng: 120.58 },
  { store: 'Quiet',   qty: null, source: 'unknown', as_of: null, lat: 12.97, lng: 77.59 },
];

t('★★ FRESH beats stale, whatever the quantity', () => {
  // Chicago has 18 and Erode has 6 — but Chicago's number is 200 days old. A confident wrong number is the thing
  // this whole module exists to stop being acted on.
  const a = A.answer(ROWS(), { from: HERE, now: NOW });
  assert.strictEqual(a.rows[0].store, 'Erode');
  assert.strictEqual(a.rows[1].store, 'Dubai', 'fresh-ish and in stock, before the ancient 18');
  assert.strictEqual(a.rows[2].store, 'Chicago');
});

t('★★ a store that has never reported stays UNKNOWN — it is not zero', () => {
  const a = A.answer(ROWS(), { from: HERE, now: NOW });
  const quiet = a.rows.filter((r) => r.store === 'Quiet')[0];
  assert.strictEqual(quiet.known, false);
  assert.strictEqual(quiet.qty, null, 'never coerced to 0');
  assert.strictEqual(a.stores_unknown, 1);
});

t('★ zero-stock sorts with the have-nots, and is still shown', () => {
  const a = A.answer(ROWS(), { from: HERE, now: NOW });
  const names = a.rows.map((r) => r.store);
  assert.ok(names.indexOf('Suzhou') > names.indexOf('Chicago'), 'a real zero ranks below anything in stock');
  assert.strictEqual(a.rows.length, 5, 'nothing is dropped — a person needs to see who was asked');
});

t('★★ the summary refuses to round the unknowns away', () => {
  const a = A.answer(ROWS(), { from: HERE, now: NOW });
  assert.strictEqual(a.total, 26);
  assert.strictEqual(a.stores_with_stock, 3);
  assert.ok(/has not reported/.test(a.summary), a.summary);
});

t('nobody has anything, and it says which kind of nothing', () => {
  assert.ok(/Nobody has reported/.test(A.answer([{ store: 'A', qty: null }], {}).summary));
  assert.ok(/None in the network/.test(A.answer([{ store: 'A', qty: 0, as_of: NOW }], { now: NOW }).summary));
});

t('distance is computed, and a store without coordinates still appears', () => {
  const a = A.answer([{ store: 'X', qty: 1, as_of: NOW, lat: 11.34, lng: 77.72 },
                      { store: 'Y', qty: 1, as_of: NOW }], { from: HERE, now: NOW });
  assert.ok(a.rows[0].km > 80);
  assert.strictEqual(a.rows[1].km, null, 'unlocated, not excluded');
});

t('TIER A · zero dependencies', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/availability'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(/g)], []);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
