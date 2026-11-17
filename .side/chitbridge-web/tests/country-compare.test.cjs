/**
 * tests/country-compare.test.cjs - CTRY-49: a Country Lab row is compared PART BY PART, never as one lump.
 * Facts are the lab's own shape (factsOf); here they are tiny stand-ins, because the module holds no country fact. Run: node tests/country-compare.test.cjs
 */
'use strict';
const assert = require('assert');
const C = require('../public/app/country-compare.js');
const x = { money: (m, c) => c + ' ' + m / 100, symbol: (c) => ({ INR: '₹', AUD: 'A$', USD: '$', CAD: '$' }[c] || c), month: (m) => ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July'][Number(m)] };
const cur = (code, decimals, round) => ({ currency: { code, decimals, round: round || null, lineRound: null } });

// the example Athi gave: INR vs AUD, same 2 decimals
let v = C.line('currency', cur('INR', 2), cur('AUD', 2), x);
assert.strictEqual(v.text, 'Changes: ₹ → A$ · same rule: 2 decimals');
assert.strictEqual(v.same, false);

// the code alone no longer decides: same money and rule is Same
v = C.line('currency', cur('INR', 2), cur('INR', 2), x);
assert.deepStrictEqual([v.same, v.text], [true, 'Same']);

// a changed rule part is named with both values
v = C.line('currency', cur('INR', 2), cur('JPY', 0), x);
assert.strictEqual(v.text, 'Changes: ₹ → JPY · 2 decimals → 0 decimals');

// two currencies that print the same symbol are told apart by code
v = C.line('currency', cur('USD', 2), cur('CAD', 2), x);
assert.strictEqual(v.text, 'Changes: USD → CAD · same rule: 2 decimals');

// a silent part on both sides is not listed; silent on one side reads "none"
v = C.line('currency', cur('INR', 2, 0.05), cur('AUD', 2), x);
assert.strictEqual(v.text, 'Changes: ₹ → A$ · bill rounds to: 0.05 → none · same rule: 2 decimals');
// the currency's own smallest unit is its decimals, not a second rule
v = C.line('currency', cur('INR', 2, 0.01), cur('AUD', 2), x);
assert.strictEqual(v.text, 'Changes: ₹ → A$ · same rule: 2 decimals');

// financial year: month changes, the way it is written is the same
const fy = (m, label) => ({ fy: { startMonth: m, label } });
v = C.line('fy', fy(4, 'split'), fy(7, 'split'), x);
assert.strictEqual(v.text, 'Changes: April → July · same rule: written as two years (2026-27)');

// ledgers: counted by what moved
const led = (o) => ({ ledgers: o });
v = C.line('ledgers', led({ cash: { code: '1', name: 'Cash' } }), led({ cash: { code: '1', name: 'Cash' } }), x);
assert.strictEqual(v.same, true);
v = C.line('ledgers', led({ cash: { code: '1', name: 'Cash' } }), led({ cash: { code: '1', name: 'Cash in hand' }, gst: { code: '2', name: 'GST' } }), x);
assert.strictEqual(v.text, 'Changes: 1 ledger → 2 ledgers · 1 added · 1 renamed');

// the line stays short: more than three changes end in "and N more"
const many = (n) => ({ kept: { list: ['a', 'b', 'c', 'd', 'e'].map((k) => ({ kind: k, n, unit: 'years' })) } });
v = C.line('kept', many(8), many(6), x);
assert.ok(/and 3 more changes$/.test(v.text), v.text);
assert.strictEqual(v.changed.length, 5);   // the popup still lists every part

// an unknown row is Same (nothing to compare), never a throw
assert.strictEqual(C.line('nope', {}, {}, x).same, true);
console.log('country-compare.test: ok');
