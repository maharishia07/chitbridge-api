#!/usr/bin/env node
// @type: unit
/**
 * tests/trace-edge-qty.known-failing.cjs — KNOWN FAILING (QA coverage 2026-11-06): THE QUANTITY OF A TRACEABILITY EDGE IS COERCED, NOT CHECKED.
 * NOT in scripts/guards.cjs on purpose: it fails until lib/trace.js is fixed by its owner (area 13 / cb-operations). Run by hand: node tests/trace-edge-qty.known-failing.cjs
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / Batch traceability & mass balance
 * OWNS      the three holes in lib/trace.js buildEdge/toBase (finding written up in PM/COVERAGE-GAPS-2026-11-06.md):
 *             F1  qty null, "" or [] is read as 0 (and true as 1) because `Number.isFinite(+x)` is true for them — a missing quantity becomes a real zero;
 *             F2  qty missing or "abc" gives qty null BESIDE base_qty 0 (toBase coerces null to 0) — the balance (routes/chits-trace.js traceBalance reads base_qty,
 *                 skips only base_qty == null) therefore treats "unknown" as "0 out" instead of "no quantity to balance";
 *             F3  a negative quantity is accepted (-5 kg → base_qty -5000): a child edge with a negative quantity subtracts from `out`, so a parent of 1000 g with
 *                 children +1500 g and -500 g reads out 1000 → status ok, the over-claim hidden.
 * CALLED BY nothing yet (known failing). CARD 13-inventory-stock-and-traceability/batch-traceability-and-mass-balance
 */
'use strict';
const assert = require('assert');
const path = require('path');
const trace = require(path.join(__dirname, '..', 'lib', 'trace.js'));

let failing = 0, held = 0;
function it(what, fn) {
  try { fn(); held++; console.log('  ok  ' + what); } catch (e) { failing++; console.log('  KNOWN-GAP ' + what + '\n       ' + e.message); }
}
const origin = (qty) => trace.buildEdge({ is_origin: true, qty, unit: 'kg' }).edge;

it('F1 request {trace:{is_origin:true,qty:null,unit:"kg"}}: expected qty null (unknown), actual 0', () => {
  for (const q of [null, '', []]) assert.strictEqual(origin(q).qty, null, 'qty ' + JSON.stringify(q) + ' became ' + origin(q).qty);
});
it('F1b a boolean is not a quantity: qty true expected null, actual 1', () => {
  assert.strictEqual(origin(true).qty, null);
});
it('F2 a missing quantity leaves base_qty null too (lib/trace.js:44-46 toBase), actual base_qty 0 beside qty null', () => {
  assert.strictEqual(origin(undefined).qty, null);
  assert.strictEqual(origin(undefined).base_qty, null, 'base_qty is ' + origin(undefined).base_qty);
});
it('F3 a negative quantity is refused with an error (expected {error}), actual an edge with base_qty -5000', () => {
  const r = trace.buildEdge({ is_origin: true, qty: -5, unit: 'kg' });
  assert.ok(r.error, 'accepted: ' + JSON.stringify(r.edge));
});

console.log('\n  ' + held + ' held · ' + failing + ' known gaps (expected until lib/trace.js is fixed)');
process.exit(failing ? 1 : 0);
