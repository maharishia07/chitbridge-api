/**
 * books-bank-pay-needs.test.cjs — BB-P1-3 step 3: a money-out bank line (POST /payments bank_line: true) that names a supplier but no bill and no account is ASKED, never posted on account.
 * Hand figures (AUD): the supplier has one open bill of 880.00 (88000). Line A: 330.00, no bill of that size → needs which_account, nothing posted. Line B: 880.00 with no bill named →
 * needs which_bill (names the bill, settles nothing). Line C: 880.00 naming the bill (allocations, the JONES case) → posted, the bill settled. Line D: the Dues door (no bank_line) pays on account as before.
 * Run: BOOKS_ENGINES_SRC=<engines src> node tests/books-bank-pay-needs.test.cjs
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const { rig, counter, SUPP, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ BB-P1-3 · a bank line to a party with no account and no bill is asked ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R;
  const bill = await q('POST', '/events', { kind: 'expense', class: '6030', amount: 880, supplier: SUPP, date: '2026-10-02', client_ref: 'bb-bill' });
  ok('setup: a credit bill of 880.00 for the supplier posts', bill.status === 200, JSON.stringify(bill.body).slice(0, 200));
  const pay = (extra) => q('POST', '/payments', Object.assign({ party_id: SUPP, direction: 'out', mode: 'bank', received_at: '2026-10-05', allocate: 'none' }, extra));
  const before = X.T.payments ? X.T.payments.length : null;
  const a = await pay({ amount_minor: 33000, bank_line: true, client_ref: 'bb-a' });
  ok('A: 330.00, no matching bill → 422 NEEDS_WHICH_ACCOUNT, needs which_account', a.status === 422 && a.body.code === 'NEEDS_WHICH_ACCOUNT' && a.body.needs === 'which_account', a.status + ' ' + JSON.stringify(a.body).slice(0, 300));
  eq('A: nothing was recorded', X.T.payments ? X.T.payments.length : null, before);
  const b = await pay({ amount_minor: 88000, bank_line: true, client_ref: 'bb-b' });
  ok('B: 880.00 equal to one open bill, none named → 422 needs which_bill, names the bill, settles nothing', b.status === 422 && b.body.needs === 'which_bill' && b.body.bill && b.body.bill.open_minor === 88000, b.status + ' ' + JSON.stringify(b.body).slice(0, 300));
  eq('B: still nothing recorded', X.T.payments ? X.T.payments.length : null, before);
  const c = await pay({ amount_minor: 88000, bank_line: true, client_ref: 'bb-c', allocations: [{ against_ref: b.body.bill && b.body.bill.ref, amount_minor: 88000 }], allocate: undefined });
  ok('C: naming the bill (the JONES case) → 200, the bill settled', c.status === 200 && c.body.allocation && c.body.allocation.allocated_minor === 88000, c.status + ' ' + JSON.stringify(c.body).slice(0, 300));
  const d = await pay({ amount_minor: 33000, client_ref: 'bb-d' });
  ok('D: the Dues door (no bank_line) pays on account as before → 200', d.status === 200, d.status + ' ' + JSON.stringify(d.body).slice(0, 200));
  const e = await q('POST', '/payments', { party_id: SUPP, direction: 'in', mode: 'bank', received_at: '2026-10-05', allocate: 'none', amount_minor: 1000, bank_line: true, client_ref: 'bb-e' });
  ok('E: money IN with bank_line is not asked here (its own door)', e.status !== 422 || e.body.code !== 'NEEDS_WHICH_ACCOUNT', e.status + ' ' + JSON.stringify(e.body).slice(0, 200));
  /* the module on its own: what passes untouched, and the fail-closed answer */
  const needs = require('../lib/bank-pay-needs');
  const through = async (extra) => { try { await needs.askIfBankLine(null, SHOP, Object.assign({ direction: 'out', party: SUPP, amount_minor: 1 }, extra)); return 'passed'; } catch (err) { return err.code; } };
  eq('unit: no bank_line, money in, or a named bill all pass untouched', [await through({}), await through({ bank_line: true, direction: 'in' }), await through({ bank_line: true, allocations: [{ against_ref: 'x', amount_minor: 1 }] })], ['passed', 'passed', 'passed']);
  eq('unit (fail closed): bank_line "true" (a word, not a boolean) is refused, not read as no', await through({ bank_line: 'true' }), 'BOOKS_BAD_REQUEST');
  R.close(); done();
})();
