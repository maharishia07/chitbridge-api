'use strict';
/**
 * tests/ctry-94-invoice-no-country.test.cjs — POST /api/invoice/build for a shop with NO country answers 422 NO_COUNTRY, never a 500 and never India (CTRY-94, SIT part 19).
 * The words are country-setup.COUNTRY_FIRST — the one sentence the books and /api/tax/compute say. An IN shop builds as before.
 * Run: node --test tests/ctry-94-invoice-no-country.test.cjs · no DB, no network (tests/support/tax-stub.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs'); /* the shop in a stubbed db + the REAL routers — before any lib */
const { SHOP, shopRow } = X;
const CS = require('../lib/country-setup');
test.before(X.start);
test.after(X.stop);
const LINE = { lines: [{ name: 'Pie', qty: 1, price: 100, gst_rate: 5 }] };

test('a shop with no country: invoice/build is 422 NO_COUNTRY in the one sentence, with no tax block', async () => {
  SHOP.row = shopRow({ gstin: null, name: 'Nowhere', country: null }); SHOP.items = [];
  const r = await X.call('POST', '/api/invoice/build', LINE);
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, 'NO_COUNTRY');
  assert.equal(r.body.message, CS.COUNTRY_FIRST);
  assert.match(r.body.message, /Country setup/);
  assert.equal(r.body.invoice, undefined, 'no invoice, so no India tax');
  assert.equal(r.body.heads, undefined);
});

test('tax/compute says the same sentence for a shop with no country', async () => {
  SHOP.row = shopRow({ gstin: null, name: 'Nowhere', country: null }); SHOP.items = [];
  const r = await X.call('POST', '/api/tax/compute', LINE);
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'NO_COUNTRY');
  assert.equal(r.body.message, CS.COUNTRY_FIRST);
});

test('an IN shop still builds an invoice with GST', async () => {
  SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN' }); SHOP.items = [];
  const r = await X.call('POST', '/api/invoice/build', LINE);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.invoice && r.body.invoice.ValDtls, 'an invoice block');
  assert.equal(r.body.seller.Country, 'IN');
});

/* CTRY-114: a shop whose country has no tax pack (HU, DK) is refused in words through the problem shape — 422 NO_COUNTRY_PACK, never a 500 "Something went wrong" from the engine's "no tax scheme" throw */
for (const [country, name] of [['HU', 'Hungary'], ['DK', 'Denmark']]) {
  test('a ' + country + ' shop: invoice/build is 422 NO_COUNTRY_PACK, "' + name + ' does not have a tax pack yet", no tax block', async () => {
    SHOP.row = shopRow({ gstin: null, name: 'Bolt ' + country, country }); SHOP.items = [];
    const r = await X.call('POST', '/api/invoice/build', { buyer: { Country: country }, lines: [{ name: 'Pie', qty: 1, price: 100, gst_rate: 18 }] });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'NO_COUNTRY_PACK');
    assert.match(r.body.message, new RegExp(name + ' does not have a tax pack yet'));
    assert.equal(r.body.invoice, undefined, 'no invoice, so no tax of another country');
    const compute = await X.call('POST', '/api/tax/compute', { buyer: { Country: country }, lines: [{ name: 'Pie', qty: 1, price: 100, gst_rate: 18 }] });
    assert.equal(compute.status, 422, 'tax/compute reads the same engine and says the same: ' + JSON.stringify(compute.body));
    assert.equal(compute.body.code, 'NO_COUNTRY_PACK');
  });
}
