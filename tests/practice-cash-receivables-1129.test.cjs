/**
 * tests/practice-cash-receivables-1129.test.cjs — MONEY-01 A15 (batch 1129): the practice list's cash_days reads the client's receivables as well as its payables.
 * Hand case (verify file): bank 5,000,000 minor, a bill of 8,000,000 due on day 10, a debtor of 20,000,000 due on day 5 → cash never runs out (cash_days null).
 * The same bank and bill with NO debtor runs out on day 10 (cash_days 10). Unit test, no database. Run: node tests/practice-cash-receivables-1129.test.cjs
 */
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const H = require('./support/books-harness.cjs');
const P = require('../lib/books-practice');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const TODAY = '2026-11-02';
const item = (id, side, due, amount) => ({ item_id: id, entry_id: 'e' + id, party_id: 'p' + id, side, ref_kind: side === 'payable' ? 'bill' : 'bill', ref: 'R' + id, against_ref: 'R' + id, kind: 'sale', amount_minor: amount, currency: 'AUD', doc_date: '2026-10-01', due_date: due, status: 'open', created_at: '2026-10-01T00:00:00Z' });
const bill = item(1, 'payable', '2026-11-12', 8000000), debtor = item(2, 'receivable', '2026-11-07', 20000000);
const setting = { functional_currency: 'AUD', country: 'AU' };
const row = (items) => ({ currencies: 1, cash_minor: 5000000, items });
(async () => {
  H.load({ auth: Object.assign((req, res, next) => next(), { entityOf: () => 'x', requireScope: () => (req, res, next) => next() }) }); /* the books engines, as every books test loads them */
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); return; }
  const withDebtor = P.figuresOf(row([bill, debtor]), TODAY, true, setting);
  ok('debtor pays day 5 before the bill is due day 10: no cash shortfall', withDebtor.cash_days === null, JSON.stringify(withDebtor));
  ok('the bills due in 30 days stay the payables', withDebtor.bills_due_30_minor === 8000000, JSON.stringify(withDebtor));
  const alone = P.figuresOf(row([bill]), TODAY, true, setting);
  ok('the same bill with no debtor: cash runs out in 10 days', alone.cash_days === 10, JSON.stringify(alone));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
