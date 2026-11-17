'use strict';
/**
 * tests/acc-221-blank-rate-route.test.cjs — ACC-221/222 live fault (SIT part 6, 2026-11-07): a BLANK gst_rate with no shelf rate answers
 * 400 BAD_RATE by name on the REAL routes (/api/tax/compute, /api/invoice/build) — never 0%, never a 500 TAX_FAILED.
 * The reading of a blank is services.rateOrNull (one reader); the refusal is services.computeTax; the HTTP status is lib/tax-contract faultOf.
 * Hand-computed control: 2 x 100.00 excl at 18% = 200 + 36 = 236 (IN); a blank rate on a shelf at 18% = the same 236.
 * Run: node --test tests/acc-221-blank-rate-route.test.cjs · no DB, no network (tests/support/tax-stub.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
test.before(X.start);
test.after(X.stop);
const IN = { gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN' };
const AU = { gstin: '51824753556', name: 'Milk Bar', country: 'AU' };
const line = (over) => Object.assign({ name: 'Tea', qty: 2, price: 100, gst_rate: 18 }, over);

for (const [cc, shop] of [['IN', IN], ['AU', AU]]) {
  for (const route of ['/api/tax/compute', '/api/invoice/build']) {
    for (const blank of ['', '  ', null]) {
      test(cc + ' ' + route + ' gst_rate ' + JSON.stringify(blank) + ', no shelf rate: 400 BAD_RATE by name, not 500', async () => {
        SHOP.row = shopRow(shop); SHOP.items = [];
        const r = await X.call('POST', route, { priceIncludesTax: false, lines: [line({ gst_rate: blank })] });
        assert.equal(r.status, 400, JSON.stringify(r.body));
        assert.equal(r.body.code, 'BAD_RATE');
        assert.match(r.body.message, /no tax rate/);
        assert.doesNotMatch(JSON.stringify(r.body), /TAX_FAILED/);
      });
    }
  }
}
test('IN control: a rate of 18 is 200 + 36 = 236; a blank rate on a shelf item at 18% is the same', async () => {
  SHOP.row = shopRow(IN); SHOP.items = [{ item_id: 'P1', item_data: { name: 'Tea', price: 100, gst_rate: 18 } }];
  const a = await X.call('POST', '/api/tax/compute', { priceIncludesTax: false, lines: [line()] });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.money.total, 236);
  const b = await X.call('POST', '/api/tax/compute', { priceIncludesTax: false, lines: [line({ gst_rate: '', item_id: 'P1' })] });
  assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.money.total, 236);
});
