/**
 * books-supplier-bill-ask.test.cjs — BB-P1-3: POST /events kind bank_expense_supplier must not double-count an open bill. One enforcer (lib/bank-pay-needs askIfSupplierBill, the same finder as the /payments ask).
 * Hand figures (AUD, minor units): the supplier has an open bill of 330.00 (33000). Line A: Origin 300.00 + GST 30.00 = gross 330.00 → asked 422 NEEDS_WHICH_BILL naming the bill, nothing posted.
 * Line A2: the same with not_this_bill:true → posts, the narration says it was not that bill. Line B: gross 110.00 (no equal bill) → posts. Line C: gross 96.80, no tax invoice (no GST, amount is the gross) vs a bill of 96.80 → asked.
 * Line D: two open bills of 220.00 and a line of 220.00 → asked, both refs named. Replay of A2 without the key → the same entry (duplicate), never a fresh 422. not_this_bill on another kind → refused. A word, not a boolean → refused.
 * Run: BOOKS_ENGINES_SRC=<engines src> node tests/books-supplier-bill-ask.test.cjs
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const { rig, counter, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ BB-P1-3 · a bank line to a supplier with an open bill of the same amount is asked ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const setup = require('../lib/country-setup');
  setup.registrationOfShop = async () => setup.registrationOf({ number: X.db.countryRow.gstn, scheme: X.db.countryRow.policy_flags.gst_registration, tax_registration: null });
  const bill = (amount, ref) => q('POST', '/events', { kind: 'expense', class: '6030', amount, supplier: SUPP, date: '2026-10-02', client_ref: ref });
  ok('setup: a credit bill of 330.00 posts', (await bill(330, 'bb-bill-1')).status === 200);
  const line = (extra) => Object.assign({ kind: 'bank_expense_supplier', class: '6030', supplier: SUPP, paid_from: 'bank', date: '2026-10-05' }, extra);
  const entries = () => (T.entries || T.journal || []).length;
  const itemsBefore = T.items.length;
  const a = await q('POST', '/events', line({ amount: 300, input_tax_minor: 3000, tax_invoice: 'held', client_ref: 'bb-a' }));
  ok('A: gross 330.00 (300.00 + GST 30.00) = the open bill → 422 NEEDS_WHICH_BILL naming it', a.status === 422 && a.body.code === 'NEEDS_WHICH_BILL' && a.body.needs === 'which_bill' && a.body.bill && a.body.bill.open_minor === 33000, a.status + ' ' + JSON.stringify(a.body).slice(0, 300));
  eq('A: nothing posted (no new party item)', T.items.length, itemsBefore);
  const pre = await q('POST', '/preview', line({ amount: 300, input_tax_minor: 3000, tax_invoice: 'held', client_ref: 'bb-a' }));
  ok('A: the preview shows the same question as a refusal, not a journal', pre.body.ok === false && pre.body.code === 'NEEDS_WHICH_BILL', JSON.stringify(pre.body).slice(0, 240));
  const a2 = await q('POST', '/events', line({ amount: 300, input_tax_minor: 3000, tax_invoice: 'held', client_ref: 'bb-a2', not_this_bill: true }));
  ok('A2: not_this_bill:true posts (200)', a2.status === 200 && a2.body.entry_id, a2.status + ' ' + JSON.stringify(a2.body).slice(0, 240));
  const replay = await q('POST', '/events', line({ amount: 300, input_tax_minor: 3000, tax_invoice: 'held', client_ref: 'bb-a2' }));
  ok('A2 replay WITHOUT the key answers the first entry (duplicate), never a fresh 422', replay.status === 200 && replay.body.entry_id === a2.body.entry_id, replay.status + ' ' + JSON.stringify(replay.body).slice(0, 240));
  const b = await q('POST', '/events', line({ amount: 100, input_tax_minor: 1000, tax_invoice: 'held', client_ref: 'bb-b' }));
  ok('B: gross 110.00, no equal bill → posts (200)', b.status === 200 && b.body.entry_id, b.status + ' ' + JSON.stringify(b.body).slice(0, 200));
  ok('setup: a bill of 96.80 posts', (await bill(96.8, 'bb-bill-2')).status === 200);
  const c = await q('POST', '/events', line({ amount: 96.8, client_ref: 'bb-c' }));
  ok('C: 96.80, no tax invoice (no GST, the amount is the gross) = the open bill → asked', c.status === 422 && c.body.needs === 'which_bill' && c.body.bill.open_minor === 9680, c.status + ' ' + JSON.stringify(c.body).slice(0, 240));
  ok('setup: two bills of 220.00 post', (await bill(220, 'bb-bill-3')).status === 200 && (await bill(220, 'bb-bill-4')).status === 200);
  const d = await q('POST', '/events', line({ amount: 220, client_ref: 'bb-d' }));
  ok('D: two equal open bills → asked, both refs named', d.status === 422 && d.body.needs === 'which_bill' && Array.isArray(d.body.bills) && d.body.bills.length === 2, d.status + ' ' + JSON.stringify(d.body).slice(0, 300));
  const other = await q('POST', '/events', { kind: 'expense', class: '6030', amount: 5, paid_from: 'bank', date: '2026-10-05', client_ref: 'bb-o', not_this_bill: true });
  ok('not_this_bill on another kind is refused, not ignored', other.status >= 400 && /not_this_bill/.test(JSON.stringify(other.body)), other.status + ' ' + JSON.stringify(other.body).slice(0, 200));
  const word = await q('POST', '/events', line({ amount: 300, input_tax_minor: 3000, tax_invoice: 'held', client_ref: 'bb-w', not_this_bill: 'yes' }));
  ok('not_this_bill "yes" (a word) is refused (fail closed)', word.status === 400, word.status + ' ' + JSON.stringify(word.body).slice(0, 200));
  R.close(); done();
})();
