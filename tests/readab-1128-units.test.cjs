/**
 * tests/readab-1128-units.test.cjs — the unit evidence (DISCIPLINES §7: one test per rule, a refusal path, fail closed) for three small modules of batch 1128.
 * No database, no network: the modules are read as they are, the one outside read (govresolve) is replaced by a stand-in that answers or fails.
 *
 * HAND-COMPUTED (each expectation is the rule's own sentence, not a read-back of the code):
 *   receipt-lines   a received quantity of 0 or -3 is refused BAD_QTY, so is one at or above the catalogue ceiling · a lot that expired before today is refused RECEIPT_LOT_EXPIRED ·
 *                   the date "12/03/25" is refused RECEIPT_DATE_UNREADABLE · a good line, a draft and an order are not refused · a receipt line naming an item no shop sells is refused RECEIPT_ITEM_UNKNOWN.
 *   shop-country    the country the shop's governance states, in capitals · nothing stated answers '' · a read that fails answers '' (fail closed to the neutral list), never throws.
 *   profilemap      the one-line door hands back the very object lib/profile-map.js exports.
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/readab-1128-units.test.cjs
 * CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const path = require('path');
const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const API = path.join(__dirname, '..');

let checks = 0;
let failed = 0;
function check(name, fn) {
  checks++;
  try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); }
}
async function checkAsync(name, fn) {
  checks++;
  try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); }
}

const receipt = require(path.join(API, 'lib', 'receipt-lines'));
const TODAY = '2026-11-21';
const receiptOf = (line) => ({ purpose: 'receipt', is_draft: false, line_items: [line], business_json: { doc: 'receipt' } });
const goodLine = { name: 'Rice', quantity: 5, price: 40 };

check('receipt-lines: a quantity of 0 is refused BAD_QTY on line 1', () => {
  const refused = receipt.refusalOf(receiptOf({ name: 'Rice', quantity: 0, price: 40 }), { today: TODAY });
  assert.strictEqual(refused.code, 'BAD_QTY');
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.line, 0);
});
check('receipt-lines: a negative quantity is refused BAD_QTY', () => {
  assert.strictEqual(receipt.refusalOf(receiptOf({ name: 'Rice', quantity: -3, price: 40 }), { today: TODAY }).code, 'BAD_QTY');
});
check('receipt-lines: a quantity at the ceiling is refused, one under it is not', () => {
  assert.strictEqual(receipt.refusalOf(receiptOf({ name: 'Rice', quantity: receipt.RECEIPT_QTY_CEILING, price: 40 }), { today: TODAY }).code, 'BAD_QTY');
  assert.strictEqual(receipt.refusalOf(receiptOf({ name: 'Rice', quantity: receipt.RECEIPT_QTY_CEILING - 1, price: 40 }), { today: TODAY }), null);
});
check('receipt-lines: a lot that expired before today is refused RECEIPT_LOT_EXPIRED', () => {
  const refused = receipt.refusalOf(receiptOf({ name: 'Milk', quantity: 2, price: 30, item_data: { batch: 'L1', expiry: '2026-11-01' } }), { today: TODAY });
  assert.strictEqual(refused.code, 'RECEIPT_LOT_EXPIRED');
});
check('receipt-lines: the date 12/03/25 is refused as unreadable, never guessed', () => {
  const refused = receipt.refusalOf(receiptOf({ name: 'Milk', quantity: 2, price: 30, item_data: { batch: 'L1', expiry: '12/03/25' } }), { today: TODAY });
  assert.ok(refused && /UNREADABLE/.test(refused.code), 'got ' + JSON.stringify(refused));
});
check('receipt-lines: a good line, a draft and a non-receipt are not refused', () => {
  assert.strictEqual(receipt.refusalOf(receiptOf(goodLine), { today: TODAY }), null);
  assert.strictEqual(receipt.refusalOf(Object.assign(receiptOf({ name: 'Rice', quantity: 0 }), { is_draft: true }), { today: TODAY }), null);
  assert.strictEqual(receipt.refusalOf({ purpose: 'order', line_items: [{ name: 'Rice', quantity: 0 }], business_json: {} }, { today: TODAY }), null);
});

(async () => {
  await checkAsync('receipt-lines: a line naming an item no shop sells is refused RECEIPT_ITEM_UNKNOWN (the catalogue read finds nothing)', async () => {
    const noRows = (entity, work) => work({ query: async () => ({ rows: [] }) });
    const chit = receiptOf({ name: 'Ghost', quantity: 1, price: 10, item_id: '3165cee7-927c-433f-8bff-eb2374a48430' });
    const refused = await receipt.catalogueRefusal(chit, 'shop-1', noRows);
    assert.strictEqual(refused.code, 'RECEIPT_ITEM_UNKNOWN');
  });

  const govPath = require.resolve(path.join(API, 'lib', 'govresolve'));
  const govFile = require(govPath);
  const original = govFile.resolveEntityGovernance;
  const shopCountry = require(path.join(API, 'lib', 'shop-country'));
  try {
    govFile.resolveEntityGovernance = async () => ({ basics: { country: 'AU' } });
    await checkAsync('shop-country: the country the shop states is read', async () => { assert.strictEqual(await shopCountry.shopCountryOf('shop-1'), 'AU'); });
    govFile.resolveEntityGovernance = async () => ({ basics: {} });
    await checkAsync('shop-country: nothing stated answers the empty neutral value', async () => { assert.strictEqual(await shopCountry.shopCountryOf('shop-1'), ''); });
    govFile.resolveEntityGovernance = async () => { throw new Error('governance read failed'); };
    await checkAsync('shop-country: a read that fails answers the neutral value and never throws (fail closed)', async () => { assert.strictEqual(await shopCountry.shopCountryOf('shop-1'), ''); });
  } finally {
    govFile.resolveEntityGovernance = original;
  }

  check('profilemap: the door is the very object lib/profile-map.js exports', () => {
    assert.strictEqual(require(path.join(API, 'lib', 'profilemap')), require(path.join(API, 'lib', 'profile-map')));
  });

  console.log(failed ? failed + ' failed of ' + checks : checks + ' checks passed, 0 failed');
  process.exit(failed ? 1 : 0);
})();
