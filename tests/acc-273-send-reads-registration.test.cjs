'use strict';
/**
 * tests/acc-273-send-reads-registration.test.cjs — ACC-273: THE PARTY A SEND PRICES READS THE SHOP'S OWN REGISTRATION (hand-computed, 1 x 100.00 excl).
 * lib/send-money invoiceOfLines built its seller from the identities row alone (tax-lines.partyOf, no governance row), so an AU / AE / IN shop whose
 * registration was NEVER said was charged tax (SIT: AU 272.73, AE 142.86). Now the row goes through tax-lines.withRegistration (the ONE reader,
 * country-setup.registrationOfShop). A seller nobody asked charges no tax and the invoice says why (_cb.registration: code, tax_invoice false);
 * a seller the owner confirmed NOT registered charges none; a registered one is unchanged.
 *   AU 10% -> registered 10.00 · AE 5% -> 5.00 · IN 18% -> 18.00 · never said / said no -> 0.00
 * Run: node --test tests/acc-273-send-reads-registration.test.cjs · no DB, no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dbId = require.resolve('../db');
const rows = {};
const q = async (sql, args) => ({ rows: ((args && args[0]) || []).map((id) => rows[id]).filter(Boolean) });
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }) } };
const CS = require('../lib/country-setup');
const { invoiceOfLines } = require('../lib/send-money');
const S = '11111111-1111-4111-8111-111111111111';
const original = CS.registrationOfShop;
test.afterEach(() => { CS.registrationOfShop = original; });
const SHOP = { IN: { gstn: '33AAAAA0000A1Z5', rate: 18, cur: 'INR' }, AU: { gstn: '51824753556', rate: 10, cur: 'AUD' }, AE: { gstn: '100123456700003', rate: 5, cur: 'AED' } };
const NONE = { IN: { gstn: null }, AU: { gstn: null }, AE: { gstn: null } };
async function send(cc, withNumber, answer) {
  rows[S] = { identity_id: S, gstn: withNumber ? SHOP[cc].gstn : null, display_name: 'Shop', policy_flags: { price_includes_tax: 'no' }, country: cc };
  CS.registrationOfShop = async () => answer;
  return invoiceOfLines({ lines: [{ particulars: 'Goods', quantity: 1, price: 100, gst_rate: SHOP[cc].rate }], sellerId: S, buyerId: null, business_json: {}, currency_code: SHOP[cc].cur });
}
const taxOf = (inv) => Math.round((inv.ValDtls.TotInvVal - inv.ValDtls.AssVal) * 100) / 100;
for (const cc of Object.keys(NONE)) {
  test('ACC-273 · ' + cc + ' shop, no tax number, registration NEVER said: no tax, not a tax invoice, the question is on the answer', async () => {
    const inv = await send(cc, false, 'unknown');
    assert.equal(taxOf(inv), 0);
    assert.equal(inv.ValDtls.TotInvVal, 100);
    assert.equal(inv._cb.registration.code, 'TAX_REGISTRATION_UNKNOWN');
    assert.equal(inv._cb.registration.tax_invoice, false);
    assert.match(inv._cb.registration.warning, /registered for (GST|VAT)/);
  });
  test('ACC-277 · ' + cc + ' shop, owner said NOT registered: no tax charged', async () => {
    const inv = await send(cc, false, 'unregistered');
    assert.equal(taxOf(inv), 0);
    assert.equal(inv.ValDtls.TotInvVal, 100);
  });
  test('control · ' + cc + ' shop with its tax number is charged as before', async () => {
    const inv = await send(cc, true, 'regular');
    assert.equal(taxOf(inv), SHOP[cc].rate);
    assert.equal(inv._cb.registration, undefined);
  });
}
test('control · AU shop the owner said IS registered (no number typed) is charged', async () => {
  const inv = await send('AU', false, 'regular');
  assert.equal(taxOf(inv), 10);
});
test('the shop with a tax number never reads the answer (a number is a registration)', async () => {
  rows[S] = { identity_id: S, gstn: SHOP.AU.gstn, display_name: 'Shop', policy_flags: {}, country: 'AU' };
  CS.registrationOfShop = async () => { throw new Error('read for a shop with a number'); };
  await invoiceOfLines({ lines: [{ particulars: 'Goods', quantity: 1, price: 100, gst_rate: 10 }], sellerId: S, buyerId: null, business_json: {}, currency_code: 'AUD' });
});
