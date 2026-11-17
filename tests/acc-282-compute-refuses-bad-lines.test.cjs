'use strict';
/**
 * tests/acc-282-compute-refuses-bad-lines.test.cjs — ACC-282 (+ CAT-307's bound on the quote door): POST /api/tax/compute REFUSES A DISCOUNT ABOVE ITS LINE AND A RUNAWAY AMOUNT.
 * SIT hunt ACC-H5: discount 150 on a 100 line answered 200 with assessable 0; price 1e15 × qty 1e6 answered 200 with a total of 1.18e21.
 * Hand expectations (IN shop, prices exclude tax, 18%), written before the code:
 *   discount 150 on 1 × 100 → 400 BAD_PRICE naming the discount, no figure · discount 100 on 1 × 100 → 200, assessable 0, total 0 (a discount may take a line to 0)
 *   1e6 × 1e15 → 400 CHIT_AMOUNT_TOO_LARGE saying 9,999,999,999,999.99 INR (the chit total's column, lib/chit-ceiling) · price 1e18 × 1 → the same 400
 *   1 × 9,999,999,999,999 at 0% → 200, total 9999999999999 (just under the ceiling) · 2 × 100 + 18% → 236 as before.
 * No DB, no network (tests/support/tax-stub.cjs). Run: node --test tests/acc-282-compute-refuses-bad-lines.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
test.before(X.start);
test.after(X.stop);
const post = (lines) => { SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN', policy: { price_includes_tax: 'no' } }); SHOP.items = []; return X.call('POST', '/api/tax/compute', { lines }); };

test('a discount above its line is refused 400 BAD_PRICE, in words, with no figure', async () => {
  const r = await post([{ name: 'Rice', qty: 1, price: 100, discount: 150, gst_rate: 18 }]);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'BAD_PRICE');
  assert.match(r.body.message || r.body.detail, /discounts and offers together larger than the line/);
  assert.equal(r.body.invoice, undefined);
});
test('a discount equal to its line is allowed: assessable 0, total 0', async () => {
  const r = await post([{ name: 'Rice', qty: 1, price: 100, discount: 100, gst_rate: 18 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invoice.ValDtls.AssVal, 0);
  assert.equal(r.body.invoice.ValDtls.TotInvVal, 0);
});
test('price 1e15 x qty 1e6 is refused 400 CHIT_AMOUNT_TOO_LARGE with the ceiling and its currency', async () => {
  const r = await post([{ name: 'Gold', qty: 1e6, price: 1e15, gst_rate: 18 }]);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'CHIT_AMOUNT_TOO_LARGE');
  assert.match(r.body.message || r.body.detail, /9,999,999,999,999\.99 INR/);
});
test('price 1e18 x 1 is refused the same way (SIT night 8-9)', async () => {
  const r = await post([{ name: 'Gold', qty: 1, price: 1e18, gst_rate: 10 }]);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'CHIT_AMOUNT_TOO_LARGE');
});
test('just under the ceiling still prices: 9,999,999,999,999 at 0%', async () => {
  const r = await post([{ name: 'Gold', qty: 1, price: 9999999999999, gst_rate: 0 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invoice.ValDtls.TotInvVal, 9999999999999);
});
test('an ordinary line is unchanged: 2 x 100 + 18% = 236', async () => {
  const r = await post([{ name: 'Tea', qty: 2, price: 100, gst_rate: 18 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invoice.ValDtls.TotInvVal, 236);
});
test("invoice/build adds the line's own discount and a 50% offer: 60 + 50 on a 100 line is 400 BAD_PRICE", async () => {
  SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN', policy: { price_includes_tax: 'no' } }); SHOP.items = [];
  const offers = [{ id: 'half', label: '50% off', kind: 'percent_off', percent: 50, scope: 'line' }];
  const r = await X.call('POST', '/api/invoice/build', { lines: [{ name: 'Rice', qty: 1, price: 100, discount: 60, gst_rate: 18 }], offers });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'BAD_PRICE');
  assert.match(r.body.message || r.body.detail, /discounts and offers together larger than the line/);
});
