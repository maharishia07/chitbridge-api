/**
 * queue1-rail-credit-against.test.cjs — A RAIL CREDIT NOTE'S `against` (the { chit_id, invoice_no, … } object, FIELDS "credit / debit note chit business_json.against") NAMES ITS BILL
 * THROUGH THE ONE READER (lib/credit-cap againstOf), the same as the till's bill-number string. Before: books-hooks put the whole object into against_bill, so saleOfBill asked for
 * bill_no = '[object Object]' and the note never found its sale (no wait, no against_ref). Run: node tests/queue1-rail-credit-against.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const CUST = '22222222-2222-4222-8222-222222222222', SALE = 'c0000000-0000-4000-8000-000000000001';
const inv = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

(async () => {
  const X = H.load();
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const note = (against) => K.classify({ chit: { chit_id: 'c9', created_at: '2026-11-08T05:00:00Z', purpose: 'credit_note', business_json: { against, refund: { parts: [{ how: 'Cash', amount: 118 }] } } }, entry: { sells: true, buyer: { entity_id: CUST }, invoice: inv }, setting: S });
  const obj = note({ chit_id: SALE, invoice_no: 'INV-7', issuer: 'CBSEL00001' });
  eq('rail object against → the bill id is read (not the object)', [obj.kind, obj.event.against_chit, obj.event.against_bill], ['post', SALE, null]);
  const str = note('C1-0001');
  eq('till string against → the bill number is read, as before', [str.event.against_bill, str.event.against_chit], ['C1-0001', null]);
  eq('no against → neither', [note(null).event.against_bill, note(null).event.against_chit], [null, null]);
  /* the lookup: the SQL carries the id (not "[object Object]") and cents of the note are untouched */
  const asked = [];
  X.dbStub.withEntity = async (e, fn) => fn({ query: async (t, v) => { asked.push([t, v]); return { rows: [{ chit_id: SALE }] }; } });
  const found = await K._saleOfBill('E1', obj.event);
  eq('the rail note finds its sale by chit_id', [found, /chit_id = \$2::uuid/.test(asked[0][0]), asked[0][1]], [SALE, true, ['E1', SALE]]);
  await K._saleOfBill('E1', str.event);
  eq('the till note still finds it by bill_no', [/bill_no/.test(asked[1][0]), asked[1][1]], [true, ['E1', 'C1-0001']]);
  eq('the note posts its own cents', obj.event.by_rate.reduce((t, r) => t + Math.round((r.taxable + r.cgst + r.sgst + r.igst) * 100), 0), 11800);
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
