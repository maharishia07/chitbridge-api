#!/usr/bin/env node
/**
 * offers-engine-cat-proofs.test.cjs — the offer engine's four silent-wrong-answer fixes, proved (CAT-248, CAT-252, CAT-253, CAT-330; 2026-11-15).
 * @type regression
 * OWNS      the proof that an unreadable validity date refuses the offer in words (never fails open); that a bundle_price offer sets its set
 *           from the lines that count (an opted-out line is no member); that one product on two lines counts its quantity together for a
 *           tier price; and that tier_price whose tiers are not a list (a string, null, a number) is skipped with a word, never a thrown error.
 * CALLED BY scripts/guards.cjs · CI. Pure: lib/offers-engine.js (vendored from chitbridge-engines offers), no database, no network. Every figure is worked by hand.
 * FLOW      evaluate({lines, offers, ctx}) → { total, adjustments[], skipped[{why}] }
 * CARD      07-offers-pricing-and-combos/functions/offers-engine-public-service
 *   node tests/offers-engine-cat-proofs.test.cjs
 */
'use strict';
const assert = require('node:assert');
const eng = require('../lib/offers-engine').CBOffers;
let pass = 0, fail = 0;
function it(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const L = (key, unitPrice, qty, extra) => Object.assign({ key, item_id: key, sku: 'S-' + key, categories: [], excluded: [], qty, unitPrice }, extra || {});
const ev = (lines, offers, ctx) => eng.evaluate({ lines, offers, ctx: Object.assign({ now: new Date('2026-11-15T10:00:00Z'), currency: 'AUD', money }, ctx || {}) });
const why = (res) => (res.skipped[0] || {}).why || '';

console.log('\n== offers engine · CAT-248 unreadable date, CAT-252 bundle set, CAT-253 pooled qty, CAT-330 tiers not a list ==\n');

const pct = { id: 'w', label: 'Window', kind: 'percent_off', percent: 10, scope: 'line' };
it('CAT-248: an unreadable valid_to skips the offer in words (total stays 100, never a quiet 90)', () => {
  const r = ev([L('a', 100, 1)], [Object.assign({ valid_to: 'next friday' }, pct)]);
  assert.strictEqual(r.total, 100);
  assert.match(why(r), /cannot be read/);
});
it('CAT-248: an impossible day (2026-02-31) in valid_from is unreadable too, not "started"', () => {
  const r = ev([L('a', 100, 1)], [Object.assign({ valid_from: '2026-02-31' }, pct)]);
  assert.strictEqual(r.total, 100);
  assert.match(why(r), /cannot be read/);
});
it('CAT-248: a real window around today still applies (10% off 100 = 90)', () => {
  assert.strictEqual(ev([L('a', 100, 1)], [Object.assign({ valid_from: '2026-11-01', valid_to: '2026-11-30' }, pct)]).total, 90);
});

const bundle = { id: 'bd', label: 'Combo', kind: 'bundle_price', bundle_items: ['x', 'y'], bundle_price: 150 };
it('CAT-252: x 100 + y 100 as a 150 bundle takes 50 off (total 150)', () => {
  assert.strictEqual(ev([L('x', 100, 1), L('y', 100, 1)], [bundle]).total, 150);
});
it('CAT-252: a line opted out of the bundle is no member: with x opted out the set is not complete, total stays 200', () => {
  assert.strictEqual(ev([L('x', 100, 1, { excluded: ['bd'] }), L('y', 100, 1)], [bundle]).total, 200);
});

const tier = { id: 't', label: 'Bulk', kind: 'tier_price', tiers: [{ qty: 10, price: 8 }] };
it('CAT-253: 6 + 4 of ONE product on two lines reach the 10-break: 10 x 8 = 80, not 100', () => {
  assert.strictEqual(ev([L('p', 10, 6, { key: 'l1', item_id: 'p' }), L('p', 10, 4, { key: 'l2', item_id: 'p' })], [tier]).total, 80);
});
it('CAT-253: 6 of A + 4 of B (different products) do not pool: total 100', () => {
  assert.strictEqual(ev([L('a', 10, 6), L('b', 10, 4)], [tier]).total, 100);
});

for (const junk of ['z', null, 7, {}, []]) {
  it('CAT-330: tier_price with tiers = ' + JSON.stringify(junk) + ' does not throw; it is skipped with a word, total unchanged', () => {
    const r = ev([L('a', 10, 5)], [{ id: 'j', label: 'Junk', kind: 'tier_price', tiers: junk }]);
    assert.strictEqual(r.total, 50);
    assert.match(why(r), /tiers is not a list/);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
