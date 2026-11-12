'use strict';
/**
 * tests/ctry-110-pack-door.test.cjs — M2 (CTRY-110 / 111 / 112 / 136): POST /api/invoice/build asks the country pack before it prices.
 *   AU: a rate off the menu (5, 12.5, 18) → 422 RATE_NOT_ON_MENU; 10% on A$100.00 = A$10.00 GST, A$110.00; reverse charge → 422 RCM_NOT_BUILT (reg-au scope: Div 84 later round);
 *   AE: reverse charge → 422 RCM_NOT_BUILT too (tax.determine does not assess it); a buyer ABN that fails the one check (profile.taxIdRefusal) → 400 BUYER_TAX_ID_BAD.
 *   IN control: reverse charge, a state rate (18, the menu row of 1 Feb 2026) and a cess line still build exactly as before.
 * HAND-COMPUTED expected values (minor units noted; money is A$ / ₹):
 *   ABN 51 824 753 556: digits 5-1=4,1,8,2,4,7,5,3,5,5,6 x weights 10,1,3,5,7,9,11,13,15,17,19 = 40+1+24+10+28+63+55+39+75+85+114 = 534 = 6 x 89 → valid.
 *   51824753557 → 535 (not whole 89s) · 12345678901 → 455 (455/89 not whole) · 53004085616 (the ATO's own number): 4,3,0,0,4,0,8,5,6,1,6 → 40+3+0+0+28+0+88+65+90+17+114 = 445 = 5 x 89 → valid; 53004085617 → 464 (not whole) → invalid.
 *   AU 10% of A$100.00 = A$10.00 → total A$110.00. IN 18% of ₹100.00 = ₹18.00 (9.00 + 9.00) → ₹118.00; cess 1% of ₹100.00 = ₹1.00.
 * Run: node --test tests/ctry-110-pack-door.test.cjs · no DB, no network (tests/support/tax-stub.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('./support/tax-stub.cjs');
const { SHOP, shopRow } = X;
test.before(X.start);
test.after(X.stop);
const AU_ABN = '51824753556';
const au = () => { SHOP.row = shopRow({ gstin: AU_ABN, name: 'Koala Cafe', country: 'AU' }); SHOP.items = []; };
const one = (rate, extra) => Object.assign({ priceIncludesTax: false, lines: [{ name: 'Pie', qty: 1, price: 100, gst_rate: rate }] }, extra || {});

test('AU: a GST rate off the menu is refused, 5 / 12.5 / 18 (the AU menu is 0 and 10)', async () => {
  au();
  for (const rate of [5, 12.5, 18]) {
    const r = await X.call('POST', '/api/invoice/build', one(rate));
    assert.equal(r.status, 422, 'rate ' + rate + ' ' + JSON.stringify(r.body));
    assert.equal(r.body.code, 'RATE_NOT_ON_MENU');
    assert.match(r.body.message, new RegExp(rate + '% is not on the menu'));
    assert.equal(r.body.invoice, undefined, 'no invoice at a rate the law does not know');
  }
});

test('AU: 10% on A$100.00 = A$10.00 GST, A$110.00; 0% = A$100.00', async () => {
  au();
  const r = await X.call('POST', '/api/invoice/build', one(10));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.invoice.ValDtls;
  assert.equal(r.body.invoice.currency, 'AUD');
  assert.equal(v.AssVal, 100);
  assert.equal(v.TaxVal, 10);
  assert.equal(v.TotInvVal, 110);
  const z = await X.call('POST', '/api/invoice/build', one(0));
  assert.equal(z.status, 200);
  assert.equal(z.body.invoice.ValDtls.TotInvVal, 100);
});

test('AU: reverse charge is refused RCM_NOT_BUILT in the pack\'s own sentence', async () => {
  au();
  const r = await X.call('POST', '/api/invoice/build', one(10, { reverseCharge: true }));
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, 'RCM_NOT_BUILT');
  assert.match(r.body.message, /Div 84/);
  assert.equal(r.body.invoice, undefined);
  const c = await X.call('POST', '/api/tax/compute', one(10, { reverseCharge: true }));
  assert.equal(c.status, 422, 'tax/compute shares the door');
  assert.equal(c.body.code, 'RCM_NOT_BUILT');
});

test('AE: reverse charge answers "not built" too (the pack says tax.determine does not assess it)', async () => {
  SHOP.row = shopRow({ gstin: '100123456789003', name: 'Dubai Mart', country: 'AE' }); SHOP.items = [];
  const r = await X.call('POST', '/api/invoice/build', one(5, { reverseCharge: true }));
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, 'RCM_NOT_BUILT');
  const ok = await X.call('POST', '/api/invoice/build', one(5));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.invoice.ValDtls.TotInvVal, 105);
});

test('AU: a buyer ABN that fails the check is refused through taxIdRefusal; a valid one builds', async () => {
  au();
  for (const bad of ['51824753557', '12345678901', '5300408561', '53004085617']) {
    const r = await X.call('POST', '/api/invoice/build', one(10, { buyer: { Gstin: bad, name: 'Buyer Pty', Country: 'AU' } }));
    assert.equal(r.status, 400, bad + ' ' + JSON.stringify(r.body));
    assert.equal(r.body.code, 'BUYER_TAX_ID_BAD');
  }
  const good = await X.call('POST', '/api/invoice/build', one(10, { buyer: { Gstin: '53004085616', name: 'Buyer Pty', Country: 'AU' } }));
  assert.equal(good.status, 200, JSON.stringify(good.body));
});

test('IN control: reverse charge, a state rate (18) and a cess line build exactly as before', async () => {
  SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN' }); SHOP.items = [];
  const r = await X.call('POST', '/api/invoice/build', {
    buyer: { Gstin: '27AAACB2230M1ZW', State: '27', name: 'Pune Traders' },
    priceIncludesTax: false,
    reverseCharge: true,
    lines: [{ name: 'Soft drink', qty: 1, price: 100, gst_rate: 18, cess_rate: 1 }]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.invoice.ValDtls;
  assert.equal(r.body.invoice.TranDtls.RegRev, 'Y');
  assert.equal(v.IgstVal, 18);
  assert.equal(v.CesVal, 1);
  assert.equal(v.TotInvVal, 119);
});

test('IN: 12% is off the menu since 22 Sep 2025 → refused (it used to build)', async () => {
  SHOP.row = shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN' }); SHOP.items = [];
  const r = await X.call('POST', '/api/invoice/build', one(12));
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, 'RATE_NOT_ON_MENU');
});

/* the module itself (lib/pack-door.js): each rule alone, the refusal paths, and fail-closed for a seller the pack cannot place */
const door = require('../lib/pack-door');
const rated = (rate) => [{ name: 'Pie', gst_rate: rate }];
test('pack-door: AU rate 10 is on the menu, 5 is refused with the pack\'s sentence', () => {
  assert.deepEqual(door.askPack({ Country: 'AU' }, {}, rated(10), false), []);
  assert.throws(() => door.askPack({ Country: 'AU' }, {}, rated(5), false), (e) => e.said[0] === 'RATE_NOT_ON_MENU' && e.status === 422 && /5% is not on the menu/.test(e.said[1]));
});
test('pack-door: reverse charge refused for AU and AE, passes for IN', () => {
  for (const country of ['AU', 'AE']) assert.throws(() => door.askPack({ Country: country }, {}, [], true), (e) => e.said[0] === 'RCM_NOT_BUILT' && e.status === 422);
  assert.deepEqual(door.askPack({ Country: 'IN' }, {}, rated(18), true), []);
});
test('pack-door: no country or no pack asks nothing (the engine refuses those); a bad buyer id is 400', () => {
  assert.deepEqual(door.askPack({}, {}, rated(99), true), []);
  assert.deepEqual(door.askPack({ Country: 'HU' }, {}, rated(99), true), []);
  assert.throws(() => door.askPack({ Country: 'AU' }, { Gstin: '12345678901' }, rated(10), false), (e) => e.said[0] === 'BUYER_TAX_ID_BAD' && e.status === 400);
});
