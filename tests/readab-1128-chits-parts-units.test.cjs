/**
 * tests/readab-1128-chits-parts-units.test.cjs — unit evidence (DISCIPLINES §7) for lib/chits-parts.js: the pure refusals split out of routes/chits.js.
 * No database, no network. HAND-COMPUTED: an invoice with CGST 5.00 + SGST 5.00 carries 10.00 of tax; a composition or unregistered seller is refused it (422 body, code
 * TAX_NOT_CHARGEABLE) and a regular seller is not; a payment mark is not cleared on a withdrawn or rejected bill (409) nor on a bill that carries its own tender (422), and a copy
 * the shop does not hold has nothing to clear; only the sender may void (404 no copy · 403 not the sender · null the sender).
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/readab-1128-chits-parts-units.test.cjs
 * CARD 01-rail-core-the-chit/chits-routes
 */
'use strict';
const assert = require('assert');
const parts = require('../lib/chits-parts');
let failed = 0, passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); } }
const taxed = { ValDtls: { AssVal: 100, CgstVal: 5, SgstVal: 5, IgstVal: 0, CesVal: 0, TotInvVal: 110 }, ItemList: [] };
const refusal = (regType, invoice) => parts.taxNotChargeableRefusal({ seller: { RegType: regType } }, { invoice });
check('a composition seller with 10.00 of tax on the bill is refused TAX_NOT_CHARGEABLE', () => {
  const said = refusal('composition', taxed);
  assert.strictEqual(said.code, 'TAX_NOT_CHARGEABLE');
  assert.ok(/10\.00/.test(said.message) && /composition/.test(said.message));
});
check('an unregistered seller with tax on the bill is refused', () => assert.strictEqual(refusal('unregistered', taxed).registration, 'unregistered'));
check('a regular seller may charge tax: no refusal', () => assert.strictEqual(refusal('regular', taxed), null));
check('a seller whose registration is not known keeps the older path: no refusal', () => assert.strictEqual(refusal(undefined, taxed), null));
check('a composition seller with no tax on the bill is not refused', () => assert.strictEqual(refusal('composition', { ValDtls: { AssVal: 100, TotInvVal: 100 }, ItemList: [] }), null));
check('refused: no copy means nothing to clear', () => assert.deepStrictEqual(parts.paymentClearShut(null), { rows: [] }));
check('refused: a rejected bill is named, never cleared', () => assert.strictEqual(parts.paymentClearShut({ current_status: 'rejected' }).voided, 'rejected'));
check('refused: a bill carrying its own tender is not this door\'s', () => assert.strictEqual(parts.paymentClearShut({ current_status: 'sent', business_json: { payment: { parts: [] } } }).parts, true));
check('an ordinary sent bill may be cleared: null', () => assert.strictEqual(parts.paymentClearShut({ current_status: 'sent' }), null));
check('a withdrawn bill says 409 and a tender bill says 422, a clear one says nothing', () => {
  assert.strictEqual(parts.paymentClearShutSaid({ voided: 'cancelled' }).status, 409);
  assert.strictEqual(parts.paymentClearShutSaid({ parts: true }).status, 422);
  assert.strictEqual(parts.paymentClearShutSaid({ rows: [] }), null);
});
check('void: no copy is 404 not found', () => assert.strictEqual(parts.voidNotAllowed({ rows: [] }, 'shop-a').status, 404));
check('refused: void by a party that is not the sender is 403', () => assert.strictEqual(parts.voidNotAllowed({ rows: [{ sender_entity_id: 'shop-b' }] }, 'shop-a').status, 403));
check('void by the sender is allowed: null', () => assert.strictEqual(parts.voidNotAllowed({ rows: [{ sender_entity_id: 'shop-a' }] }, 'shop-a'), null));
check('only cancelled and rejected carry no payment mark', () => assert.deepStrictEqual(parts.NO_PAYMENT_STATUS, ['cancelled', 'rejected']));
(async () => {
  const gates = [{ from: 'sent', write: async () => true, copy: 'sent' }, { from: 'received', write: async () => false, copy: 'received' }];
  const moved = await parts.writeGates(gates);
  check('writeGates names only the copies that moved', () => assert.deepStrictEqual(moved, [{ copy: 'sent', from: 'sent' }]));
  console.log(failed ? failed + ' failed' : passed + ' passed, 0 failed');
  process.exit(failed ? 1 : 0);
})();
