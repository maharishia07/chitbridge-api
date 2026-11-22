/**
 * till-walky-1129.test.cjs - WALK Y Y-F-01 (P1): a return on a CREDIT bill gave cash back.
 * Walk cents: bill A$32.00 on credit to Maya Retail (P-00001), A$12.00 paid -> she owes A$20.00; 1 mug A$22.00 returned.
 * HAND: no cash out; the note takes A$20.00 off what she owes and the other A$2.00 stays as credit: 3,200 - 1,200 - 2,200 = -200.
 * Seen on the box: sheet "paid by Cash", "no customer the shop knows" (the server-read bill carried the name only), books Cr Cash 2,200.
 * Run: node tests/till-walky-1129.test.cjs   (TILL_SRC=<older till.html> shows it failing before)
 * CARD      09-counter/returns
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const SRC = fs.readFileSync(process.env.TILL_SRC || path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
function grab(name) {
  let i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = SRC.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not on the page');
  const j = SRC.indexOf('\n}\n', i + 1);
  const one = SRC.indexOf('\n', i + 1);
  return /\}\s*$/.test(SRC.slice(i + 1, one)) && !/\{\s*$/.test(SRC.slice(i + 1, one)) ? SRC.slice(i + 1, one) : SRC.slice(i + 1, j + 2);
}
const MAYA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const aud = (v) => 'A$' + v.toFixed(2);
const names = ['retPriorOf', 'retReducedBefore', 'retCustomerOwes', 'retOwedRefusal', 'retOwedFor', 'retPlan', 'retCustomerName', 'retPaidBy', 'retPaidWords'];
const BODY = names.map(grab).join('\n') + '\nreturn { ' + names.join(', ') + ' };';
const api = new Function('S', 'booksOn', 'booksMajor', 'CREDIT_SINCE', 'r2', 'rmoney', 'money', 'RET_PRIOR', 'tx', 'txf',
  'var RET_OWED = "owed";\n' + BODY)({ customers: [{ identity_id: MAYA, balance_minor: 2000 }] }, () => true, (m) => Number(m) / 100, {},
  (v) => Math.round(v * 100) / 100, (v) => Math.round(v * 100) / 100, aud, null, (w) => w, (w, vars) => String(w).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m)));
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok ' + name); } catch (e) { console.log('  FAIL ' + name + '\n    ' + e.message.split('\n').slice(0, 3).join('\n    ')); fail++; } };

const bill = { no: 'C1/2026/0004', total: 32, kind: 'sale', customer: { name: 'Maya Retail', identity_id: MAYA }, payments: [{ how: 'On credit', amount: 32 }] };
t('bill read back from the server keeps who it was made out to (name AND id)', () => {
  assert.ok(/customer\.identity_id = b\.customer_id/.test(SRC), 'dayReread keeps customer_id as identity_id');
});
t('A$22.00 back against A$20.00 owing: no cash, A$20.00 off the debt, A$2.00 kept as credit, said', () => {
  const owed = api.retOwedFor(bill, 22);
  assert.deepStrictEqual([owed.offered, owed.fits, owed.max, owed.credit], [true, true, 20, 2]);
  const plan = api.retPlan(bill, 22, 'owed');
  assert.deepStrictEqual([plan.refunds, plan.refusal, plan.kept], [[], '', 2]);
  assert.ok(/A\$20\.00 off what Maya Retail owes and keep the other A\$2\.00 as credit/.test(plan.ask), plan.ask);
  assert.ok(/A\$2\.00 kept as credit/.test(plan.done), plan.done);
});
t('the header says the bill was On credit, never "paid by Cash"', () => {
  assert.strictEqual(api.retPaidWords(bill), 'on credit');
  assert.strictEqual(api.retPaidWords({ payments: [{ how: 'Cash', amount: 5 }] }), 'paid by Cash');
  assert.strictEqual(api.retPaidWords({ payments: [{ how: 'Cash', amount: 12 }, { how: 'On credit', amount: 20 }] }), 'part on credit');
});
t('the slip names the credit kept', () => { assert.ok(/till-ret-slip-kept/.test(SRC) && /kept_credit/.test(SRC)); });
t('the api bill row carries customer_id beside the name', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
  assert.ok(/customer_id: customer\.identity_id/.test(routes));
});
t('books: the note with no refund parts and the party posts a return against Maya (Cr debtors 22.00), no cash', () => {
  const H = require('./support/books-harness.cjs'); H.load();
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const inv = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 20, TaxAmt: 2, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 22 } };
  const r = K.classify({ chit: { chit_id: 'c1', created_at: '2026-11-21T05:00:00Z', purpose: 'credit_note',
    business_json: { till: { id: 'C1' }, bill_no: 'CN/2026-27/000001', against: { bill_no: 'C1/2026/0004' }, customer: { name: 'Maya Retail', identity_id: MAYA }, refund: { parts: [], total: 22 } } },
    entry: { sells: true, invoice: inv }, setting: { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' } });
  assert.strictEqual(r.kind, 'post', r.why);
  assert.deepStrictEqual([r.event.type, r.event.party, r.event.refund], ['return', MAYA, undefined]);
});
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
