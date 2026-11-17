'use strict';
/**
 * tests/ctry75-regof-unknown.test.cjs — CTRY-75 prerequisite: AN UNKNOWN TAX REGISTRATION IS ASKED, NEVER READ AS REGISTERED.
 *
 * The engine's regOf (adopted tax.js) reads any word it does not know, 'unknown' included, as REGULAR. b841 sets 397 shops' tax_registration to NULL
 * (unknown), so every door that reaches the engine must refuse 'unknown' first, with the till's own question (TAX_REGISTRATION_UNKNOWN). Here the
 * REAL reader (country-setup.registrationOfShop) runs over a stubbed database that holds the shop's entity_governance row.
 * Run: node --test tests/ctry75-regof-unknown.test.cjs · no DB, no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
const CS = require('../lib/country-setup');
test.before(X.start);
test.after(X.stop);

const GOV = { stamp: null };
const db = require('../db');
const schema = require('../lib/schema');
const baseQuery = db.query;
const askDb = async (sql, params) => {
  if (/FROM entity_governance/.test(sql)) return { rows: [{ fy_start_month: null, tax_registration: GOV.stamp, setup_source: null, country_setup_at: null }] };
  if (/country-setup\*\/ country, currency_code/.test(sql)) return { rows: [{ country: SHOP.row.country, currency_code: null, gstn: SHOP.row.gstn, timezone: null, policy_flags: SHOP.row.policy_flags }] };
  return baseQuery(sql, params);
};
const hadColumn = schema.hasColumn;
test.beforeEach(() => { db.query = askDb; db.withEntity = async (_id, fn) => fn({ query: askDb }); schema.hasColumn = async () => true; CS._reset(); });
test.afterEach(() => { db.query = baseQuery; schema.hasColumn = hadColumn; CS._reset(); });

const LINES = [{ key: 'a', name: 'Tea', qty: 2, price: 100, gst_rate: 18 }];
const DOORS = [['/api/tax/compute'], ['/api/invoice/build']];
const body = (extra) => Object.assign({ lines: LINES, priceIncludesTax: false }, extra);
const shop = (country, gstin, stamp) => { SHOP.row = shopRow({ gstin, name: 'Ponni', country }); SHOP.items = []; GOV.stamp = stamp; };
const GSTIN = { IN: '33AAAAA0000A1Z5', AU: '51824753556', AE: '100123456700003' };

for (const [url] of DOORS) {
  for (const cc of ['IN', 'AU', 'AE']) {
    test(url + ' · ' + cc + ' · tax_registration NULL (b841): 409 TAX_REGISTRATION_UNKNOWN, no tax computed', async () => {
      shop(cc, null, null);
      const r = await X.call('POST', url, body());
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, 'TAX_REGISTRATION_UNKNOWN');
      assert.equal(r.body.invoice, undefined);
      assert.equal(r.body.money, undefined);
    });
  }
  test(url + ' · registered:true with a number computes the tax as before', async () => {
    shop('IN', GSTIN.IN, { registered: true, number: GSTIN.IN, scheme: 'regular' });
    const r = await X.call('POST', url, body());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 236);
  });
  test(url + ' · the owner\'s explicit no (registered:false) computes with no tax as before', async () => {
    shop('IN', null, { registered: false });
    const r = await X.call('POST', url, body());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 200);
  });
  test(url + ' · a shop with no country of its own, the caller supplying one: the shop\'s unknown registration is still asked, not priced as registered', async () => {
    shop(null, null, null);
    const r = await X.call('POST', url, body({ seller: { country: 'IN' } }));
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'TAX_REGISTRATION_UNKNOWN');
  });
  test(url + ' · a caller\'s own seller that says RegType unknown and has no number is asked, even when the shop is registered', async () => {
    shop('IN', GSTIN.IN, { registered: true, number: GSTIN.IN });
    const r = await X.call('POST', url, body({ seller: { country: 'IN', RegType: 'unknown' } }));
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'TAX_REGISTRATION_UNKNOWN');
  });
  test(url + ' · a caller\'s own seller with its own number is its own registration, whatever the shop is', async () => {
    shop('IN', null, null);
    const r = await X.call('POST', url, body({ seller: { Gstin: GSTIN.IN, State: '33', Country: 'IN', RegType: 'unknown' } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.invoice.ValDtls.TotInvVal, 236);
  });
}
