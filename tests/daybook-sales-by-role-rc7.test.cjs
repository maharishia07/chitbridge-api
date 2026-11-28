'use strict';
/**
 * tests/daybook-sales-by-role-rc7.test.cjs — DRIFT RC7 (Athi 28 Nov 2026, "all the drift issues fixed tonight"): the Day book says each entry's Sales by the account's ROLE, never by its code.
 * Run: node tests/daybook-sales-by-role-rc7.test.cjs
 * MIN hand-computed: a chart whose Sales account is code 5100 (role sales) still reads 1000.00; a 4100 account of another role reads 0.
 * MIN mutation: salesOf picking by code (/^4/) fails the 5100 case. The web side has its own guard (chitbridge-web tests/books-sales-no-code-rule.test.cjs).
 */
const assert = require('assert');
const D = require('../lib/books-daybook');
let pass = 0, fail = 0;
const check = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
const line = (entry_id, code, role, dr, cr) => ({ entry_id, entry_no: 'SJ/' + entry_id, posting_date: '2026-11-01', event_type: 'sale_bill', code, account_name: role, account_role: role, party_id: null, dr_minor: dr, cr_minor: cr, counter_id: null, tax_rate: null });

check('a Sales account coded 5100 (role sales) is the entry\'s Sales: 1000.00 + 180.00 GST-free line = Cr 118000', () => {
  const rows = [line('e1', '1010', 'cash', 118000, 0), line('e1', '5100', 'sales', 0, 100000), line('e1', '2200', 'gst_collected', 0, 18000)];
  const entry = D.entriesOf(rows, new Map(), null)[0];
  assert.strictEqual(entry.sales_minor, 100000);
});
check('an account coded 4100 whose role is not sales is not Sales (the old /^4/ rule would have counted it)', () => {
  const rows = [line('e2', '1010', 'cash', 50000, 0), line('e2', '4100', 'other_income', 0, 50000)];
  assert.strictEqual(D.entriesOf(rows, new Map(), null)[0].sales_minor, 0);
});
check('a sales return (role sales_returns, Dr) nets off, as the P&L has it: 100000 sold, 25000 back = 75000', () => {
  const rows = [line('e3', '5100', 'sales', 0, 100000), line('e3', '5190', 'sales_returns', 25000, 0)];
  assert.strictEqual(D.entriesOf(rows, new Map(), null)[0].sales_minor, 75000);
});
check('the rule is the P&L\'s: books-report-period.grossOf counts the same roles (role starts "sales")', () => {
  const g = require('../lib/books-report-period').grossOf([{ role: 'sales', amount_minor: 100000 }, { role: 'sales_returns', amount_minor: -25000 }, { role: 'other_income', amount_minor: 9 }], [], 'INR');
  assert.strictEqual(g.sales_minor, 75000);
});
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
