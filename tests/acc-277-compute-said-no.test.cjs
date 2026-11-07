'use strict';
/**
 * tests/acc-277-compute-said-no.test.cjs — ACC-277: AN AU SHOP WHOSE OWNER SAID "NOT REGISTERED" IS NOT CHARGED GST on POST /api/tax/compute and /api/invoice/build.
 * services.shopOf built the party from the identities row (no governance row), so RegType stayed 'regular': 3,300 instead of 3,000. shopOf now reads the
 * ONE answer (tax-lines.withRegistration). 2 x 1,500 excl at 10%: registered 3,300 · said no 3,000. Never said stays ACC-272's 409.
 * Run: node --test tests/acc-277-compute-said-no.test.cjs · no DB, no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
const CS = require('../lib/country-setup');
test.before(X.start);
test.after(X.stop);
const original = CS.registrationOfShop;
test.afterEach(() => { CS.registrationOfShop = original; });
const LINES = [{ key: 'a', name: 'Goods', qty: 2, price: 1500, gst_rate: 10 }];
const as = (country, gstin, answer) => { SHOP.row = shopRow({ gstin, name: 'Shop', country }); SHOP.items = []; CS.registrationOfShop = async () => answer; };
for (const url of ['/api/tax/compute', '/api/invoice/build']) {
  test(url + ' · AU shop, owner said NOT registered: 3,000, no GST', async () => {
    as('AU', null, 'unregistered');
    const r = await X.call('POST', url, { lines: LINES, priceIncludesTax: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 3000);
  });
  test(url + ' · AU shop with an ABN: 3,300 as before', async () => {
    as('AU', '51824753556', 'regular');
    const r = await X.call('POST', url, { lines: LINES, priceIncludesTax: false });
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 3300);
  });
  test(url + ' · AU shop, registration never said: still asked (409)', async () => {
    as('AU', null, 'unknown');
    const r = await X.call('POST', url, { lines: LINES, priceIncludesTax: false });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'TAX_REGISTRATION_UNKNOWN');
  });
  test(url + ' · a body.seller naming no registration of its own is the shop: its said-no still holds', async () => {
    as('AU', null, 'unregistered');
    const r = await X.call('POST', url, { lines: LINES, priceIncludesTax: false, seller: { name: 'My shop' } });
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 3000);
  });
}
test('a body.seller saying RegType regular with no number cannot override the shop\'s said-no (/tax/compute)', async () => {
  as('AU', null, 'unregistered');
  const r = await X.call('POST', '/api/tax/compute', { lines: LINES, priceIncludesTax: false, seller: { name: 'My shop', RegType: 'regular', country: 'AU' } });
  assert.equal(r.body.invoice.ValDtls.TotInvVal, 3000);
});
