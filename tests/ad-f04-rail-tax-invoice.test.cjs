/**
 * ad-f04-rail-tax-invoice.test.cjs — AD-F-04: a rail bill from a GST-registered supplier (sealed chit with the supplier's ABN, a date, items and GST) IS the tax invoice: the Day book / BAS 1B flag is not raised on it.
 * Pure and offline. Run: node tests/ad-f04-rail-tax-invoice.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const Evidence = require(path.join(API, 'lib', 'books-evidence'));
const pack = require(path.join(API, 'lib', 'country')).packFor('AU');
let fail = 0;
const ok = (name, cond) => { if (!cond) fail++; console.log((cond ? '   ok   ' : '   FAIL ') + name); };

const invoice = { SellerDtls: { Gstin: '53004085616', LglNm: 'B Pty' }, DocDtls: { Typ: 'INV', Dt: '2026-11-05' }, ItemList: [{ PrdDesc: 'x', Qty: 10 }], ValDtls: { TotInvVal: 110, TaxVal: 10 } };
const sent = '2026-11-05T01:00:00Z';
const ctx = { pack, cur: 'AUD' };
const entry = { event_type: 'purchase_bill', doc_date: '2026-11-05', posting_date: '2026-11-05' };
const lines = [{ account_role: 'gst_paid', dr_minor: 1000 }, { account_role: 'purchases', dr_minor: 10000 }];

(async () => {
  ok('railTaxInvoice is exported', typeof Evidence.railTaxInvoice === 'function');
  ok('a sealed bill with ABN, date, items and GST is a tax invoice', Evidence.railTaxInvoice({ sent_at: sent, invoice }, pack) === true);
  ok('an unsealed draft is not', Evidence.railTaxInvoice({ sent_at: null, invoice }, pack) === false);
  ok('no tax on it (unregistered seller) is not', Evidence.railTaxInvoice({ sent_at: sent, invoice: Object.assign({}, invoice, { ValDtls: { TaxVal: 0 } }) }, pack) === false);
  ok('no ABN is not', Evidence.railTaxInvoice({ sent_at: sent, invoice: Object.assign({}, invoice, { SellerDtls: { LglNm: 'B' } }) }, pack) === false);
  ok('an ABN that fails the check is not', Evidence.railTaxInvoice({ sent_at: sent, invoice: Object.assign({}, invoice, { SellerDtls: { Gstin: '53004085617', LglNm: 'B' } }) }, pack) === false);
  ok('no date is not', Evidence.railTaxInvoice({ sent_at: sent, invoice: Object.assign({}, invoice, { DocDtls: {} }) }, pack) === false);
  ok('no items is not', Evidence.railTaxInvoice({ sent_at: sent, invoice: Object.assign({}, invoice, { ItemList: [] }) }, pack) === false);
  const asked = [];
  const handle = { query: async (sql, params) => { asked.push(params[0]); return { rows: [{ chit_id: 'c1', sent_at: sent, invoice }, { chit_id: 'c2', sent_at: null, invoice }] }; } };
  const held = await Evidence.railInvoiceChits(handle, ['c1', 'c2'], pack);
  ok('railInvoiceChits: ONE read, only the sealed tax invoice is held', asked.length === 1 && held.has('c1') && !held.has('c2'));
  ok('the flag stands with no file and no rail invoice', !!Evidence.flagOf(entry, lines, [], ctx, false));
  ok('the flag is not raised on a rail tax invoice (A$110.00, above the A$82.50 rule)', Evidence.flagOf(entry, lines, [], ctx, true) === null);
  console.log(fail ? 'FAILED ' + fail : 'all passed');
  process.exit(fail ? 1 : 0);
})();
