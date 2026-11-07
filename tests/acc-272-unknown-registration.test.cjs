'use strict';
/**
 * tests/acc-272-unknown-registration.test.cjs — ACC-272: A SHOP THAT NEVER SAID WHETHER IT IS REGISTERED IS ASKED, NOT PRICED AT NO TAX.
 *
 * POST /api/tax/compute and POST /api/invoice/build never asked country-setup.registrationOf: a shop with no tax number that the owner never
 * confirmed as unregistered was priced at 0% in silence (ACC-198 closed it at the till only). Both doors now answer 409 TAX_REGISTRATION_UNKNOWN,
 * with the question in the pack's word for its tax, exactly as POST /till/rate does (lib/services.sellerKnown -> the same reader, predicate, code).
 * "No GSTIN, no GST" (Athi 2026-09-05) applies once the owner confirmed unregistered. The REAL routers over the stubbed db (tests/support/tax-stub.cjs);
 * the ONE reader's answer is set on country-setup.registrationOfShop (the till tests' own patch point).
 * Run: node --test tests/acc-272-unknown-registration.test.cjs · no DB, no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
const CS = require('../lib/country-setup');
test.before(X.start);
test.after(X.stop);

const LINES = [{ key: 'a', name: 'Tea', qty: 2, price: 100, gst_rate: 18 }];
const DOORS = [['POST', '/api/tax/compute', (extra) => Object.assign({ lines: LINES, priceIncludesTax: false }, extra)], ['POST', '/api/invoice/build', (extra) => Object.assign({ lines: LINES, priceIncludesTax: false }, extra)]];
const SHOPS = { IN: { gstin: null, name: 'Ponni', country: 'IN' }, AU: { gstin: null, name: 'Milk Bar', country: 'AU' }, AE: { gstin: null, name: 'Souq', country: 'AE' } };
const WORD = { IN: 'GST', AU: 'GST', AE: 'VAT' };
const GSTIN = { IN: '33AAAAA0000A1Z5', AU: '51824753556', AE: '100123456700003' };
const original = CS.registrationOfShop;
test.afterEach(() => { CS.registrationOfShop = original; });
const as = (country, answer, over) => { SHOP.row = shopRow(Object.assign({}, SHOPS[country], over || {})); SHOP.items = []; CS.registrationOfShop = async () => answer; };

for (const [method, url, bodyOf] of DOORS) {
  for (const cc of Object.keys(SHOPS)) {
    test(url + ' · ' + cc + ' shop, no tax number, registration never said: 409 TAX_REGISTRATION_UNKNOWN with the question in the pack\'s word', async () => {
      as(cc, 'unknown');
      const r = await X.call(method, url, bodyOf());
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, 'TAX_REGISTRATION_UNKNOWN');
      assert.match(JSON.stringify(r.body), new RegExp('registered for ' + WORD[cc]));
      assert.equal(r.body.invoice, undefined, 'nothing is priced');
    });
  }
  test(url + ' · the owner confirmed NOT registered: "no GSTIN, no GST" holds, priced at no tax (200)', async () => {
    as('IN', 'unregistered');
    const r = await X.call(method, url, bodyOf());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 200, 'no tax added');
  });
  test(url + ' · a shop with a tax number is never asked (the reader is not even called)', async () => {
    as('IN', 'unknown', { gstin: GSTIN.IN });
    CS.registrationOfShop = async () => { throw new Error('asked a shop that has a number'); };
    const r = await X.call(method, url, bodyOf());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 236, '18% charged');
  });
  test(url + ' · a caller that names its own seller prices that seller, nothing is asked of the shop', async () => {
    as('IN', 'unknown');
    const r = await X.call(method, url, bodyOf({ seller: { Gstin: GSTIN.IN, State: '33', Country: 'IN', RegType: 'regular' } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
}
test('the refusal is the till\'s own: same code, same status, same question as POST /till/rate (one reader, one sentence)', async () => {
  const ask = CS.registrationAsk('IN');
  as('IN', 'unknown');
  const r = await X.call('POST', '/api/tax/compute', { lines: LINES, priceIncludesTax: false });
  assert.equal(r.body.code, ask.code);
  assert.ok(r.body.message.startsWith(ask.question), r.body.message);
});
test('a shop with no country is NO_COUNTRY\'s to refuse (422), the registration question never masks it', async () => {
  SHOP.row = shopRow({ gstin: null, name: 'Nowhere', country: null }); SHOP.items = [];
  CS.registrationOfShop = async () => { throw new Error('asked before the country was known'); };
  const r = await X.call('POST', '/api/tax/compute', { lines: LINES, priceIncludesTax: false });
  assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, 'NO_COUNTRY');
});
