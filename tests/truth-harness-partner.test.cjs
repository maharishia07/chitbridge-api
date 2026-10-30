'use strict';
// @type: unit
/**
 * tests/truth-harness-partner.test.cjs — the harness's partner chits (tests/lib/truth-harness.cjs order() and invoice(), LIFECYCLE-B4 §5.2):
 * a purchase order is an order chit with side 'buy', an invoice carries its engine figures unchanged and names the order it bills against,
 * every line carries item_data.item_id, and the supplier's rate (not the product's own) is the line price. Offline: no api, no database.
 * CARD 01-rail-core-the-chit/README
 */
const assert = require('assert');
const path = require('path');
const H = require(path.join(__dirname, 'lib', 'truth-harness.cjs'));

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const parotta = { id: 'item-1', name: 'Parotta', unit: 'piece', price: 25 };

console.log('\n══ truth-harness order() and invoice() ══\n');

ok('order: purpose order, side buy, one recipient by bridge id, the supplier rate on the line', () => {
  const o = H.order('B4-P1', [[parotta, 10, 12]], { to: 'bridge-7' });
  assert.strictEqual(o.purpose, 'order');
  assert.strictEqual(o.business_json.side, 'buy');
  assert.strictEqual(o.client_ref, 'B4-P1');
  assert.deepStrictEqual(o.recipients, [{ bridge_id: 'bridge-7', kind: 'to' }]);
  assert.deepStrictEqual([o.line_items[0].quantity, o.line_items[0].price, o.line_items[0].total], [10, 12, 120]);
  assert.strictEqual(o.line_items[0].item_data.item_id, 'item-1');
});

ok('order: the side can be stated, and a missing price falls back to the product price', () => {
  const o = H.order('B4-P9', [[parotta, 2]], { to: 'bridge-7', side: 'sell' });
  assert.strictEqual(o.business_json.side, 'sell');
  assert.strictEqual(o.line_items[0].price, 25);
});

ok('invoice: purpose invoice, the engine invoice carried unchanged, against names the order chit', () => {
  const inv = { ValDtls: { AssVal: 120, IgstVal: 6, TotInvVal: 126 } };
  const b = H.invoice('B4-J1', [[parotta, 10, 12]], { to: { bridge: 'bridge-9' }, invoice: inv, against: 'chit-P1', billedAt: '2026-10-30T05:00:00Z' });
  assert.strictEqual(b.purpose, 'invoice');
  assert.strictEqual(b.business_json.bill_no, 'B4-J1');
  assert.strictEqual(b.business_json.invoice, inv);
  assert.deepStrictEqual(b.business_json.against, { chit_id: 'chit-P1' });
  assert.strictEqual(b.business_json.billed_at, '2026-10-30T05:00:00Z');
  assert.strictEqual(b.recipients[0].bridge_id, 'bridge-9');
  assert.strictEqual(b.line_items[0].item_data.item_id, 'item-1');
});

ok('invoice: no invoice and no against, no such keys on the chit', () => {
  const b = H.invoice('B4-J0', [[parotta, 1, 12]], { to: 'bridge-9' });
  assert.ok(!('invoice' in b.business_json) && !('against' in b.business_json));
});

ok('the older builders are untouched (bill keeps a string third argument as billedAt)', () => {
  const b = H.bill('X1', [[parotta, 1]], '2026-10-30T00:00:00Z');
  assert.strictEqual(b.business_json.billed_at, '2026-10-30T00:00:00Z');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
