#!/usr/bin/env node
// @type: unit
/**
 * tests/inventory-null-rate.known-failing.cjs — KNOWN FAILING (QA coverage 2026-11-06): A RECEIPT WITH rate NULL OR "" IS BOOKED AT COST 0.
 * NOT in scripts/guards.cjs on purpose: it fails until lib/inventory.js check() is fixed by its owner (area 13 / cb-operations). Run by hand: node tests/inventory-null-rate.known-failing.cjs
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / On hand & movements
 * OWNS      lib/inventory.js check() line `var rate = num(m.rate)` : num(null) and num('') are 0 (Number(null) === 0), so `rate === null` is never true for them and a
 *           purchase/opening with rate null or "" passes the "needs a cost price" rule the header describes as fixed (the `null >= 0` trap). The chit path is guarded
 *           upstream (stock-from-chit rateOf returns null → a named skip no_cost), so no route reaches it today: this is an engine-door hole, defence in depth.
 *           Effect when reached: 10 pieces at average 100 + a null-rate receipt of 10 → average 50, value unchanged (the shelf doubles at no cost).
 * CALLED BY nothing yet (known failing). CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const assert = require('assert');
const path = require('path');
const inv = require(path.join(__dirname, '..', 'lib', 'inventory.js'));
let gaps = 0;
for (const rate of [null, '']) {
  try {
    assert.strictEqual(inv.check({ item_id: 'r', reason: 'purchase', qty: 10, rate }).ok, false);
    console.log('  ok  purchase with rate ' + JSON.stringify(rate) + ' is refused');
  } catch (e) {
    gaps++;
    console.log('  KNOWN-GAP request {reason:"purchase", qty:10, rate:' + JSON.stringify(rate) + '}: expected refused (needs a cost price), actual accepted at cost 0 (lib/inventory.js check, num(null) === 0)');
  }
}
const after = inv.apply({ qty: 10, value: 1000, avg_cost: 100 }, { item_id: 'r', reason: 'purchase', qty: 10, rate: null });
console.log('  actual balance after the null-rate receipt: qty ' + after.qty + ' value ' + after.value + ' avg ' + after.avg_cost + ' (average halved)');
console.log('\n  ' + gaps + ' known gaps (expected until lib/inventory.js is fixed)');
process.exit(gaps ? 1 : 0);
