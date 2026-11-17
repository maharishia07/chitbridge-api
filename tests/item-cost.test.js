'use strict';
/**
 * item-cost.js — the shape a rough cost is read and written in, exercised with no server, no browser, no
 * database. See the module's own header for why item_data.cost, not a new column.
 *
 * Run: node tests/item-cost.test.js
 */
const assert = require('node:assert');
const ic = require('../lib/item-cost');

/* ── no cost ever set: null, never zero (spec §8: cost==null means unknown, never zero) ──────────────────── */
assert.strictEqual(ic.costOf({}), null);
assert.strictEqual(ic.costOf({ cost: null }), null);

/* ── a typed cost round-trips ──────────────────────────────────────────────────────────────────────────── */
(function () {
  const patch = ic.setCost(38, 'manual');
  assert.strictEqual(patch.cost.value, 38);
  assert.strictEqual(patch.cost.source, 'manual');
  assert.ok(patch.cost.updated_at);
  const got = ic.costOf({ cost: patch.cost });
  assert.strictEqual(got.value, 38);
  assert.strictEqual(got.source, 'manual');
})();

/* ── a source this module does not build yet (rule / tally / zoho) is still a valid VALUE to hold —
   nothing writes these today, but the shape must not reject them when something eventually does */
(function () {
  for (const src of ['rule', 'tally', 'zoho']) {
    const patch = ic.setCost(100, src, 'from ' + src);
    assert.strictEqual(patch.cost.source, src);
    assert.strictEqual(ic.costOf({ cost: patch.cost }).source, src);
  }
})();

/* ── an unrecognised source falls back to 'manual' rather than being trusted blindly ──────────────────────── */
assert.strictEqual(ic.costOf({ cost: { value: 10, source: 'made-up' } }).source, 'manual');

/* ── clearing a cost sets it back to unknown, not zero ─────────────────────────────────────────────────────── */
assert.deepStrictEqual(ic.setCost(null), { cost: null });

/* ── a negative or non-numeric cost is refused, not silently coerced ───────────────────────────────────────── */
assert.throws(() => ic.setCost(-5), /non-negative/);
assert.throws(() => ic.setCost('free lunch'), /non-negative/);

/* ── a malformed stored value (no `value`, or NaN) reads as null rather than throwing ──────────────────────── */
assert.strictEqual(ic.costOf({ cost: {} }), null);
assert.strictEqual(ic.costOf({ cost: { value: 'not a number' } }), null);
assert.strictEqual(ic.costOf({ cost: 'not even an object' }), null);

console.log('item-cost: 11 checks passed');
