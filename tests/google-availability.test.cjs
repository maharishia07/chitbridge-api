'use strict';
/**
 * google-availability.test.cjs — ONE OUTPUT SHAPE: a product's status → Google Merchant `availability`. (M53)
 *
 * The first proof of "one catalogue, many outward shapes" (backlog MULTIFACETED OUTPUT, 2026-09-02): map CB's
 * lifecycle and shelf onto a published spec that REQUIRES the field. Google allows in_stock · out_of_stock ·
 * preorder · backorder, and has no "discontinued" — a product no longer sold is left out of the feed.
 *
 * Run: node tests/google-availability.test.cjs   · no DB, no network.
 */
const assert = require('assert');
const { googleAvailability } = require('../lib/itemstatus');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const GOOGLE = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];

console.log('\nSTATUS → GOOGLE MERCHANT availability\n');

it('an untouched product (no status) is in stock — an absent status means available', () => {
  assert.deepStrictEqual(googleAvailability({}), { include: true, availability: 'in_stock', why: null });
  assert.strictEqual(googleAvailability(null).availability, 'in_stock');
});
it('available with stock on the shelf, or no shelf feed at all → in_stock', () => {
  assert.strictEqual(googleAvailability({ status: 'available', avail: { qty: 12 } }).availability, 'in_stock');
  assert.strictEqual(googleAvailability({ status: 'available' }).availability, 'in_stock');
});
it('⭐ available but the shelf feed says 0 → out_of_stock (the lifecycle and the shelf are two questions)', () => {
  const r = googleAvailability({ status: 'available', avail: { qty: 0, source: 'tally' } });
  assert.strictEqual(r.availability, 'out_of_stock');
  assert.strictEqual(r.include, true);
});
it('⚠️ unavailable → out_of_stock, never backorder (the storefront takes no order for it)', () => {
  assert.strictEqual(googleAvailability({ status: 'unavailable', status_until: '2099-01-01' }).availability, 'out_of_stock');
});
it('⚠️ retired and redundant leave the feed — Google has no "discontinued" value to send', () => {
  const r = googleAvailability({ status: 'retired' }), d = googleAvailability({ status: 'redundant', status_replaced_by: 'X2' });
  assert.strictEqual(r.include, false); assert.strictEqual(r.availability, null); assert.ok(/retired/.test(r.why));
  assert.strictEqual(d.include, false); assert.ok(/replaced/.test(d.why));
});
it('every value it ever sends is one Google defines', () => {
  const shapes = [{}, { status: 'available' }, { status: 'available', avail: { qty: 0 } }, { status: 'unavailable' },
    { status: 'retired' }, { status: 'redundant' }, { status: 'nonsense' }, { status: 'available', avail: { qty: 'x' } }];
  shapes.map(googleAvailability).filter((r) => r.include).forEach((r) => assert.ok(GOOGLE.includes(r.availability), r.availability));
});

console.log('\n' + pass + ' checks passed\n');
