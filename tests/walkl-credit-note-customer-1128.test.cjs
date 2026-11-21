/**
 * tests/walkl-credit-note-customer-1128.test.cjs — WALK L L-F-03: a credit note sent WITHOUT business_json.customer takes its customer from the recipient on the rail
 * (entry.buyer), so the seller's return posts at once instead of parking "no refund and no known customer". Offline, no database.
 *
 * Hand figures (UAE, 5%, exclusive), in fils: a note over 2 x 100.00 = net 20000 + tax 1000 = 21000. Both carried totals (invoice, posted return) must agree.
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const db = require('../db');
db.query = async () => ({
  rows: [
    { identity_id: 's1', gstn: null, display_name: 'Seller', policy_flags: { price_includes_tax: 'no' }, country: 'AE' },
    { identity_id: 'b1', gstn: null, display_name: 'Buyer', policy_flags: {}, country: 'AE' }
  ]
});
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const sendMoney = require('../lib/send-money');
const K = require('../lib/books-hooks');
const SETTING = { enabled: true, country: 'AE', functional_currency: 'AED' };
const BUYER = '22222222-2222-4222-8222-222222222222';

(async () => {
  const lines = [{ particulars: 'Valve', quantity: 2, unit: 'pc', price: 100, total: 200, list_price: 100, gst_rate: 5 }];
  const invoice = await sendMoney.invoiceOfLines({ lines, sellerId: 's1', buyerId: 'b1', business_json: { billed_at: '2026-11-08T00:00:00Z' }, currency_code: 'AED' });
  const chitOf = (business) => ({ chit_id: 'c0000000-0000-4000-8000-0000000000d1', created_at: '2026-11-08T05:00:00Z', purpose: 'credit_note', business_json: Object.assign({ invoice, printed_as: 'CN-1' }, business) });
  const verdictOf = (entryExtra, business) => K.classify({ chit: chitOf(business), entry: Object.assign({ sells: true, invoice }, entryExtra), setting: SETTING });
  let fails = 0;
  const t = (name, fn) => { try { fn(); console.log('   ok   ' + name); } catch (e) { fails++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

  t('no customer slot, recipient on the rail → posts a return for the recipient', () => {
    const v = verdictOf({ buyer: { entity_id: BUYER } }, {});
    assert.deepStrictEqual([v.kind, v.event.type, v.event.party], ['post', 'return', BUYER]);
  });
  t('carried totals agree: invoice total 21000 fils = posted return net + tax', () => {
    const v = verdictOf({ buyer: { entity_id: BUYER } }, {});
    const minor = (x) => Math.round(Number(x) * 100);
    const posted = v.event.by_rate.reduce((s, r) => s + minor(r.taxable) + minor(r.cgst) + minor(r.sgst) + minor(r.igst) + minor(r.vat), 0);
    assert.strictEqual(minor(invoice.ValDtls.TotInvVal), 21000);
    assert.strictEqual(posted, 21000);
  });
  t('a named customer still wins over the recipient', () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    const v = verdictOf({ buyer: { entity_id: BUYER } }, { customer: { entity_id: OTHER } });
    assert.strictEqual(v.event.party, OTHER);
  });
  t('neither a customer nor a recipient → still waits, with its sentence', () => {
    const v = verdictOf({}, {});
    assert.deepStrictEqual([v.kind, v.why], ['queue', 'A credit note with no refund and no known customer.']);
  });
  console.log('\n4 checks' + (fails ? ', ' + fails + ' FAILED' : ''));
  process.exit(fails ? 1 : 0);
})();
