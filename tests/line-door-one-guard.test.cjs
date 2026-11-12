'use strict';
/**
 * tests/line-door-one-guard.test.cjs — MONEY WAVE 1 · M1 (CTRY-134, CAT-305/306/307/312/329): ONE LINE-DOOR GUARD on every door that reads lines[].
 * Doors: POST /api/tax/compute · /api/tax/rate · /api/invoice/build · /api/pricing/price · /api/offers/evaluate. The guard is services.badLine; codes in docs/error-codes.json.
 * Hand expectations (written before the code; shop prices EXCLUDE tax, priceIncludesTax:false pinned; the guard has no money field, so no currency to carry):
 *   qty 0 -> 400 BAD_QTY · price -5 -> 400 BAD_PRICE · qty 1e15 x price 1e15 -> 400 BAD_BOUND · lines [null, 7, "x"] -> 400 BAD_LINE (was a 500 TypeError)
 *   the edge of the one ceiling (1e12): 1e6 x 1e7 = 1e13 is refused; 1e6 x 1e5 = 1e11 is priced: total 100,000,000,000
 *   an ABSENT qty stays 1 on pricing/price (200, unit 10): only a GIVEN qty <= 0 is refused
 *   control: 2 x 10.00 at 10% -> 20.00 + 2.00 = 22.00 on invoice/build and tax/compute; offers: 2 x 10.00 with 10% off the line -> 18.00
 * No DB, no network (tests/support/tax-stub.cjs). Run: node --test tests/line-door-one-guard.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
let server, base;
test.before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/tax', require('../routes/tax'));
  app.use('/api/invoice', require('../routes/invoice'));
  app.use('/api/pricing', require('../routes/pricing'));
  app.use('/api/offers', require('../routes/offers'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());
const call = async (url, body) => {
  SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN', policy: { price_includes_tax: 'no' } });
  SHOP.items = [];
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const HALF = [{ id: 'ten', label: '10% off', kind: 'percent_off', percent: 10, scope: 'line' }];
/** each door with the line it is sent in; the same lines on every door */
const DOORS = [
  ['tax/compute', (lines) => call('/api/tax/compute', { lines, priceIncludesTax: false })],
  ['tax/rate', (lines) => call('/api/tax/rate', { lines })],
  ['invoice/build', (lines) => call('/api/invoice/build', { lines, priceIncludesTax: false })],
  ['pricing/price', (lines) => call('/api/pricing/price', { lines })],
  ['offers/evaluate', (lines) => call('/api/offers/evaluate', { lines, offers: HALF })]
];
const refused = (r, code) => {
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, code);
  assert.ok(r.body.detail || r.body.message, 'says why in words');
};

for (const [name, door] of DOORS) {
  test(name + ': qty 0 is 400 BAD_QTY', async () => refused(await door([{ name: 'Tea', qty: 0, price: 10, gst_rate: 10 }]), 'BAD_QTY'));
  test(name + ': price -5 is 400 BAD_PRICE', async () => refused(await door([{ name: 'Tea', qty: 1, price: -5, gst_rate: 10 }]), 'BAD_PRICE'));
  test(name + ': lines [null, 7, "x"] is 400 BAD_LINE, never a 500', async () => refused(await door([null, 7, 'x']), 'BAD_LINE'));
}
for (const [name, door] of DOORS.filter(([n]) => n !== 'tax/compute')) {
  test(name + ': qty 1e15 x price 1e15 is 400 BAD_BOUND', async () => refused(await door([{ name: 'Gold', qty: 1e15, price: 1e15, gst_rate: 10 }]), 'BAD_BOUND'));
  test(name + ': 1e6 x 1e7 = 1e13 is above the one ceiling and refused', async () => refused(await door([{ name: 'Gold', qty: 1e6, price: 1e7, gst_rate: 10 }]), 'BAD_BOUND'));
}
test('tax/compute keeps its own chit ceiling: 1e6 x 1e15 is still CHIT_AMOUNT_TOO_LARGE (ACC-282, frozen)', async () => {
  refused(await call('/api/tax/compute', { lines: [{ name: 'Gold', qty: 1e6, price: 1e15, gst_rate: 18 }] }), 'CHIT_AMOUNT_TOO_LARGE');
});
test('the edge: 1e6 x 1e5 = 1e11 is under the ceiling and priced, total 100,000,000,000', async () => {
  const r = await call('/api/pricing/price', { lines: [{ name: 'Bulk', qty: 1e6, price: 1e5 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, 100000000000);
});
test('pricing/price: an ABSENT qty is not refused (it is priced as 1: unit 10)', async () => {
  const r = await call('/api/pricing/price', { lines: [{ name: 'Tea', price: 10 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.lines[0].unit_price, 10);
});
test('offers/evaluate: a line with no price is 400 NO_PRICE (it was read as 0)', async () => refused(await call('/api/offers/evaluate', { lines: [{ name: 'Tea', qty: 2 }], offers: HALF }), 'NO_PRICE'));
test('control: invoice/build 2 x 10.00 at 10% = 20.00 + 2.00 = 22.00', async () => {
  const r = await call('/api/invoice/build', { lines: [{ name: 'Tea', qty: 2, price: 10, gst_rate: 10 }], priceIncludesTax: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invoice.ValDtls.TotInvVal, 22);
});
test('control: tax/compute says the same 22.00, and pricing/price 2 x 10.00 = 20.00', async () => {
  const c = await call('/api/tax/compute', { lines: [{ name: 'Tea', qty: 2, price: 10, gst_rate: 10 }], priceIncludesTax: false });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.invoice.ValDtls.TotInvVal, 22);
  const p = await call('/api/pricing/price', { lines: [{ name: 'Tea', qty: 2, price: 10 }] });
  assert.equal(p.body.total, 20);
});
test('control: offers/evaluate 2 x 10.00 with 10% off the line = 18.00', async () => {
  const r = await call('/api/offers/evaluate', { lines: [{ name: 'Tea', qty: 2, price: 10 }], offers: HALF });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.subtotal, 20);
  assert.equal(r.body.total, 18);
});
